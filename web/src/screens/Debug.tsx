import { useState } from "react";
import { applyPatch, defaultSpec, type ProductSpec } from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { sparkle } from "../lib/sound.ts";

const PRESETS: Record<string, ProductSpec> = {
  "Demo dress": { category: "dress", length: "midi", silhouette: "a_line", sleeves: "cap", neckline: "v", color: "#1F8A5B", fabric: "satin", features: ["phone_pockets", "converts_to_skirt"] },
  "Floral maxi": { category: "dress", length: "maxi", silhouette: "flowy", sleeves: "long", neckline: "square", color: "#F28DB2", fabric: "cotton", pattern: "floral" },
  "Striped top": { category: "top", sleeves: "short", neckline: "crew", color: "#3A6FD8", fabric: "knit", pattern: "stripe" },
  "Wrap skirt": { category: "skirt", length: "knee", silhouette: "wrap", color: "#E2B13C", fabric: "linen" },
  "Halter mini": { category: "dress", length: "mini", silhouette: "fitted", sleeves: "none", neckline: "halter", color: "#1A1A1D", fabric: "satin" },
  Backpack: { category: "backpack", color: "#7FB7A4", features: ["laptop_stand", "phone_pockets"] },
  Helmet: { category: "helmet", color: "#F28DB2", features: ["headphones"] },
  Orb: { category: "generic", name: "Self-watering desk planter" },
  "Judge edits: dress": {
    category: "dress", length: "midi", sleeves: "three_quarter", neckline: "sweetheart", color: "#1F2A55", fabric: "velvet", features: ["phone_pockets"],
    parts: { pockets: { scale: 1.6, color: "#E2B13C" } },
    decals: [{ kind: "emoji", content: "🐉", placement: "back", size: 1.4 }, { kind: "text", content: "WISH IT", placement: "front" }],
    addons: [{ name: "belt", shape: "torus", placement: "waist", color: "#1A1A1D" }, { name: "bow", shape: "bow", placement: "back" }],
  },
  "Judge edits: backpack": {
    category: "backpack", color: "#1A1A1D", pattern: "camo", features: ["phone_pockets"],
    parts: { straps: { color: "#D7263D", scale: 1.4 }, zipper: { color: "#C0C4CC" } },
    decals: [{ kind: "text", content: "CAL HACKS", placement: "front" }, { kind: "shape", content: "star", placement: "back", color: "#D7263D", size: 1.5 }],
    addons: [{ name: "cup holder", shape: "cylinder", placement: "right" }, { name: "solar panel", shape: "box", placement: "top" }, { name: "wings", shape: "fin", placement: "back", count: 2 }],
  },
  "Judge edits: helmet": {
    category: "helmet", color: "#F6D44A", finish: "metallic", features: ["headphones"], parts: { visor: { color: "#1A1A1D", scale: 1.3 } },
    decals: [{ kind: "shape", content: "lightning", placement: "left" }, { kind: "emoji", content: "🐱", placement: "front" }],
    addons: [{ name: "cat ears", shape: "cone", placement: "top", count: 2 }, { name: "tail light", shape: "sphere", placement: "back", glow: true }],
  },
  "Judge edits: mug": {
    category: "generic", name: "Coffee Mug", color: "#F4EBD0", body: { shape: "cylinder", width: 0.36, height: 0.4 },
    decals: [{ kind: "emoji", content: "🐱", placement: "front", size: 1.3 }], addons: [{ name: "handle", shape: "torus", placement: "right" }],
  },
};

/** ?facing=front|back|left|right holds the model still (seen from the camera). */
const FACING: Record<string, number> = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

/** ?spec=<url-encoded JSON> opens the bench on that spec (used for headless screenshots). */
function specFromUrl(): ProductSpec | null {
  const raw = new URLSearchParams(window.location.search).get("spec");
  if (!raw) return null;
  try {
    return applyPatch(defaultSpec, JSON.parse(raw)).spec;
  } catch {
    return null;
  }
}

/** Step A1's test bench: edit the spec JSON, watch the model morph. */
export default function Debug() {
  const [spec, setSpec] = useState<ProductSpec>(() => specFromUrl() ?? PRESETS["Demo dress"]);
  const [text, setText] = useState(() => JSON.stringify(specFromUrl() ?? PRESETS["Demo dress"], null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [hero, setHero] = useState("");
  const [celebrate, setCelebrate] = useState(0);

  const apply = (next: string) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      const { spec: s, dropped } = applyPatch(defaultSpec, parsed);
      setErr(dropped.length ? `Dropped invalid: ${dropped.join(", ")}` : null);
      setSpec(s);
      sparkle();
    } catch {
      setErr("Not valid JSON yet");
    }
  };
  const load = (s: ProductSpec) => apply(JSON.stringify(s, null, 2));

  return (
    <div className="debug-page">
      <div className="debug-side">
        <h2>3D debug</h2>
        <div className="debug-presets">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} onClick={() => load(v)}>{k}</button>
          ))}
        </div>
        <div className="debug-presets">
          {(["mini", "knee", "midi", "maxi"] as const).map((l) => (
            <button key={l} onClick={() => load({ ...spec, length: l })}>{l}</button>
          ))}
          {(["fitted", "a_line", "wrap", "flowy"] as const).map((l) => (
            <button key={l} onClick={() => load({ ...spec, silhouette: l })}>{l}</button>
          ))}
          {(["none", "cap", "short", "long"] as const).map((l) => (
            <button key={l} onClick={() => load({ ...spec, sleeves: l })}>sleeves {l}</button>
          ))}
          {(["crew", "v", "square", "halter"] as const).map((l) => (
            <button key={l} onClick={() => load({ ...spec, neckline: l })}>{l}</button>
          ))}
          {["#1F8A5B", "#B9A3F0", "#D7263D", "#F6D44A", "#1F2A55"].map((c) => (
            <button key={c} onClick={() => load({ ...spec, color: c })}><span className="swatch" style={{ background: c }} />{c}</button>
          ))}
          <button onClick={() => setCelebrate((n) => n + 1)}>celebrate spin</button>
        </div>
        <textarea value={text} onChange={(e) => apply(e.target.value)} spellCheck={false} />
        {err && <div className="err">{err}</div>}
        <input placeholder="Hero GLB url (e.g. /models/x.glb)" value={hero} onChange={(e) => setHero(e.target.value)} className="field" style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,.3)", border: "1px solid var(--glass-border)" }} />
      </div>
      <div className="debug-canvas">
        <Stage spec={spec} framing="debug" heroUrl={hero || null} celebrateKey={celebrate} facing={FACING[new URLSearchParams(window.location.search).get("facing") ?? ""]} />
      </div>
    </div>
  );
}
