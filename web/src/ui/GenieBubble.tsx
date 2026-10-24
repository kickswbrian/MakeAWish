import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MATERIAL_LABELS, type MaterialPreset, type Part, type Patch } from "@wishit/shared";
import { anchorSignal } from "../three/signals.ts";
import { MicIcon, Sparkle } from "./Icons.tsx";

const SWATCHES = ["#F4F4F2", "#1A1A1D", "#8A8D93", "#D7263D", "#FF7F6B", "#E2B13C", "#9CAF88", "#1F8A5B", "#1F2A55", "#7EC8F2", "#B9A3F0", "#F28DB2"];
const MATERIALS: { preset: MaterialPreset; swatch: string }[] = [
  { preset: "leather", swatch: "linear-gradient(135deg,#8a5a3c,#5b3722)" },
  { preset: "nylon", swatch: "repeating-linear-gradient(45deg,#6d7a86 0 2px,#5b6873 2px 4px)" },
  { preset: "canvas", swatch: "repeating-linear-gradient(0deg,#cdbf9f 0 2px,#bfae8b 2px 3px)" },
  { preset: "knit", swatch: "repeating-linear-gradient(90deg,#b9a3f0 0 3px,#a48ce0 3px 5px)" },
  { preset: "denim", swatch: "repeating-linear-gradient(135deg,#3d5a86 0 2px,#2f4970 2px 4px)" },
  { preset: "metal_brushed", swatch: "linear-gradient(90deg,#c9ccd2,#9aa0a8,#d9dce0)" },
  { preset: "metal_polished", swatch: "radial-gradient(circle at 30% 30%,#fff,#b8bcc4 45%,#6d7178)" },
  { preset: "wood", swatch: "repeating-linear-gradient(100deg,#b98b57 0 3px,#9c7244 3px 5px)" },
  { preset: "plastic_gloss", swatch: "radial-gradient(circle at 30% 30%,#fff,#e8798e 40%,#b0485c)" },
  { preset: "plastic_matte", swatch: "#a7b1ba" },
  { preset: "rubber", swatch: "#2b2d31" },
  { preset: "glass", swatch: "linear-gradient(135deg,rgba(220,240,255,.9),rgba(160,200,230,.5))" },
  { preset: "ceramic", swatch: "radial-gradient(circle at 30% 30%,#fff,#e8dcc8)" },
  { preset: "suede", swatch: "#a67b5b" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface GenieBubbleProps {
  part: Part;
  /** Real-world size, e.g. "12 × 4 × 1 cm". */
  size?: string;
  isRoot: boolean;
  busy: boolean;
  gizmo: boolean;
  listening: boolean;
  onPatches: (patches: Patch[], label: string) => void;
  onAsk: (text: string) => void;
  onMic: () => void;
  onGizmo: (on: boolean) => void;
  onClose: () => void;
}

/**
 * The genie's edit card, anchored to the tapped part. Quick chips apply instantly (no LLM); the text
 * box and the mic ask the genie about this part, scoped to it and its neighbors.
 */
export function GenieBubble({ part, size, isRoot, busy, gizmo, listening, onPatches, onAsk, onMic, onGizmo, onClose }: GenieBubbleProps) {
  const card = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"color" | "material">("color");

  // Follow the part every frame (camera moves, springs), clamped to the window.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = card.current, d = dot.current, ln = line.current;
      // The card lives in a body portal (nothing clips it); the marker sits inside the bubble.
      const host = marker.current?.parentElement;
      if (el && host && d && ln) {
        const r = host.getBoundingClientRect();
        const sx = r.width / Math.max(1, anchorSignal.width), sy = r.height / Math.max(1, anchorSignal.height);
        const ax = anchorSignal.x * sx, ay = anchorSignal.y * sy;
        const w = el.offsetWidth, h = el.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        // Keep the part visible: sit beside the bubble when there is room, else below it.
        let left: number, top: number, side: "right" | "left" | "below";
        if (r.right + 24 + w < vw - 8) {
          side = "right";
          left = r.width + 24;
          top = ay - h * 0.35;
        } else if (r.left - 24 - w > 8) {
          side = "left";
          left = -w - 24;
          top = ay - h * 0.35;
        } else {
          side = "below";
          left = (r.width - w) / 2;
          top = r.height - h * 0.25;
        }
        left = Math.min(Math.max(left, 8 - r.left), vw - 8 - w - r.left);
        // Beside the bubble, stay below the product title block (wide layout keeps it there).
        const below = side !== "below" ? document.querySelector(".product-size")?.getBoundingClientRect() : undefined;
        const minTop = below && below.left > r.left + r.width * 0.5 ? below.bottom + 16 : 8;
        top = Math.min(Math.max(top, minTop - r.top), vh - 8 - h - r.top);
        el.style.transform = `translate3d(${(left + r.left).toFixed(1)}px, ${(top + r.top).toFixed(1)}px, 0)`;
        const vis = anchorSignal.visible ? "1" : "0";
        el.style.opacity = "1";
        d.style.transform = `translate3d(${(ax - 6 + r.left).toFixed(1)}px, ${(ay - 6 + r.top).toFixed(1)}px, 0)`;
        d.style.opacity = vis;
        // A thin thread from the tapped spot to the card.
        const tx = side === "right" ? left : side === "left" ? left + w : Math.min(Math.max(ax, left + 24), left + w - 24);
        const ty = side === "below" ? top : Math.min(Math.max(ay, top + 24), top + h - 24);
        const dx = tx - ax, dy = ty - ay;
        ln.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
        ln.style.transform = `translate3d(${(ax + r.left).toFixed(1)}px, ${(ay + r.top).toFixed(1)}px, 0) rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
        ln.style.opacity = vis;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const recolor = (color: string) => onPatches([{ op: "update", id: part.id, changes: { material: { color } } }], "color");
  const restyle = (preset: MaterialPreset) => onPatches([{ op: "update", id: part.id, changes: { material: { preset, roughness: undefined, metalness: undefined } } }], "material");
  const resize = (f: number) => onPatches([{ op: "update", id: part.id, changes: { transform: { scale: part.transform.scale.map((s) => +(s * f).toFixed(4)) as [number, number, number] } } }], "size");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAsk(t);
    setText("");
  };

  return (
    <>
      <div ref={marker} hidden />
      {createPortal(
    <div className="gb-layer">
      <div ref={line} className="gb-line" aria-hidden="true" />
      <div ref={dot} className="gb-dot" aria-hidden="true" />
      <div ref={card} className={`gb ${gizmo ? "compact" : ""}`} role="dialog" aria-label={`Edit ${part.name}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="gb-head">
          <span className="gb-swatch" style={{ background: part.material.color }} />
          <div className="gb-title">
            <strong>{part.name}</strong>
            <span>{cap(MATERIAL_LABELS[part.material.preset])}{part.kind === "kit" ? " · kit part" : ""}{size ? ` · ${size}` : ""}</span>
          </div>
          <button className="gb-x" aria-label="Done editing" onClick={onClose}>×</button>
        </div>

        {gizmo ? (
          <p className="gb-tip">Drag the arrows to move, the arcs to rotate, the dots to resize. Each drag is one undo step.</p>
        ) : (
        <>
        <div className="gb-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "color"} className={tab === "color" ? "on" : ""} onClick={() => setTab("color")}>Color</button>
          <button role="tab" aria-selected={tab === "material"} className={tab === "material" ? "on" : ""} onClick={() => setTab("material")}>Material</button>
        </div>
        {tab === "color" ? (
          <div className="gb-swatches">
            {SWATCHES.map((c) => (
              <button key={c} className={`gb-sw ${part.material.color.toUpperCase() === c ? "on" : ""}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => recolor(c)} />
            ))}
            <label className="gb-sw gb-custom" aria-label="Custom color">
              <input type="color" value={part.material.color} onChange={(e) => recolor(e.target.value.toUpperCase())} />
            </label>
          </div>
        ) : (
          <div className="gb-mats">
            {MATERIALS.map((m) => (
              <button key={m.preset} className={`gb-mat ${part.material.preset === m.preset ? "on" : ""}`} onClick={() => restyle(m.preset)}>
                <span style={{ background: m.swatch }} />
                {MATERIAL_LABELS[m.preset]}
              </button>
            ))}
          </div>
        )}
        </>
        )}

        <div className="gb-actions">
          <button onClick={() => resize(1.15)}>Bigger</button>
          <button onClick={() => resize(1 / 1.15)}>Smaller</button>
          <button className={gizmo ? "on" : ""} aria-pressed={gizmo} onClick={() => onGizmo(!gizmo)}>{gizmo ? "Done" : "Move"}</button>
          {!isRoot && (
            <button className="danger" onClick={() => onPatches([{ op: "remove", id: part.id }], "remove")}>Remove</button>
          )}
        </div>

        <form
          className="gb-ask"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Sparkle size={15} color="#E9C46A" />
          <input value={text} placeholder={busy ? "The genie is working… ask anyway" : "Ask the genie: “add a zipper here”"} onChange={(e) => setText(e.target.value)} aria-label="Ask the genie about this part" />
          <button type="button" className={`gb-mic ${listening ? "on" : ""}`} aria-label={listening ? "Listening" : "Talk about this part"} onClick={onMic}>
            <MicIcon size={15} />
          </button>
        </form>
      </div>
    </div>,
        document.body,
      )}
    </>
  );
}
