import { api } from "../lib/api.ts";

/**
 * Raw Cartesia APIs from the browser, authenticated with a short-lived access token minted by our
 * server (the API key never reaches the browser). Ink 2 turn-detection STT + Sonic TTS websockets.
 */
const WS = "wss://api.cartesia.ai";
export const STT_MODEL = "ink-2";
export const TTS_MODEL = "sonic-3.5";

let tokenCache: { token: string; expiresAt: number; version: string } | null = null;
async function token() {
  if (tokenCache && tokenCache.expiresAt - Date.now() > 30_000) return tokenCache;
  tokenCache = await api.cartesiaToken();
  return tokenCache;
}

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.size = (opts.processorOptions && opts.processorOptions.chunk) || 1600;
    this.buf = new Int16Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);
`;

export interface SttHandlers {
  onTurnStart(): void;
  onUpdate(text: string): void;
  onTurnEnd(text: string): void;
  onStatus(s: "open" | "reconnecting" | "failed" | "closed"): void;
}

/** Mic -> AudioWorklet -> 16-bit PCM in ~100 ms chunks -> Ink 2 with built-in turn detection. */
export class CartesiaStt {
  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private node: AudioWorkletNode | null = null;
  private stopped = false;
  private retries = 0;
  analyser: AnalyserNode | null = null;
  muted = false;

  constructor(private h: SttHandlers) {}

  async start(stream: MediaStream) {
    this.stopped = false;
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    src.connect(this.analyser);
    this.node = new AudioWorkletNode(this.ctx, "pcm16", { processorOptions: { chunk: Math.round(this.ctx.sampleRate / 10) } });
    src.connect(this.node);
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // Muted still streams silence: the server expects continuous, real-time audio.
      this.ws.send(this.muted ? new ArrayBuffer(e.data.byteLength) : e.data);
    };
    await this.connect();
  }

  private async connect() {
    const t = await token();
    const q = new URLSearchParams({
      model: STT_MODEL,
      encoding: "pcm_s16le",
      sample_rate: String(this.ctx!.sampleRate),
      cartesia_version: t.version,
      access_token: t.token,
    });
    const ws = new WebSocket(`${WS}/stt/turns/websocket?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.h.onStatus("open");
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let m: { type?: string; transcript?: string; message?: string };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === "turn.start" || m.type === "turn.resume") this.h.onTurnStart();
      else if (m.type === "turn.update" || m.type === "turn.eager_end") this.h.onUpdate(m.transcript ?? "");
      else if (m.type === "turn.end") this.h.onTurnEnd((m.transcript ?? "").trim());
      else if (m.type === "error") console.warn("[stt] error", m);
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      // Auto-reconnect once; after that the text box carries on.
      if (this.retries++ < 1) {
        this.h.onStatus("reconnecting");
        tokenCache = null;
        setTimeout(() => void this.connect().catch(() => this.h.onStatus("failed")), 400);
      } else this.h.onStatus("failed");
    };
  }

  stop() {
    this.stopped = true;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "close" }));
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.node?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.h.onStatus("closed");
  }
}

/** Sonic over a websocket, streamed straight into Web Audio. */
export class CartesiaTts {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private ctx: AudioContext;
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];
  private current: { id: string; done: boolean; resolve: () => void; reject: (e: Error) => void; first: boolean } | null = null;
  analyser: AnalyserNode;
  onFirstAudio: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
  }

  private rate() {
    const r = this.ctx.sampleRate;
    return [8000, 16000, 22050, 24000, 44100, 48000].includes(r) ? r : 44100;
  }

  private open(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const t = await token();
      const ws = new WebSocket(`${WS}/tts/websocket?${new URLSearchParams({ cartesia_version: t.version, access_token: t.token })}`);
      await new Promise<void>((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = () => rej(new Error("tts socket failed"));
      });
      ws.onmessage = (e) => this.onMessage(e);
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.current?.reject(new Error("tts socket closed"));
      };
      this.ws = ws;
      return ws;
    })().finally(() => (this.opening = null));
    return this.opening;
  }

  /** Open the socket ahead of time so the first reply doesn't pay the handshake. */
  warm() {
    void this.open().catch(() => {});
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private onMessage(e: MessageEvent) {
    const m = JSON.parse(e.data as string) as { type: string; context_id?: string; data?: string; message?: string; title?: string };
    const cur = this.current;
    if (!cur || m.context_id !== cur.id) return;
    if (m.type === "chunk" && m.data) {
      const bin = atob(m.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm = new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
      if (!pcm.length) return;
      const buf = this.ctx.createBuffer(1, pcm.length, this.rate());
      buf.copyToChannel(pcm, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      const at = Math.max(this.next, this.ctx.currentTime + 0.03);
      src.start(at);
      this.next = at + buf.duration;
      this.sources.push(src);
      src.onended = () => {
        this.sources = this.sources.filter((s) => s !== src);
        if (cur.done && !this.sources.length && this.current === cur) this.finish();
      };
      if (cur.first) {
        cur.first = false;
        this.onFirstAudio?.();
      }
    } else if (m.type === "done") {
      cur.done = true;
      if (!this.sources.length) this.finish();
    } else if (m.type === "error") {
      cur.reject(new Error(m.message ?? m.title ?? "tts error"));
      this.current = null;
    }
  }

  private finish() {
    const cur = this.current;
    this.current = null;
    cur?.resolve();
  }

  async speak(text: string, voiceId: string): Promise<void> {
    this.cancel();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const ws = await this.open();
    const id = `ctx_${Math.random().toString(36).slice(2)}`;
    return new Promise<void>((resolve, reject) => {
      this.current = { id, done: false, resolve, reject, first: true };
      this.next = 0;
      ws.send(
        JSON.stringify({
          model_id: TTS_MODEL,
          transcript: text,
          voice: { id: voiceId },
          language: "en",
          context_id: id,
          continue: false,
          output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: this.rate() },
          generation_config: { speed: 1.05, emotion: "content" },
        }),
      );
    });
  }

  /** Barge-in: stop immediately and tell the server to stop generating. */
  cancel() {
    const cur = this.current;
    if (cur && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ context_id: cur.id, cancel: true }));
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.next = 0;
    if (cur) {
      this.current = null;
      cur.resolve();
    }
  }

  get speaking() {
    return !!this.current;
  }
}
