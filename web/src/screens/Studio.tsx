import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type * as THREE from "three";
import {
  applyPatch, EVENTS, guessPatch,
  type Campaign, type CampaignUpdatedPayload, type MatchesReadyPayload, type MatchesResponse, type MeshyReadyPayload,
  type ProductSpec, type SpecUpdatedPayload, type WishDTO,
} from "@wishit/shared";
import Stage, { type Framing } from "../three/Stage.tsx";
import { api, getConfig } from "../lib/api.ts";
import { getSocket, useRoom, useSocketEvent } from "../lib/socket.ts";
import { fanfare, setSfxMuted, sparkle, startHum, stopHum } from "../lib/sound.ts";
import { isSaved, saveWish, unsaveWish } from "../lib/wishlist.ts";
import { useVoice } from "../voice/useVoice.ts";
import { Captions, Heart, TopBar } from "../ui/Chrome.tsx";
import { LaunchSheet, MatchGrid, summarize } from "../ui/Results.tsx";
import { CampaignPanel, Celebration } from "../ui/Campaign.tsx";

type Mode = "voice" | "results" | "campaign";

const EXAMPLES = [
  "A backpack with a built-in laptop stand",
  "A bike helmet with built-in headphones",
  "A midi dress that turns into a skirt",
];

/** Screens 1 to 3 of the wish, on one canvas: talk to the orb, see what exists, launch and track. */
export default function Studio() {
  const [params, setParams] = useSearchParams();
  const debug = params.has("debug");
  const [wish, setWish] = useState<WishDTO | null>(null);
  const [spec, setSpec] = useState<ProductSpec>({ category: "generic" });
  const [preview, setPreview] = useState<ProductSpec | null>(null);
  const [mode, setMode] = useState<Mode>("voice");
  const [matches, setMatches] = useState<MatchesResponse | null>(null);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [example, setExample] = useState(0);
  const [celebrate, setCelebrate] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [brain, setBrain] = useState<"llm" | "rules" | null>(null);
  const [perf, setPerf] = useState<string>("");
  const gl = useRef<THREE.WebGLRenderer | null>(null);
  const wishId = wish?.id ?? null;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const announced = useRef(false);
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);

  // ---------- Wish lifecycle ----------

  useEffect(() => {
    let cancelled = false;
    const existing = params.get("wish");
    void (async () => {
      let w: WishDTO | null = null;
      if (existing) w = await api.getWish(existing).catch(() => null);
      if (!w) w = await api.createWish();
      if (cancelled) return;
      setWish(w);
      setSpec(w.spec);
      setSaved(isSaved(w.id));
      if (w.modelUrl) setHeroUrl(w.modelUrl);
      if (existing !== w.id) setParams((p) => { p.set("wish", w!.id); return p; }, { replace: true });
      if (w.campaignId) {
        const c = await api.campaign(w.campaignId).catch(() => null);
        if (c) {
          setCampaign(c);
          setMode("campaign");
          announced.current = true;
        }
      } else if (w.status === "locked") {
        setMode("results");
        setMatches(await api.matches(w.id).catch(() => null));
        announced.current = true;
      }
    })();
    void getConfig().then((c) => setBrain(c.brain)).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRoom(wishId ? `wish:${wishId}` : null);
  useRoom(campaign ? `campaign:${campaign.id}` : null);

  useSocketEvent<SpecUpdatedPayload>(EVENTS.specUpdated, (p) => {
    if (p.wishId !== wishId) return;
    setSpec(p.spec);
    setPreview(null);
    if (p.changed.length) sparkle();
    if (voice.timing.current && !voice.timing.current.patch) voice.timing.current.patch = performance.now();
  });
  useSocketEvent<MeshyReadyPayload>(EVENTS.meshyReady, (p) => {
    if (p.wishId === wishId) setHeroUrl(p.modelUrl);
  });
  useSocketEvent<MatchesReadyPayload>(EVENTS.matchesReady, (p) => {
    if (p.wishId === wishId) setMatches(p);
  });
  useSocketEvent<CampaignUpdatedPayload>(EVENTS.campaignUpdated, (p) => {
    if (p.campaign.wishId === wishId) setCampaign(p.campaign);
  });

  // ---------- Voice ----------

  const handleTurn = useCallback(async (utterance: string) => {
    if (!wishId) return;
    const voice = voiceRef.current!;
    voice.setThinking(true);
    startHum();
    try {
      const r = await api.turn(wishId, utterance);
      setSpec(r.spec);
      setPreview(null);
      if (voice.timing.current && !voice.timing.current.patch) voice.timing.current.patch = performance.now();
      stopHum();
      voice.setThinking(false);
      // The model has already changed (socket event); now the genie speaks.
      const speaking = voice.speak(r.say);
      if (r.lock && modeRef.current === "voice") void lock();
      await speaking;
      if (debug) {
        const t = voice.timing.current;
        if (t) setPerf(`brain ${r.brain} ${r.ms}ms (server)\nspeech end -> patch ${t.patch ? Math.round(t.patch - t.endOfSpeech) : "?"}ms\nspeech end -> audio ${t.firstAudio ? Math.round(t.firstAudio - t.endOfSpeech) : "?"}ms`);
      }
    } catch (err) {
      stopHum();
      voice.setThinking(false);
      console.warn("[turn]", err);
      void voice.speak("My magic flickered for a second. Could you say that again?");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishId]);

  const handleInterim = useCallback((partial: string) => {
    // Instant guess: start forming the product from live captions; the server's spec always wins.
    const guess = guessPatch(partial, spec);
    if (!guess.category && !guess.color && !guess.length) return;
    if (guess.category === "generic") delete guess.category;
    const next = applyPatch(spec, guess).spec;
    setPreview((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
  }, [spec]);

  const voice = useVoice({ onTurn: (t) => void handleTurn(t), onInterim: handleInterim });
  voiceRef.current = voice;

  useEffect(() => setSfxMuted(voice.muted), [voice.muted]);

  // Example wishes cycle gently while idle.
  useEffect(() => {
    if (mode !== "voice") return;
    const t = setInterval(() => setExample((e) => (e + 1) % EXAMPLES.length), 3500);
    return () => clearInterval(t);
  }, [mode]);

  // ---------- Lock, results, campaign ----------

  const lock = useCallback(async () => {
    if (!wishId) return;
    setMode("results");
    setMatches({ matches: [], searched: 0, total: 3, pending: true, sample: false });
    announced.current = false;
    await api.lock(wishId).catch(() => {});
    // Fallback in case the socket event raced the room join.
    setTimeout(() => {
      void api.matches(wishId).then((m) => setMatches((cur) => (cur && !cur.pending ? cur : m))).catch(() => {});
    }, 2500);
  }, [wishId]);

  useEffect(() => {
    if (mode !== "results" || !matches || matches.pending || announced.current) return;
    announced.current = true;
    void voice.speak(summarize(matches).line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, mode]);

  const launch = async (b: { priceCents: number; targetBackers: number; deadlineAt: number }) => {
    if (!wishId) return;
    const c = await api.createCampaign({ wishId, ...b });
    setCampaign(c);
    setLaunchOpen(false);
    setMode("campaign");
    saveWish(wishId);
    setSaved(true);
    sparkle();
    void voice.speak("Your wish is live. Scan the code to back it, and nobody pays unless it happens.");
  };

  const prevStatus = useRef<Campaign["status"] | null>(null);
  useEffect(() => {
    if (!campaign) return;
    const was = prevStatus.current;
    prevStatus.current = campaign.status;
    if (was && was !== "funded" && campaign.status === "funded") {
      setCelebrate((n) => n + 1);
      setShowConfetti(true);
      fanfare();
      try {
        setSnapshot(gl.current?.domElement.toDataURL("image/png") ?? null);
      } catch {
        /* snapshot is decoration */
      }
      void voice.speak("Wish granted! Every hold was captured and the order is on its way to the maker.");
    }
    if (was === "funding" && campaign.status === "releasing") void voice.speak("The deadline passed. Every hold is being released, and nobody pays.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.status]);

  useEffect(() => {
    if (!debug) return;
    const s = getSocket();
    const t = setInterval(() => {
      const at = performance.now();
      s.timeout(2000).emit("ping", (err: unknown) => {
        if (!err) setPerf((p) => p.replace(/\nsocket rtt.*$/, "") + `\nsocket rtt ${Math.round(performance.now() - at)}ms`);
      });
    }, 2000);
    return () => clearInterval(t);
  }, [debug]);

  const shownSpec = preview ?? spec;
  const framing: Framing = mode === "voice" ? (shownSpec.category === "generic" ? "voice" : "product") : mode === "results" ? "top" : "side";
  const result = matches && !matches.pending ? summarize(matches) : null;
  const toggleSave = () => {
    if (!wishId) return;
    if (saved) unsaveWish(wishId);
    else saveWish(wishId);
    setSaved(!saved);
  };
  const onGl = useCallback((r: THREE.WebGLRenderer) => {
    gl.current = r;
  }, []);
  const hasProduct = spec.category !== "generic" || !!spec.name;
  const status = useMemo(() => {
    const chips: { text: string; cls: string }[] = [];
    if (voice.micStatus === "reconnecting") chips.push({ text: "Mic reconnecting…", cls: "warn" });
    if (voice.micStatus === "failed") chips.push({ text: "Mic unavailable, type instead", cls: "bad" });
    if (voice.micStatus === "denied") chips.push({ text: "Mic blocked, type instead", cls: "bad" });
    if (voice.ttsFailed) chips.push({ text: "Voice off, replies shown as text", cls: "warn" });
    if (voice.mode !== "cartesia") chips.push({ text: voice.mode === "browser" ? "Browser voice" : "Text mode", cls: "" });
    if (brain === "rules") chips.push({ text: "Offline genie", cls: "" });
    if (matches?.sample && mode !== "voice") chips.push({ text: "Sample matches (Apify offline)", cls: "warn" });
    return chips;
  }, [voice.micStatus, voice.ttsFailed, voice.mode, brain, matches?.sample, mode]);

  return (
    <>
      <div className="stage-bg">
        <Stage spec={shownSpec} heroUrl={heroUrl} framing={framing} celebrateKey={celebrate} onGl={onGl} />
      </div>
      {showConfetti && <Celebration onDone={() => setShowConfetti(false)} />}
      {debug && perf && <div className="perf">{perf}</div>}

      <div className="overlay">
        <TopBar
          right={
            <>
              {mode !== "voice" && <Heart on={saved} onClick={toggleSave} />}
              <Link to="/wishlist" className="icon-btn" title="Wishlist" aria-label="Wishlist">
                {mode === "voice" ? "♡" : "☰"}
              </Link>
            </>
          }
        />

        {mode === "voice" && (
          <>
            <div className="voice-center">
              {!hasProduct && !voice.captions.length && !voice.interim && (
                <div className="examples">
                  {EXAMPLES.map((e, i) => (
                    <button key={e} className={`example ${i === example ? "active" : ""}`} style={{ animationDelay: `${i * 120}ms` }} onClick={() => voice.submit(e)}>
                      “{e}”
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="state-label">{voice.state === "idle" ? (voice.active ? "muted" : "tap the mic and make a wish") : voice.state}</div>
            <Captions captions={voice.captions} interim={voice.interim} />
          </>
        )}

        {mode === "results" && (
          <div className="results-wrap">
            <div className="results-head">
              <h2>{spec.name ?? "Your wish"}</h2>
              <span className="sub">
                {!result ? "Checking if it already exists…" : result.exists ? "It already exists!" : "Does it exist? Not quite."}
              </span>
              {matches && !matches.pending && matches.searched < matches.total && (
                <span className="chip warn">Searched {matches.searched} of {matches.total} stores</span>
              )}
            </div>
            <MatchGrid res={matches} category={spec.category} />
            {result && !result.exists && (
              <button className="btn primary" onClick={() => setLaunchOpen(true)}>
                ✨ Wish it into existence
              </button>
            )}
            {result?.exists && (
              <button className="btn" onClick={() => setLaunchOpen(true)}>
                Still wish for my exact version
              </button>
            )}
            <Captions captions={voice.captions.filter((c) => c.who === "genie").slice(-1)} interim={voice.interim} />
          </div>
        )}

        {mode === "campaign" && campaign && (
          <div className="campaign-layout">
            <div className="campaign-spacer" />
            <CampaignPanel c={campaign} snapshot={snapshot} />
          </div>
        )}

        {(typing || voice.mode === "text") && mode !== "campaign" && (
          <form
            className="typebox"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              voice.submit(text.trim());
              setText("");
            }}
          >
            <input autoFocus placeholder="Type your wish…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" type="submit">Send</button>
          </form>
        )}

        {mode !== "campaign" && (
          <div className="controls">
            <button className={`icon-btn ${voice.muted ? "on" : ""}`} onClick={voice.toggleMute} title={voice.muted ? "Unmute" : "Mute"} aria-label="Mute">
              {voice.muted ? "🔇" : "🎙"}
            </button>
            <button
              className={`icon-btn big ${voice.active ? "live" : ""}`}
              onClick={() => (voice.active ? voice.stopSpeaking() : void voice.start())}
              title={voice.active ? "Listening (tap to interrupt the genie)" : "Tap to talk"}
              aria-label="Microphone"
            >
              {voice.active ? "◉" : "🎤"}
            </button>
            <button className={`icon-btn ${typing ? "on" : ""}`} onClick={() => setTyping((t) => !t)} title="Type instead" aria-label="Type instead">
              ⌨
            </button>
            <button className="icon-btn danger" onClick={voice.end} title="End" aria-label="End conversation">
              ✕
            </button>
            {mode === "voice" && hasProduct && (
              <button className="btn primary wish-btn" onClick={() => void lock()}>
                ✨ Wish it
              </button>
            )}
          </div>
        )}
      </div>

      {voice.voices.length > 1 && mode !== "campaign" && (
        <div className="voice-picker">
          <select value={voice.voiceId} onChange={(e) => voice.setVoiceId(e.target.value)} aria-label="Genie voice">
            {voice.voices.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      )}
      {status.length > 0 && mode !== "campaign" && (
        <div className="status-chips">
          {status.map((s) => (
            <span key={s.text} className={`chip ${s.cls}`}>{s.text}</span>
          ))}
        </div>
      )}
      {launchOpen && <LaunchSheet spec={spec} onClose={() => setLaunchOpen(false)} onLaunch={launch} />}
    </>
  );
}
