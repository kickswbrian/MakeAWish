import { useCallback, useEffect, useRef, useState } from "react";
import { api, getConfig } from "../lib/api.ts";
import { pref, setPref } from "../lib/wishlist.ts";
import { orbSignal, type OrbState } from "../three/signals.ts";
import { CartesiaStt, CartesiaTts } from "./cartesia.ts";

export type VoiceMode = "cartesia" | "browser" | "text";
export interface Caption { id: number; who: "you" | "genie"; text: string; at: number }
export interface VoiceOption { id: string; name: string }
export interface TurnTiming { endOfSpeech: number; patch?: number; firstAudio?: number }

interface Opts {
  onTurn: (text: string) => void;
  onInterim?: (text: string) => void;
}

type SR = {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

/** Speakers leak into the mic. Ignore "speech" that is just the genie's own words coming back. */
function isEcho(heard: string, saying: string) {
  const words = heard.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 2) return true;
  const said = new Set(saying.toLowerCase().match(/[a-z']+/g) ?? []);
  return words.filter((w) => said.has(w)).length / words.length > 0.6;
}

let captionId = 0;

/**
 * The voice loop. Cartesia (Ink 2 STT + Sonic TTS) when the server has a key, the browser's own
 * speech APIs otherwise, and the text box always.
 */
export function useVoice({ onTurn, onInterim }: Opts) {
  const [mode, setMode] = useState<VoiceMode>("text");
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [micStatus, setMicStatus] = useState<"off" | "open" | "reconnecting" | "failed" | "denied">("off");
  const [ttsFailed, setTtsFailed] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceIdState] = useState<string>(pref("voice", ""));
  const timing = useRef<TurnTiming | null>(null);
  const interimRef = useRef("");
  interimRef.current = interim;

  const handlers = useRef({ onTurn, onInterim });
  handlers.current = { onTurn, onInterim };
  const stt = useRef<CartesiaStt | null>(null);
  const tts = useRef<CartesiaTts | null>(null);
  const rec = useRef<SR | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const saying = useRef("");
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const fakeSpeak = useRef(false);
  const modeRef = useRef<VoiceMode>("text");
  const voiceRef = useRef(voiceId);
  voiceRef.current = voiceId;

  const addCaption = useCallback((who: Caption["who"], text: string) => {
    setCaptions((c) => [...c.slice(-5), { id: ++captionId, who, text, at: Date.now() }]);
  }, []);

  // Decide the mode once the server config is known.
  useEffect(() => {
    let cancelled = false;
    void getConfig()
      .then(async (cfg) => {
        if (cancelled) return;
        const m: VoiceMode = cfg.cartesia ? "cartesia" : SpeechRec ? "browser" : "text";
        modeRef.current = m;
        setMode(m);
        if (cfg.cartesia) {
          const list = (await api.voices().catch(() => [])).map((v) => ({ id: v.id, name: v.name }));
          setVoices(list.slice(0, 12));
          if (!voiceRef.current && list[0]) setVoiceIdState(list[0].id);
        } else if ("speechSynthesis" in window) {
          const load = () => {
            const list = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")).map((v) => ({ id: v.name, name: v.name }));
            if (list.length) setVoices(list.slice(0, 12));
          };
          load();
          speechSynthesis.onvoiceschanged = load;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setVoiceId = (id: string) => {
    setVoiceIdState(id);
    setPref("voice", id);
  };

  const stopSpeaking = useCallback(() => {
    tts.current?.cancel();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    fakeSpeak.current = false;
    saying.current = "";
    setSpeaking(false);
  }, []);

  const bargeIn = useCallback((heard: string) => {
    if (!saying.current) return;
    if (heard && isEcho(heard, saying.current)) return;
    stopSpeaking();
  }, [stopSpeaking]);

  const finalTurn = useCallback((text: string) => {
    setInterim("");
    if (!text.trim()) return;
    timing.current = { endOfSpeech: performance.now() };
    addCaption("you", text);
    handlers.current.onTurn(text);
  }, [addCaption]);

  // ---------- Listening ----------

  const startBrowserRec = useCallback(() => {
    if (!SpeechRec) return false;
    const r = new SpeechRec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let finalText = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else inter += res[0].transcript;
      }
      if (saying.current) {
        bargeIn(finalText || inter);
        if (saying.current) return; // still the genie's echo
      }
      if (inter) {
        setInterim(inter);
        handlers.current.onInterim?.(inter);
      }
      if (finalText) finalTurn(finalText.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setMicStatus("denied");
    };
    r.onend = () => {
      if (activeRef.current && !mutedRef.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      }
    };
    rec.current = r;
    r.start();
    setMicStatus("open");
    return true;
  }, [bargeIn, finalTurn]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    // Unlock audio output inside the user gesture.
    if (modeRef.current === "cartesia") {
      tts.current ??= new CartesiaTts();
      tts.current.warm();
    }
    if (modeRef.current === "cartesia") {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        const s = new CartesiaStt({
          onTurnStart: () => {},
          onUpdate: (text) => {
            if (saying.current) {
              bargeIn(text);
              if (saying.current) return;
            }
            setInterim(text);
            handlers.current.onInterim?.(text);
          },
          onTurnEnd: (text) => {
            if (saying.current && isEcho(text, saying.current)) return;
            finalTurn(text);
          },
          onStatus: (st) => setMicStatus(st === "closed" ? "off" : st),
        });
        s.muted = mutedRef.current;
        stt.current = s;
        await s.start(stream.current);
        return;
      } catch (err) {
        console.warn("[voice] Cartesia STT unavailable, falling back:", err);
        if ((err as Error).name === "NotAllowedError") {
          setMicStatus("denied");
          return;
        }
        stt.current?.stop();
        stt.current = null;
      }
    }
    if (!startBrowserRec()) setMicStatus("failed");
  }, [bargeIn, finalTurn, startBrowserRec]);

  const end = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    stt.current?.stop();
    stt.current = null;
    rec.current?.abort();
    rec.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setInterim("");
    setMicStatus("off");
    stopSpeaking();
  }, [stopSpeaking]);

  const toggleMute = useCallback(() => {
    const m = !mutedRef.current;
    mutedRef.current = m;
    setMuted(m);
    if (stt.current) stt.current.muted = m;
    if (rec.current) {
      if (m) rec.current.stop();
      else {
        try {
          rec.current.start();
        } catch {
          /* running */
        }
      }
    }
  }, []);

  // ---------- Speaking ----------

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    addCaption("genie", text);
    stopSpeaking();
    saying.current = text;
    setSpeaking(true);
    const markFirst = () => {
      if (timing.current && !timing.current.firstAudio) timing.current.firstAudio = performance.now();
    };
    try {
      if (modeRef.current === "cartesia" && voiceRef.current && !ttsFailed) {
        tts.current ??= new CartesiaTts();
        tts.current.onFirstAudio = () => {
          markFirst();
          if (timing.current?.firstAudio) console.log(`[voice] end of speech -> first audio ${Math.round(timing.current.firstAudio - timing.current.endOfSpeech)}ms`);
        };
        await tts.current.speak(text, voiceRef.current);
      } else if ("speechSynthesis" in window) {
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(text);
          const v = speechSynthesis.getVoices().find((x) => x.name === voiceRef.current)
            ?? speechSynthesis.getVoices().find((x) => /Samantha|Google US English|Aria|Jenny/.test(x.name));
          if (v) u.voice = v;
          u.rate = 1.05;
          u.pitch = 1.1;
          u.onstart = () => {
            markFirst();
            fakeSpeak.current = true;
          };
          u.onend = u.onerror = () => resolve();
          speechSynthesis.speak(u);
          setTimeout(resolve, 15000);
        });
      }
    } catch (err) {
      // TTS failed: the reply is already on screen as a caption, carry on silently.
      console.warn("[voice] TTS failed, showing text only:", (err as Error).message);
      setTtsFailed(true);
    } finally {
      if (saying.current === text) {
        saying.current = "";
        fakeSpeak.current = false;
        setSpeaking(false);
      }
    }
  }, [addCaption, stopSpeaking, ttsFailed]);

  // ---------- Levels and orb state ----------

  const state: OrbState = speaking ? "speaking" : thinking ? "thinking" : active && !muted ? "listening" : "idle";
  useEffect(() => {
    orbSignal.state = state;
  }, [state]);

  useEffect(() => {
    let raf = 0;
    const buf = new Uint8Array(256);
    const rms = (a: AnalyserNode | null | undefined) => {
      if (!a) return 0;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    };
    const loop = (t: number) => {
      let level = 0;
      if (orbSignal.state === "speaking") level = tts.current?.speaking ? rms(tts.current.analyser) : fakeSpeak.current ? 0.35 + 0.3 * Math.abs(Math.sin(t / 90)) : 0;
      else if (orbSignal.state === "listening") level = rms(stt.current?.analyser) || (interimRef.current ? 0.3 + 0.2 * Math.sin(t / 70) : 0.05);
      orbSignal.level = level;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Captions fade a few seconds after they appear.
  useEffect(() => {
    if (!captions.length) return;
    const t = setTimeout(() => setCaptions((c) => c.filter((x) => Date.now() - x.at < 9000)), 1000);
    return () => clearTimeout(t);
  }, [captions]);

  useEffect(() => () => end(), [end]);

  return {
    mode, state, active, muted, interim, captions, micStatus, ttsFailed, voices, voiceId, timing,
    start, end, toggleMute, speak, stopSpeaking, setThinking, setVoiceId, addCaption,
    /** Typed text and tapped examples take the same path as a spoken turn. */
    submit: finalTurn,
  };
}
