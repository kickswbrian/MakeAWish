import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type * as THREE from "three";
import {
  applyPatch, EVENTS, guessPatch,
  type Campaign, type CampaignUpdatedPayload, type MatchesReadyPayload, type MatchesResponse, type MeshyReadyPayload,
  type ProductSpec, type SpecUpdatedPayload, type WishDTO,
} from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { api, getConfig } from "../lib/api.ts";
import { getSocket, useRoom, useSocketEvent } from "../lib/socket.ts";
import { fanfare, setSfxMuted, sparkle, startHum, stopHum } from "../lib/sound.ts";
import { isSaved, loadWishlist, saveWish, unsaveWish } from "../lib/wishlist.ts";
import { useVoice } from "../voice/useVoice.ts";
import { Glows, Heart, SpeechLine } from "../ui/Chrome.tsx";
import { Bubble, BubbleSparks } from "../ui/Bubble.tsx";
import { Waveform } from "../ui/Waveform.tsx";
import { BackIcon, CategoryIcon, ChevronDown, HeartIcon, KeyboardIcon, MicIcon, MuteIcon, Sparkle } from "../ui/Icons.tsx";
import { LaunchSheet, MatchGrid, summarize } from "../ui/Results.tsx";
import { CampaignPanel, Celebration } from "../ui/Campaign.tsx";

type Mode = "voice" | "results" | "campaign";

const EXAMPLES = [
  { label: "Laptop-stand backpack", say: "A backpack with a built-in laptop stand" },
  { label: "Headphone helmet", say: "A bike helmet with built-in headphones" },
  { label: "A dress that turns into a skirt", say: "A midi dress that turns into a skirt" },
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
  const [materializeKey, setMaterializeKey] = useState(0);
  const [reshapeKey, setReshapeKey] = useState(0);
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
    if (p.changed.length) {
      sparkle();
      if (p.spec.category !== "generic" && !p.changed.includes("category")) setReshapeKey((k) => k + 1);
    }
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
  const showsModel = shownSpec.category !== "generic" || !!heroUrl;

  // The sparkle spiral plays the moment a product first takes shape in the bubble.
  const hadModel = useRef(showsModel);
  useEffect(() => {
    if (showsModel && !hadModel.current) setMaterializeKey((k) => k + 1);
    hadModel.current = showsModel;
  }, [showsModel]);

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

  const talk = () => {
    if (!voice.active) void voice.start();
    else if (voice.state === "speaking") voice.stopSpeaking();
    else voice.end();
  };
  const talkText = !voice.active ? "Talk" : voice.muted ? "Muted" : voice.state === "listening" ? "Listening" : voice.state === "thinking" ? "Thinking" : voice.state === "speaking" ? "Tap to interrupt" : "Talk";
  const stateLabel = { idle: "Ready", listening: "Listening", thinking: "Genie is searching", speaking: "Genie is speaking" }[voice.state];
  const slot = launchOpen ? "detail" : mode;
  const wishCount = loadWishlist().length;

  return (
    <div className={`app mode-${slot} ${mode === "campaign" ? "scrolls wide" : ""}`}>
      <Glows />
      {showConfetti && <Celebration image={snapshot} line={campaign ? `Funded · ${campaign.captured || campaign.held} of ${campaign.targetBackers}` : undefined} onDone={() => setShowConfetti(false)} />}
      {debug && perf && <div className="perf">{perf}</div>}

      <div className="orb-slot">
        <BubbleSparks />
        <Bubble state={voice.state} robot={!showsModel} materializeKey={materializeKey} reshapeKey={reshapeKey}>
          <Stage
            spec={shownSpec}
            heroUrl={heroUrl}
            framing="bubble"
            transparent
            orb={false}
            pedestal={showsModel}
            celebrateKey={celebrate}
            onGl={onGl}
          />
        </Bubble>
      </div>

      {mode === "voice" && (
        <>
          <header className="hdr">
            <Link to="/wishlist" className="cbtn" aria-label="Back to your wishes"><BackIcon /></Link>
            <div className="genie-pick">
              <Sparkle size={16} color="#C5D8CF" />
              <span>Genie</span>
              {voice.voices.length > 1 && (
                <>
                  <ChevronDown />
                  <select value={voice.voiceId} onChange={(e) => voice.setVoiceId(e.target.value)} aria-label="Genie voice">
                    {voice.voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <Link to="/wishlist" className="cbtn" aria-label={`Your wishes, ${wishCount} saved`}>
              <HeartIcon filled />
              {wishCount > 0 && <span className="count">{wishCount}</span>}
            </Link>
          </header>
          <h1 className="title-xl center title-gap">Make a wish</h1>
          <div className="orb-space" />
          <Waveform label={stateLabel} />
          <div className="speech">
            {!hasProduct && !voice.captions.length && !voice.interim ? (
              <div className="speech-chips">
                {EXAMPLES.map((e, i) => (
                  <button key={e.label} className="chip float" style={{ animationDelay: `${-i * 1.6}s` }} onClick={() => voice.submit(e.say)}>
                    {e.label}
                  </button>
                ))}
              </div>
            ) : (
              <SpeechLine captions={voice.captions} interim={voice.interim} />
            )}
            {status.length > 0 && (
              <div className="note-row">
                {status.map((s) => <span key={s.text} className={`note ${s.cls}`}>{s.text}</span>)}
              </div>
            )}
          </div>
          {hasProduct && (
            <button className="pill dock-pill" onClick={() => void lock()}>
              <Sparkle size={18} color="#182825" /> See matches
            </button>
          )}
          {(typing || voice.mode === "text") && (
            <form
              className="typebox"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                voice.submit(text.trim());
                setText("");
              }}
            >
              <input autoFocus aria-label="Type your wish" placeholder="Type your wish…" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="pill" type="submit">Send</button>
            </form>
          )}
          <div className="dock">
            <button className={`cbtn ${typing ? "on" : ""}`} aria-pressed={typing} aria-label="Type your wish instead" onClick={() => setTyping((t) => !t)}>
              <KeyboardIcon />
            </button>
            <button className="talk" onClick={talk} aria-label={voice.active ? "Stop talking to the genie" : "Talk to the genie"}>
              {voice.state === "listening" && <span className="micring" />}
              <span className="micdot"><MicIcon /></span>
              <span>{talkText}</span>
            </button>
            <button className={`cbtn ${voice.muted ? "on" : ""}`} aria-pressed={voice.muted} aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"} onClick={voice.toggleMute}>
              <MuteIcon muted={voice.muted} />
            </button>
          </div>
        </>
      )}

      {mode === "results" && (
        <>
          <header className="hdr">
            <button className="cbtn" aria-label="Back to the genie" onClick={() => setMode("voice")}><BackIcon /></button>
            <Heart on={saved} onClick={toggleSave} />
          </header>
          <div className="res-head">
            <h1 className="title-l">Matches</h1>
            <button className="mywish" onClick={() => setLaunchOpen(true)} aria-label={`Your wish: ${spec.name ?? "untitled"}`}>
              <span className="mb" style={{ width: 42, height: 42 }}><CategoryIcon category={spec.category} color={spec.color} size={26} /></span>
              <span>{spec.name ?? "My wish"}</span>
            </button>
          </div>
          <p className="res-sub">
            {!result ? "Checking if it already exists…" : result.exists ? "It already exists!" : "Not quite. Nobody has made this yet."}
            {matches && !matches.pending && matches.searched < matches.total && <span className="note warn">Searched {matches.searched} of {matches.total} stores</span>}
            {status.filter((s) => s.cls === "warn").map((s) => <span key={s.text} className="note warn">{s.text}</span>)}
          </p>
          <MatchGrid res={matches} category={spec.category} color={spec.color} />
          <div className="bottom-fade" />
          {result && (
            <div className="bottom-cta">
              <button className="pill big" onClick={() => setLaunchOpen(true)}>
                <span>{result.exists ? "Still wish for my exact version" : "Wish it into existence"}</span>
                <span className="pill-orb" aria-hidden="true"><Sparkle size={20} color="#F2D88A" /></span>
              </button>
            </div>
          )}
        </>
      )}

      {mode === "campaign" && campaign && (
        <>
          <header className="hdr">
            <Link to="/wishlist" className="cbtn" aria-label="Back to your wishes"><BackIcon /></Link>
            <Heart on={saved} onClick={toggleSave} />
          </header>
          <div className="campaign-body">
            <div className="orb-space" />
            <CampaignPanel c={campaign} snapshot={snapshot} />
          </div>
        </>
      )}

      {launchOpen && (
        <LaunchSheet
          spec={spec}
          saved={saved}
          onSave={toggleSave}
          onClose={() => setLaunchOpen(false)}
          onTalk={() => {
            setLaunchOpen(false);
            setMode("voice");
          }}
          onLaunch={launch}
        />
      )}
    </div>
  );
}
