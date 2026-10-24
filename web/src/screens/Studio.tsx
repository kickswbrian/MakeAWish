import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import * as THREE from "three";
import {
  emptyProduct, EVENTS, isEmpty, matchTemplate, parseIntent, templateById, templateProduct,
  type Campaign, type CampaignUpdatedPayload, type MatchesReadyPayload, type MatchesResponse, type Patch, type Product,
  type TurnEvent, type WishDTO,
} from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { formatSize, outlineOf, PartRegistry, sizeOf, type PartHit } from "../three/parts/ProductView.tsx";
import { api, getConfig } from "../lib/api.ts";
import { getSocket, useRoom, useSocketEvent } from "../lib/socket.ts";
import { fanfare, setSfxMuted, sparkle, startHum, stopHum } from "../lib/sound.ts";
import { isSaved, loadWishlist, saveWish, unsaveWish } from "../lib/wishlist.ts";
import { PendingTurn, sameUtterance, type TurnBody } from "../lib/turn.ts";
import { beginTurn, endTurn, loadFresh, redo, undo, useEditor, useProduct } from "../state/store.ts";
import { useVoice, type TurnTiming } from "../voice/useVoice.ts";
import { Glows, Heart, SpeechLine } from "../ui/Chrome.tsx";
import { Bubble, BubbleSparks } from "../ui/Bubble.tsx";
import { sendView } from "../three/signals.ts";
import { GenieBubble } from "../ui/GenieBubble.tsx";
import { PartsList } from "../ui/PartsList.tsx";
import { Waveform } from "../ui/Waveform.tsx";
import { BackIcon, CategoryIcon, ChevronDown, HeartIcon, KeyboardIcon, MicIcon, MuteIcon, Sparkle } from "../ui/Icons.tsx";
import { LaunchSheet, MatchGrid, summarize } from "../ui/Results.tsx";
import { CampaignPanel, Celebration } from "../ui/Campaign.tsx";
import Bubble3D from "../three/Bubble3D.tsx";
import { IntroRing, IntroWords, useFramesSettled, useIntroPhase } from "../ui/v2/IntroV2.tsx";
import { useUiVariant } from "../ui/v2/useUiVariant.ts";
import { IdlePrompt, useIdle } from "../ui/v2/IdlePrompt.tsx";

type Mode = "voice" | "results" | "campaign";

/** The empty orb is a showroom: templates take turns on the pedestal until the first wish. */
const SHOWCASE = ["sneaker", "headphones", "keyboard", "kettle", "teddy_bear", "bicycle", "planter", "smartwatch", "drone", "office_chair", "backpack", "desk_lamp", "sofa", "smartphone", "umbrella", "speaker", "bike_helmet", "sunglasses", "mug"];

const EXAMPLES = [
  { label: "Laptop-stand backpack", say: "A backpack with a built-in laptop stand" },
  { label: "Headphone helmet", say: "A bike helmet with built-in headphones" },
  { label: "A dress that turns into a skirt", say: "A midi dress that turns into a skirt, with pockets that actually fit my phone" },
];

/** Capture a small square WebP of the canvas for lists and link previews (only the full view). */
/** The exploded view is on: thumbnails would show the parts flying apart. */
let viewExploded = false;

function snapshotThumb(gl: THREE.WebGLRenderer | null, size = 320): string | null {
  if (!gl || useEditor.getState().selection || viewExploded) return null;
  try {
    const src = gl.domElement;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const s = Math.min(src.width, src.height);
    c.getContext("2d")!.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL("image/webp", 0.82);
  } catch {
    return null;
  }
}

/** Additions that make sense for the kind of product (by category/title words). */
const IDEAS: [RegExp, string[]][] = [
  // Specific products first: "Cozy Hoodie Teddy" is a toy, not a garment.
  [/teddy|plush|stuffed|toy|doll/, ["Give it a tiny scarf", "Add a heart patch on the tummy", "Make it knit"]],
  [/chair|stool|sofa|seat/, ["Add a headrest", "Add a cup holder", "Make the seat leather"]],
  [/skateboard|longboard|scooter/, ["Add LED wheels", "Add a sticker on the deck", "Make the deck longer"]],
  [/umbrella|parasol/, ["Add a fan in the handle", "Add a reflective trim", "Add a wrist strap"]],
  [/sunglass|glasses|eyewear/, ["Add gold hinges", "Add a neck cord", "Make the frame tortoiseshell brown"]],
  [/kettle|teapot/, ["Add a temperature dial", "Add a wooden handle", "Make it brushed steel"]],
  [/watch/, ["Add a compass bezel", "Add a second crown button", "Make the band leather"]],
  [/keyboard/, ["Add a volume knob", "Make the keycaps pastel", "Add a wrist rest"]],
  [/drone|quadcopter/, ["Add a second camera", "Add propeller guards", "Add glowing arm LEDs"]],
  [/guitar/, ["Add a pickguard", "Make the body sunburst red", "Add a guitar strap"]],
  [/bicycle|bike(?! helmet)|e-bike/, ["Add a front basket", "Add fenders", "Add a headlight"]],
  [/coffee|espresso/, ["Add a milk frother", "Add a cup warmer on top", "Make it brushed steel"]],
  [/laptop stand|riser/, ["Add a phone holder", "Add a cable slot", "Make it wooden"]],
  [/dress|skirt|top|shirt|jacket|hoodie|coat|garment|gown/, ["Add a belt with a gold buckle", "Add pockets that fit my phone", "Make it a maxi length"]],
  [/bag|backpack|pack|tote|purse|wallet|luggage|suitcase/, ["Add a water bottle pocket", "Add a hidden phone pocket", "Add reflective strips"]],
  [/shoe|sneaker|boot|trainer/, ["Add glow-in-the-dark laces", "Add a heel pull loop", "Make the sole chunkier"]],
  [/helmet|headphone|speaker|audio|watch|phone|gadget|lamp|light/, ["Add a little glowing LED", "Add a USB-C port", "Add a volume knob"]],
  [/mug|cup|bottle|planter|pot|vase|bowl/, ["Add a wooden lid", "Add a carry loop", "Add a cork base"]],
];
const DEFAULT_IDEAS = ["Add a little glowing LED", "Add a brand patch on the front", "Add a carry handle on top"];
const ALT_COLORS: [string, string][] = [["black", "#1A1A1D"], ["red", "#D7263D"], ["navy", "#1F2A55"], ["sage", "#9CAF88"], ["gold", "#E2B13C"], ["white", "#F4F4F2"]];

/** Three things to try on this product: a part recolor, a material swap, an addition. */
function suggestionsFor(product: Product): string[] {
  const root = product.parts[product.rootId];
  if (!root) return [];
  // A recognizable part: short name, no numbering, not tiny hardware.
  const named = Object.values(product.parts).filter(
    (p) => p.parent === product.rootId && !p.csg && p.kind === "primitive" && p.name.split(" ").length <= 2 && !/\d|pin|screw|rivet|seam|stitch|cutter|groove/i.test(p.name),
  );
  const out: string[] = [];
  const pick = named[(named.length * 0.37) | 0];
  if (pick) {
    const c = ALT_COLORS.find(([, hex]) => hex.toUpperCase() !== pick.material.color.toUpperCase()) ?? ALT_COLORS[0];
    out.push(`Make the ${pick.name.toLowerCase()} ${c[0]}`);
  }
  const swap: Partial<Record<string, string>> = {
    leather: "Make it denim", nylon: "Make it leather", canvas: "Make it leather", cotton: "Make it satin", knit: "Make it leather",
    denim: "Make it leather", suede: "Make it leather", satin: "Make it denim", plastic_matte: "Make it brushed metal",
    plastic_gloss: "Make it brushed metal", metal_brushed: "Make it wooden", metal_polished: "Make it wooden", wood: "Make it glossy",
    ceramic: "Make it marble", marble: "Make it concrete", concrete: "Make it marble", glass: "Make it ceramic", rubber: "Make it glossy",
  };
  out.push(swap[root.material.preset] ?? "Make it leather");
  const kind = `${product.category ?? ""} ${product.title}`.toLowerCase();
  const ideas = IDEAS.find(([re]) => re.test(kind))?.[1] ?? DEFAULT_IDEAS;
  out.push(ideas[(Object.keys(product.parts).length + product.title.length) % ideas.length]);
  return out;
}

/** The product's overall real-world size under its title; re-measured when the product settles. */
function ProductSize({ product, registry }: { product: Product; registry: PartRegistry }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setText(formatSize(sizeOf(product, registry))), 450);
    return () => clearTimeout(t);
  }, [product, registry]);
  return <div className="product-size">{text || "\u00a0"}</div>;
}

/** Export the product (as built, at real size in meters) as a binary glTF and download it. */
async function downloadGlb(registry: PartRegistry, title: string) {
  const root = registry.root;
  if (!root) return;
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const copy = root.clone(true);
  copy.position.set(0, 0, 0);
  // Leave out editor-only meshes (selection outline), and ship colors + PBR finishes without the
  // detail textures (they would be re-embedded per part: 18 MB instead of a few hundred KB).
  const drop: THREE.Object3D[] = [];
  copy.traverse((o) => {
    if (o.userData.isHull) drop.push(o);
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material) {
      const mat = (m.material as THREE.MeshPhysicalMaterial).clone();
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "clearcoatRoughnessMap", "sheenColorMap", "sheenRoughnessMap", "anisotropyMap"] as const) {
        (mat as unknown as Record<string, unknown>)[k] = null;
      }
      m.material = mat;
    }
  });
  for (const o of drop) o.removeFromParent();
  const data = (await new GLTFExporter().parseAsync(copy, { binary: true, onlyVisible: true })) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: "model/gltf-binary" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wish"}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** The hovered part's name, following the cursor (desktop discoverability). */
function HoverTip({ name }: { name: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (el.current) el.current.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 16}px, 0)`;
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return (
    <div ref={el} className={`hover-tip ${name ? "on" : ""}`} aria-hidden="true">
      {name}
    </div>
  );
}

/** What a turn will send, computed the same way for eager (speculative) and final starts. */
interface Prepared {
  body: TurnBody;
  /** A template to show instantly when the turn is committed. */
  template: Product | null;
}

/** Screens 1 to 3 of the wish, on one canvas: talk and build, see what exists, launch and track. */
export default function Studio() {
  const [params, setParams] = useSearchParams();
  const debug = params.has("debug");
  const [wish, setWish] = useState<WishDTO | null>(null);
  const product = useProduct((s) => s.product);
  const edits = useProduct((s) => s.edits);
  const canUndo = useStore(useProduct.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProduct.temporal, (s) => s.futureStates.length > 0);
  const { selection, gizmo, focusKey, select, setGizmo } = useEditor();
  const registry = useMemo(() => new PartRegistry(), []);
  const [mode, setMode] = useState<Mode>("voice");
  const [matches, setMatches] = useState<MatchesResponse | null>(null);
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
  const [busy, setBusy] = useState(false);
  const [perf, setPerf] = useState<string>("");
  const [hint, setHint] = useState(true);
  const [exploded, setExploded] = useState(false);
  useEffect(() => {
    viewExploded = exploded;
  }, [exploded]);
  /** Put the parts back together (and let the springs settle) before a picture or an export. */
  const assemble = useCallback(async () => {
    if (!viewExploded) return;
    setExploded(false);
    viewExploded = false;
    await new Promise((r) => setTimeout(r, 900));
  }, []);
  const [thumb, setThumb] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showIdx, setShowIdx] = useState(0);
  const gl = useRef<THREE.WebGLRenderer | null>(null);
  const wishId = wish?.id ?? null;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);
  const pending = useRef<PendingTurn | null>(null);
  const pendingPrep = useRef<Prepared | null>(null);
  const live = useRef<PendingTurn | null>(null);
  // Requests made while the genie works, with the part selected when they were made.
  const queued = useRef<{ utterance: string; selection: PartHit | null }[]>([]);
  const draining = useRef(false);
  const turnRef = useRef<typeof handleTurn | null>(null);

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
      setThumb(w.thumb);
      loadFresh({ ...w.product, id: w.id });
      useEditor.getState().select(null);
      setSaved(isSaved(w.id));
      if (existing !== w.id) setParams((p) => { p.set("wish", w!.id); return p; }, { replace: true });
      if (w.campaignId) {
        const c = await api.campaign(w.campaignId).catch(() => null);
        if (c) {
          setCampaign(c);
          setMode("campaign");
        }
      } else if (w.status === "locked") {
        setMode("results");
        setMatches(await api.matches(w.id).catch(() => null));
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
  useSocketEvent<MatchesReadyPayload>(EVENTS.matchesReady, (p) => {
    if (p.wishId === wishId) setMatches(p);
  });
  useSocketEvent<CampaignUpdatedPayload>(EVENTS.campaignUpdated, (p) => {
    if (p.campaign.wishId === wishId) setCampaign(p.campaign);
  });

  // Persist edits (debounced) with a fresh thumbnail. Loads never trigger a save.
  const savedEdits = useRef(-1);
  useEffect(() => {
    if (!wishId) return;
    if (savedEdits.current < 0) {
      savedEdits.current = edits;
      return;
    }
    if (edits === savedEdits.current) return;
    const t = setTimeout(() => {
      savedEdits.current = edits;
      const p = useProduct.getState().product;
      if (live.current) return; // the server saves at the end of a turn
      void api.saveProduct(wishId, p, isEmpty(p) ? undefined : snapshotThumb(gl.current) ?? undefined).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [edits, wishId]);

  // ---------- Turns ----------

  const prepare = useCallback((utterance: string, sel: PartHit | null = useEditor.getState().selection): Prepared => {
    const p = useProduct.getState().product;
    // Brand-new wish that names a known product: show its template instantly, the genie customizes it.
    const tpl = isEmpty(p) ? matchTemplate(utterance) : null;
    const base = tpl ? { ...templateProduct(tpl, p.id), id: p.id } : p;
    return {
      template: tpl ? base : null,
      body: {
        text: utterance,
        product: base,
        selection: sel ? { partId: sel.partId, point: sel.point, normal: sel.normal, rotation: sel.rotation } : null,
        outline: tpl ? [] : outlineOf(p, registry),
        template: tpl?.id ?? null,
      },
    };
  }, [registry]);

  const report = useCallback((t: TurnTiming, label: string) => {
    if (!debug) return;
    const rel = (v?: number) => (v === undefined ? "  —" : `${Math.round(v - t.endOfSpeech)}ms`);
    const s = t.server;
    setPerf(
      [
        `${label}`,
        t.eager !== undefined ? `eager start   ${rel(t.eager)} (speculative)` : null,
        `request sent  ${rel(t.sent)}`,
        `first event   ${rel(t.firstEvent)}`,
        `first patch   ${rel(t.firstPatch)}`,
        `last patch    ${rel(t.lastPatch)}`,
        `first audio   ${rel(t.firstAudio)}`,
        s ? `server: ttft ${s.firstToken ?? "—"}ms, patches ${s.firstPatch ?? "—"}–${s.lastPatch ?? "—"}ms, ${s.calls ?? 0} calls, ${s.cachedTokens ?? 0}/${s.inputTokens ?? 0} cached, ${s.outputTokens ?? 0} out` : null,
      ].filter(Boolean).join("\n"),
    );
  }, [debug]);

  /** Start the network request for a turn (possibly speculatively, before the shopper finished). */
  const launchTurn = useCallback((prep: Prepared, speculative: boolean): PendingTurn | null => {
    if (!wishId) return null;
    return new PendingTurn(wishId, { ...prep.body, speculative });
  }, [wishId]);

  const cancelSpeculative = useCallback(() => {
    pending.current?.cancel();
    pending.current = null;
    pendingPrep.current = null;
  }, []);

  /** Cartesia's eager end-of-turn: start the genie early, but keep its output until confirmed. */
  const handleEager = useCallback((utterance: string) => {
    if (!wishId || live.current || draining.current || queued.current.length || modeRef.current !== "voice") return;
    const p = useProduct.getState().product;
    if (parseIntent(utterance, { product: p, selectedId: useEditor.getState().selection?.partId })) return; // instant anyway
    if (pending.current && sameUtterance(pending.current.body.text, utterance)) return;
    cancelSpeculative();
    const prep = prepare(utterance);
    pending.current = launchTurn(prep, true);
    pendingPrep.current = prep;
  }, [wishId, prepare, launchTurn, cancelSpeculative]);

  const handleTurn = useCallback(async (utterance: string, queuedSel?: PartHit | null) => {
    if (!wishId) return;
    const fromQueue = queuedSel !== undefined;
    const sel = fromQueue ? queuedSel : useEditor.getState().selection;
    const voice = voiceRef.current!;
    const t: TurnTiming = voice.timing.current ?? { endOfSpeech: performance.now() };
    voice.timing.current = t;
    const state = useProduct.getState();

    // 0. "Start over": a fresh wish (this one stays in the wishlist if it was saved).
    if (/^(?:let'?s )?(?:start over|start again|new wish|make a new wish|clear (?:it|everything)|something else)[.!]?$/i.test(utterance.trim())) {
      cancelSpeculative();
      voice.end();
      window.location.assign("/");
      return;
    }

    // 1. Instant fast path: color, material, size, remove, undo. No network at all.
    const intent = parseIntent(utterance, { product: state.product, selectedId: sel?.partId });
    if (intent) {
      cancelSpeculative();
      if ((intent.kinds.includes("undo") || intent.kinds.includes("redo")) && live.current) {
        void voice.speak("One moment, I'm still building.");
        return;
      }
      if (intent.kinds.includes("undo")) undo();
      else if (intent.kinds.includes("redo")) redo();
      else if (intent.view === "explode") setExploded(true);
      else if (intent.view === "assemble") setExploded(false);
      else if (intent.view) {
        if (intent.view === "reset") useEditor.getState().select(null);
        sendView(intent.view);
      }
      else if (intent.patches.length) {
        state.apply(intent.patches);
        sparkle();
        setReshapeKey((k) => k + 1);
      }
      t.fast = true;
      t.firstPatch = t.lastPatch = performance.now();
      report(t, `instant ${intent.kinds.join("+")} (no LLM)`);
      void voice.speak(intent.say);
      return;
    }

    // A request the genie needs while it is still building runs right after, not instead.
    if ((live.current || draining.current) && !fromQueue) {
      cancelSpeculative(); // it guessed against the product before this turn finished
      queued.current.push({ utterance, selection: sel });
      void voice.speak("Got it, right after this.");
      return;
    }

    // 2. Reuse the speculative request when the final words match what it guessed.
    let turn: PendingTurn | null = null;
    let prep: Prepared;
    if (pending.current && pendingPrep.current && sameUtterance(pending.current.body.text, utterance) && !pending.current.error) {
      turn = pending.current;
      prep = pendingPrep.current;
      t.sent = turn.started;
    } else {
      cancelSpeculative();
      prep = prepare(utterance, sel);
    }
    pending.current = null;
    pendingPrep.current = null;

    setBusy(true);
    voice.setThinking(true);
    startHum();
    beginTurn();
    if (prep.template) {
      // The template appears this instant; the genie's patches customize it as they stream in.
      useProduct.getState().apply(Object.values(prep.template.parts).map((part) => ({ op: "add", part })));
      useProduct.getState().meta({ title: prep.template.title, category: prep.template.category, description: prep.template.description, targetPriceUsd: prep.template.targetPriceUsd });
      t.firstPatch = performance.now();
      sparkle();
    }
    // Compound requests ("make it red and add wheels"): the instant half lands now, the genie gets
    // the whole sentence (and sees the instant change already made). Same undo step as the turn.
    let instant = false;
    if (!prep.template && !isEmpty(useProduct.getState().product)) {
      for (const clause of utterance.split(/\s*(?:,|;|\band then\b|\band\b|\bthen\b|\balso\b|\bplus\b)\s*/i)) {
        if (clause.split(" ").length < 2 && !/^(bigger|smaller|taller|shorter|wider|longer)$/i.test(clause)) continue;
        const quick = parseIntent(clause, { product: useProduct.getState().product, selectedId: sel?.partId });
        if (quick && quick.patches.length && !quick.view) {
          instant = true;
          useProduct.getState().apply(quick.patches);
          t.firstPatch ??= performance.now();
          sparkle();
        }
      }
    }
    // A speculative request was sent before the instant half landed: the genie must see it, so resend.
    if (turn && instant) {
      turn.cancel();
      turn = null;
    }
    if (!turn) {
      // Send what's on screen now (including any instant half of the request), with fresh part boxes.
      if (!prep.template) prep.body.product = useProduct.getState().product;
      if (instant) prep.body.outline = outlineOf(prep.body.product, registry);
      turn = launchTurn(prep, false)!;
      t.sent = performance.now();
    }
    live.current = turn;
    let lockAfter = false;
    let saidText = "";
    let spoke: Promise<void> | null = null;
    let lastSparkle = 0;

    const onEvent = (ev: TurnEvent) => {
      if (live.current !== turn) return;
      t.firstEvent ??= performance.now();
      switch (ev.t) {
        case "reset":
          // The genie is starting a different product.
          // Same as the server: a blank product (meta included) with this wish's id.
          useProduct.getState().load(emptyProduct(useProduct.getState().product.id));
          useEditor.getState().select(null);
          break;
        case "patches": {
          useProduct.getState().apply(ev.patches as Patch[]);
          const now = performance.now();
          t.firstPatch ??= now;
          t.lastPatch = now;
          if (now - lastSparkle > 450) {
            lastSparkle = now;
            sparkle();
          }
          break;
        }
        case "meta":
          useProduct.getState().meta(ev.meta);
          break;
        case "say":
          stopHum();
          saidText = ev.text;
          if (modeRef.current === "voice") spoke = voice.speak(ev.text);
          break;
        case "lock":
          lockAfter = true;
          break;
        case "done":
          t.server = ev.timing;
          break;
        case "error":
          if (modeRef.current === "voice") spoke = voice.speak(ev.message);
          break;
        default:
          break;
      }
    };
    turn.commit(onEvent);
    await turn.done;
    if (live.current !== turn) return; // superseded by a newer turn
    live.current = null;
    endTurn();
    // A speculative turn persisted nothing on the server; now that it's confirmed, record it.
    if (turn.body.speculative && !turn.error && saidText) void api.transcript(wishId, utterance, saidText).catch(() => {});
    stopHum();
    voice.setThinking(false);
    setBusy(false);
    setReshapeKey((k) => k + 1);
    // The selected part may have changed size or moved: frame it again.
    if (useEditor.getState().selection) useEditor.getState().refocus();
    if (turn.error && modeRef.current === "voice") spoke = voice.speak("My magic flickered for a second. Could you say that again?");
    report(t, prep.template ? "template + genie" : isEmpty(prep.body.product) ? "new design" : "edit");
    // Save with a thumbnail once the springs have settled.
    setTimeout(() => {
      const p = useProduct.getState().product;
      if (!isEmpty(p)) void api.saveProduct(wishId, p, snapshotThumb(gl.current) ?? undefined).catch(() => {});
    }, 1400);
    // Then whatever the shopper asked for meanwhile, oldest first (and no locking: they're still going).
    const next = queued.current.shift();
    if (next && modeRef.current === "voice") {
      draining.current = true;
      // Let the genie finish its line, but never wait on audio forever (a dropped "done" would
      // otherwise park every later request behind this one).
      await Promise.race([spoke, new Promise((r) => setTimeout(r, 8000))]);
      draining.current = false;
      if (modeRef.current === "voice") void turnRef.current?.(next.utterance, next.selection);
      return;
    }
    if (lockAfter && modeRef.current === "voice") {
      await spoke;
      void lock({ finishLine: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishId, prepare, launchTurn, cancelSpeculative, report]);
  turnRef.current = handleTurn;

  const voice = useVoice({
    onTurn: (u) => void handleTurn(u),
    onEager: handleEager,
    onResume: cancelSpeculative,
  });
  voiceRef.current = voice;
  useEffect(() => setSfxMuted(voice.muted), [voice.muted]);

  // ---------- Direct edits (chips, gizmo, keyboard) ----------

  const applyLocal = useCallback((patches: Patch[]) => {
    useProduct.getState().apply(patches);
    sparkle();
  }, []);

  const onHit = useCallback((hit: PartHit) => {
    select(hit);
    setHint(false);
  }, [select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typingInField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // A streaming genie turn is one undo step; let it land before stepping through history.
        if (typingInField || live.current) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        if (typingInField || live.current) return;
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && !typingInField) {
        const sel = useEditor.getState().selection;
        const p = useProduct.getState().product;
        if (sel && sel.partId !== p.rootId) {
          e.preventDefault();
          applyLocal([{ op: "remove", id: sel.partId }]);
        }
      } else if (e.key.toLowerCase() === "g" && !typingInField && useEditor.getState().selection) {
        setGizmo(!useEditor.getState().gizmo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, setGizmo, applyLocal]);

  // ---------- Lock, results, campaign ----------

  /** See matches: the voice session ends here (mic off, genie quiet), the results screen takes over. */
  const lock = useCallback(async ({ finishLine = false }: { finishLine?: boolean } = {}) => {
    if (!wishId) return;
    const voice = voiceRef.current!;
    queued.current = [];
    voice.stopListening();
    if (!finishLine) voice.stopSpeaking();
    stopHum();
    voice.setThinking(false);
    select(null);
    modeRef.current = "results";
    setMode("results");
    setMatches({ matches: [], searched: 0, total: 2, pending: true, sample: false });
    await assemble();
    const shot = snapshotThumb(gl.current);
    if (shot) setThumb(shot);
    await api.saveProduct(wishId, useProduct.getState().product, shot ?? undefined).catch(() => {});
    await api.lock(wishId).catch(() => {});
    // Poll too, in case the socket event raced the room join or the socket dropped: store searches
    // take ~20 s, and a missed event would leave the grid searching forever.
    const poll = async (tries: number) => {
      if (modeRef.current !== "results" || tries <= 0) return;
      const m = await api.matches(wishId).catch(() => null);
      if (m && !m.pending) setMatches((cur) => (cur && !cur.pending ? cur : m));
      else setTimeout(() => void poll(tries - 1), 3000);
    };
    setTimeout(() => void poll(40), 2500);
  }, [wishId, select]);

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
      setSnapshot(snapshotThumb(gl.current, 640));
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
  const hasProduct = !isEmpty(product);
  const root = product.parts[product.rootId];
  const showcasing = mode === "voice" && !hasProduct && !busy && !voice.interim && !voice.captions.length && voice.state !== "thinking";
  // Hold the showroom still while UI variation 2's intro plays: each new piece uploads its textures
  // to the GPU on first draw, and that freezes the animation for a moment.
  const introPlaying = useRef(false);
  useEffect(() => {
    if (!showcasing) return;
    const t = setInterval(() => {
      if (!introPlaying.current) setShowIdx((i) => i + 1);
    }, 4800);
    return () => clearInterval(t);
  }, [showcasing]);
  const showcase = useMemo(() => {
    const tpl = templateById(SHOWCASE[showIdx % SHOWCASE.length]);
    return tpl ? templateProduct(tpl, "showcase") : null;
  }, [showIdx]);
  const stageProduct = hasProduct ? product : showcasing && showcase ? showcase : product;
  // Until the wish has been drawn once, the canvas still holds the last showroom frame (building
  // and compiling a product can take most of a second): keep the bubble's content hidden till then.
  const [shownId, setShownId] = useState<string | null>(null);
  const stagePending = hasProduct && shownId !== product.id;
  useEffect(() => {
    if (!stagePending) return;
    const t = setTimeout(() => setShownId(product.id), 2500); // never stay hidden
    return () => clearTimeout(t);
  }, [stagePending, product.id]);

  // The sparkle spiral plays the moment a product first takes shape in the bubble.
  const hadModel = useRef(hasProduct);
  useEffect(() => {
    if (hasProduct && !hadModel.current) setMaterializeKey((k) => k + 1);
    hadModel.current = hasProduct;
  }, [hasProduct]);

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
  const stateLabel = { idle: "Ready", listening: "Listening", thinking: "Genie is building", speaking: "Genie is speaking" }[voice.state];
  const slot = launchOpen ? "detail" : mode;
  const wishCount = loadWishlist().length;
  const selPart = selection ? product.parts[selection.partId] : undefined;
  const editing = mode === "voice" && !!selPart;

  // ---------- UI variation 2 (press 2; 1 goes back) ----------
  const { variant, introKey } = useUiVariant();
  const v2 = variant !== "1";
  const settled = useFramesSettled();
  const [phase, skipIntro] = useIntroPhase(introKey, v2, settled, variant === "3");
  introPlaying.current = v2 && phase !== "done";
  // While the words and the ring play, nothing 3D is visible: stop both canvases so the intro gets the
  // whole GPU. (They do render during "wait", so their shaders are built before the bubble appears.)
  const introHidden = v2 && (phase === "words" || phase === "swipe" || phase === "ring");
  // The wish screen is just the bubble until there is a product; then the usual editor takes over.
  const v2Landing = v2 && mode === "voice" && !hasProduct;
  useEffect(() => {
    // The genie edit card floats outside the app: close it so it doesn't hang over the intro.
    if (v2 && phase === "words") select(null);
  }, [v2, phase, select]);
  const lastCaption = voice.captions[voice.captions.length - 1];
  const idle = useIdle(
    `${voice.interim}|${lastCaption?.id ?? ""}|${voice.state}|${voice.active}|${busy}|${typing}|${text}`,
    v2Landing && phase === "done" && !busy && !voice.interim && (voice.state === "idle" || voice.state === "listening"),
    // Right away until something's been said; after that, once the last caption has had a moment.
    lastCaption ? 8000 : 0,
  );
  // Nothing on screen to type into: start typing anywhere and the box opens with that letter, centered
  // on the mouse (bottom center when there's no mouse).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [typeAt, setTypeAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!v2Landing) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [v2Landing]);
  useEffect(() => {
    if (!v2Landing || phase !== "done" || typing || voice.mode === "text") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || /[123 ]/.test(e.key)) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      e.preventDefault();
      const p = pointer.current;
      if (p) {
        // Keep the whole box on screen.
        const half = Math.min(560, window.innerWidth - 32) / 2;
        setTypeAt({ x: Math.min(Math.max(p.x, half + 16), window.innerWidth - half - 16), y: Math.min(Math.max(p.y, 44), window.innerHeight - 44) });
      } else setTypeAt(null);
      setText(e.key);
      setTyping(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v2Landing, phase, typing, voice.mode]);
  // The mic stays off while typing, until the wish is sent (or the box is closed).
  const mutedForTyping = useRef(false);
  useEffect(() => {
    if (!v2) return;
    const vc = voiceRef.current!;
    if (typing && vc.active && !vc.muted) {
      vc.toggleMute();
      mutedForTyping.current = true;
    } else if (!typing && mutedForTyping.current) {
      mutedForTyping.current = false;
      if (vc.muted) vc.toggleMute();
    }
  }, [v2, typing]);

  return (
    <div className={`app mode-${slot} ${mode === "campaign" ? "scrolls wide" : ""} ${mode === "voice" && hasProduct ? "has-product" : ""} ${editing ? "is-editing" : ""} ${stagePending ? "stage-pending" : ""} ${v2 ? `v2 v2-phase-${phase}` : ""} ${v2Landing ? "v2-landing" : ""}`}>
      {v2 && <IntroWords phase={phase} onSkip={skipIntro} />}
      <Glows />
      {showConfetti && <Celebration image={snapshot} line={campaign ? `Funded · ${campaign.captured || campaign.held} of ${campaign.targetBackers}` : undefined} onDone={() => setShowConfetti(false)} />}
      {debug && perf && <div className="perf">{perf}</div>}
      {mode === "voice" && <HoverTip name={hoverId && hoverId !== selection?.partId ? product.parts[hoverId]?.name ?? null : null} />}

      <div className="orb-slot">
        {v2 && <IntroRing phase={phase} />}
        {!v2 && <BubbleSparks />}
        <Bubble
          state={voice.state}
          robot={!hasProduct}
          materializeKey={materializeKey}
          reshapeKey={reshapeKey}
          overlay={
            editing && selPart ? (
              <GenieBubble
                key={selPart.id}
                part={selPart}
                size={formatSize(sizeOf(product, registry, selPart.id))}
                isRoot={selPart.id === product.rootId}
                busy={busy}
                gizmo={gizmo}
                listening={voice.active && voice.state === "listening"}
                onPatches={(p) => applyLocal(p)}
                onAsk={(q) => voice.submit(q)}
                onMic={() => (voice.active ? voice.toggleMute() : void voice.start())}
                onGizmo={setGizmo}
                onClose={() => select(null)}
              />
            ) : null
          }
        >
          <Stage
            product={stageProduct}
            framing="bubble"
            transparent
            celebrateKey={celebrate}
            selectedId={mode === "voice" ? selection?.partId ?? null : null}
            registry={registry}
            gizmo={gizmo && mode === "voice" && !exploded}
            explode={exploded && mode === "voice" ? 1 : 0}
            focusKey={focusKey}
            anchor={editing && selection ? { partId: selection.partId, point: selection.point } : null}
            interactive={mode === "voice" && hasProduct}
            preload
            onHit={onHit}
            onHover={setHoverId}
            onMiss={() => select(null)}
            onTransform={(id, tr) => applyLocal([{ op: "update", id, changes: { transform: tr } }])}
            onGl={onGl}
            onShown={setShownId}
            paused={introHidden}
          />
        </Bubble>
        {v2 && <Bubble3D revealed={phase === "bubble" || phase === "done"} paused={introHidden} />}
        {v2Landing && phase === "done" && (
          <button className="v2-tap" onClick={talk} aria-label={voice.active ? "Stop talking to the genie" : "Talk to the genie"} />
        )}
        {mode === "voice" && hasProduct && (
          <div className="edit-bar" role="toolbar" aria-label="Edit">
            <button className="ebtn" disabled={!canUndo || busy} onClick={() => undo()} aria-label="Undo">↶</button>
            <button className="ebtn" disabled={!canRedo || busy} onClick={() => redo()} aria-label="Redo">↷</button>
            <button className={`ebtn ${exploded ? "on" : ""}`} aria-pressed={exploded} onClick={() => setExploded((x) => !x)} aria-label={exploded ? "Assemble the parts" : "Exploded view"} title="Exploded view">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="6" height="6" rx="1.5" /><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3" /></svg>
            </button>
            <button className="ebtn" onClick={() => void assemble().then(() => downloadGlb(registry, product.title))} aria-label="Download 3D model (.glb)" title="Download 3D model (.glb)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
            </button>
            <PartsList
              product={product}
              selectedId={selection?.partId ?? null}
              onPick={(part) => {
                // Anchor at the part's own center so the genie card points at it.
                const box = registry.boxes.get(part.id);
                const c = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
                const g = registry.groups.get(part.id);
                select({ partId: part.id, point: [c.x, c.y, c.z], normal: [0, 0, 1], rotation: [0, 0, 0], world: g ? c.clone().applyMatrix4(g.matrixWorld) : c });
                setHint(false);
              }}
            />
          </div>
        )}
        {mode === "voice" && hasProduct && hint && !selPart && !busy && <div className="tap-hint">Tap any part to edit it</div>}
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
          {hasProduct ? (
            <>
              <h1 className="title-product center">{product.title === "Untitled wish" && busy ? "Conjuring…" : product.title}</h1>
              <ProductSize product={product} registry={registry} />
            </>
          ) : (
            <h1 className="title-xl center title-gap">Make a wish</h1>
          )}
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
            ) : hasProduct && !busy && !editing && !voice.captions.length && !voice.interim ? (
              <div className="speech-chips">
                <span className="try-label">Try saying</span>
                {suggestionsFor(product).map((t, i) => (
                  <button key={t} className="chip sm float" style={{ animationDelay: `${-i * 1.6}s` }} onClick={() => voice.submit(t)}>
                    “{t}”
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
          {v2Landing && phase === "done" && (
            <div className="v2-captions">
              {idle ? <IdlePrompt listening={voice.active} /> : <SpeechLine captions={voice.captions} interim={voice.interim} />}
              {status.some((s) => s.cls === "bad") && (
                <div className="note-row">
                  {status.filter((s) => s.cls === "bad").map((s) => <span key={s.text} className="note bad">{s.text}</span>)}
                </div>
              )}
            </div>
          )}
          {hasProduct && !editing && (
            <button className="pill dock-pill" onClick={() => void lock()}>
              <Sparkle size={18} color="#182825" /> See matches
            </button>
          )}
          {(typing || voice.mode === "text" || (v2Landing && (voice.micStatus === "denied" || voice.micStatus === "failed"))) && (
            <form
              className="typebox"
              style={v2Landing && typing && typeAt ? { position: "fixed", left: typeAt.x, top: typeAt.y, bottom: "auto", transform: "none", translate: "-50% -50%" } : undefined}
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                voice.submit(text.trim());
                setText("");
                // v2: sent, so the box goes away and the mic comes back.
                if (v2) setTyping(false);
              }}
            >
              <input
                autoFocus
                onKeyDown={(e) => {
                  if (v2 && e.key === "Escape") {
                    setText("");
                    setTyping(false);
                  }
                }}
                aria-label="Type your wish" placeholder={selPart ? `Change the ${selPart.name.toLowerCase()}…` : hasProduct ? "Change anything…" : "Type your wish…"} value={text} onChange={(e) => setText(e.target.value)} />
              {v2 ? (
                // Enter sends; the return arrow says so.
                <button className="pill send-icon" type="submit" aria-label="Send (Enter)" title="Send (Enter)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M19 5v6a3 3 0 0 1-3 3H6" />
                    <path d="M10 10l-4 4 4 4" />
                  </svg>
                </button>
              ) : (
                <button className="pill" type="submit">Send</button>
              )}
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
            <button className="mywish" onClick={() => setLaunchOpen(true)} aria-label={`Your wish: ${product.title}`}>
              <span className="mb" style={{ width: 42, height: 42, overflow: "hidden" }}>
                {thumb ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CategoryIcon category={product.category ?? "generic"} color={root?.material.color} size={26} />}
              </span>
              <span>{product.title}</span>
            </button>
          </div>
          <p className="res-sub">
            {!result ? "Checking if it already exists…" : result.exists ? "It already exists!" : "Not quite. Nobody has made this yet."}
            {matches && !matches.pending && matches.searched < matches.total && <span className="note warn">Searched {matches.searched} of {matches.total} stores</span>}
            {status.filter((s) => s.cls === "warn").map((s) => <span key={s.text} className="note warn">{s.text}</span>)}
          </p>
          <MatchGrid res={matches} category={product.category ?? "generic"} color={root?.material.color} />
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
          product={product}
          saved={saved}
          onSave={toggleSave}
          onClose={() => setLaunchOpen(false)}
          onTalk={() => {
            setLaunchOpen(false);
            setMode("voice");
            void voice.start();
          }}
          onLaunch={launch}
        />
      )}
    </div>
  );
}
