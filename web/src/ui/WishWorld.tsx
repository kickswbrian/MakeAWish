import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldItem } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { voterId } from "./Upvote.tsx";
import { CategoryIcon } from "./Icons.tsx";

/**
 * The Wish World: your bubble flies in among past wishes nobody has made yet. They float grouped by
 * color, at a few depths (far ones smaller and fainter, and they drift less as the mouse moves). Drag
 * to pan, scroll to zoom. Hover a bubble for its name and votes; click it for the details card.
 * "Organize" lines them up by popularity.
 */

type Pos = { x: number; y: number; size: number; depth: number };
const YOUR_SIZE = 200;

/** Small stable hash, for per-bubble depth and bobbing that don't change between renders. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

/** Hue (0-360) of a hex color; greys sort after the colors. */
function hue(hex: string | null): number {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 400;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return 380 + max * 20; // nearly grey: after the colors, light to dark
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Floating: a sunflower spiral around your wish, ordered by color so similar colors sit together. */
function floating(items: WorldItem[], yours: string): Map<string, Pos> {
  const out = new Map<string, Pos>();
  out.set(yours, { x: 0, y: 0, size: YOUR_SIZE, depth: 1 });
  const others = items.filter((it) => it.id !== yours).sort((a, b) => hue(a.color) - hue(b.color));
  others.forEach((it, i) => {
    const n = i + 1;
    const depth = 0.55 + 0.45 * hash(it.id);
    const r = 118 * Math.sqrt(n) + 95;
    const a = n * 2.39996;
    out.set(it.id, { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8, size: (92 + 52 * hash(it.id + "s")) * (0.65 + 0.35 * depth), depth });
  });
  return out;
}

/** Organized: a grid by popularity (most votes first). */
function organized(items: WorldItem[]): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const sorted = [...items].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.6)));
  const rows = Math.ceil(sorted.length / cols);
  const cell = 220;
  sorted.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    out.set(it.id, { x: (c - (cols - 1) / 2) * cell, y: (r - (rows - 1) / 2) * cell, size: 150, depth: 1 });
  });
  return out;
}

const fmt = (n: number) => (Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const Arrow = ({ down, size = 18 }: { down?: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

export function WishWorld({ wishId, yourTitle, yourThumb, landed, onLaunch, onRemix }: {
  wishId: string;
  yourTitle: string;
  yourThumb: string | null;
  /** Your bubble has arrived (until then the 3D bubble flying in stands in for it). */
  landed: boolean;
  onLaunch: () => void;
  /** Start a new wish from this one, in the editor. */
  onRemix: (id: string) => void;
}) {
  const [items, setItems] = useState<WorldItem[] | null>(null);
  const [tidy, setTidy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [gliding, setGliding] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.world(voterId(), wishId).then((list) => !cancelled && setItems(list)).catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [wishId]);

  // Your own bubble always floats (with your latest render and name), even before its search finishes.
  const all = useMemo(() => {
    if (!items) return [];
    const mine = items.find((it) => it.id === wishId);
    const you: WorldItem = {
      ...(mine ?? { id: wishId, description: null, category: null, priceUsd: null, color: null, score: 0, up: 0, down: 0, myVote: 0, campaignId: null, createdAt: Date.now() }),
      title: yourTitle,
      thumb: yourThumb ?? mine?.thumb ?? null,
    } as WorldItem;
    return [you, ...items.filter((it) => it.id !== wishId)];
  }, [items, wishId, yourTitle, yourThumb]);
  const pos = useMemo(() => (tidy ? organized(all) : floating(all, wishId)), [all, tidy, wishId]);
  const selected = all.find((it) => it.id === sel) ?? null;
  // The order bubbles settle into place when organizing (a ripple outward, not all at once).
  const order = useMemo(() => new Map([...pos.entries()].sort((a, b) => Math.hypot(a[1].x, a[1].y) - Math.hypot(b[1].x, b[1].y)).map(([id], i) => [id, i])), [pos]);

  useEffect(() => {
    if (!gliding) return;
    const t = setTimeout(() => setGliding(false), 1200);
    return () => clearTimeout(t);
  }, [gliding, view]);

  // Parallax: the mouse position (-1..1) as CSS variables; each bubble shifts by its own depth.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
        el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const vote = async (it: WorldItem, value: -1 | 1) => {
    const next = it.myVote === value ? 0 : value;
    const bump = (x: WorldItem): WorldItem => ({
      ...x,
      up: x.up + (next === 1 ? 1 : 0) - (x.myVote === 1 ? 1 : 0),
      down: x.down + (next === -1 ? 1 : 0) - (x.myVote === -1 ? 1 : 0),
      score: x.score + next - x.myVote,
      myVote: next,
    });
    setItems((cur) => {
      if (!cur) return cur;
      return cur.some((x) => x.id === it.id) ? cur.map((x) => (x.id === it.id ? bump(x) : x)) : [...cur, bump(it)];
    });
    try {
      const t = await api.voteWish(it.id, voterId(), next);
      setItems((cur) => cur?.map((x) => (x.id === it.id ? { ...x, ...t } : x)) ?? cur);
    } catch {
      setItems((cur) => cur?.map((x) => (x.id === it.id ? { ...x, up: it.up, down: it.down, score: it.score, myVote: it.myVote } : x)) ?? cur);
    }
  };

  return (
    <div
      ref={box}
      className={`world ${tidy ? "tidy" : ""} ${items ? "ready" : ""}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".world-card, .world-bar")) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) {
          d.moved = true;
          // Capture only once it's a drag: capturing on press would send a plain click to the world
          // instead of the bubble under the pointer (Chrome retargets it).
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
      }}
      onPointerUp={() => {
        // Let the click that ends a drag see `moved`, then forget the drag.
        setTimeout(() => {
          drag.current = null;
        }, 0);
      }}
      onWheel={(e) => {
        const r = box.current!.getBoundingClientRect();
        const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
        setView((v) => {
          const z = Math.min(1.8, Math.max(0.35, v.z * Math.exp(-e.deltaY * 0.0015)));
          // Zoom around the cursor.
          return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z };
        });
      }}
    >
      <div className={`world-plane ${gliding ? "glide" : ""}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {all.map((it) => {
          const p = pos.get(it.id);
          if (!p) return null;
          const yours = it.id === wishId;
          const dist = Math.hypot(p.x, p.y);
          return (
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSel(it.id);
                }
              }}
              className={`wbub ${yours ? "yours" : ""} ${sel === it.id ? "on" : ""} ${yours && !landed ? "waiting" : ""}`}
              style={{
                left: p.x, top: p.y, width: p.size, height: p.size,
                ["--depth" as string]: p.depth, ["--par" as string]: (1.1 - p.depth) * 18,
                ["--bob" as string]: `${5 + hash(it.id) * 3}s`, ["--d" as string]: `${-hash(it.id + "d") * 6}s`,
                ["--in" as string]: `${Math.round(dist * 0.9)}ms`, ["--k" as string]: `${(order.get(it.id) ?? 0) * 22}ms`,
              }}
              onClick={() => {
                if (!drag.current?.moved) setSel(it.id);
              }}
              aria-label={`${yours ? "Your wish: " : ""}${it.title}, ${it.score} votes`}
            >
              <span className="wbub-float">
                <span className="wbub-glass">
                  {it.thumb ? <img src={it.thumb} alt="" draggable={false} /> : <CategoryIcon category={it.category ?? "generic"} size={p.size * 0.45} />}
                </span>
              </span>
              {yours && <span className="wbub-tag">Your wish</span>}
              {/* Name and net votes (vote right here): on hover while floating, always when organized. */}
              <span className="wbub-meta">
                <span className="wbub-name" title={it.title}>{it.title}</span>
                <span className="wbub-votes">
                  <button className={`wbv ${it.myVote === 1 ? "on up" : ""}`} aria-label="Upvote" aria-pressed={it.myVote === 1} onClick={(e) => { e.stopPropagation(); void vote(it, 1); }}><Arrow size={15} /></button>
                  <b>{fmt(it.score)}</b>
                  <button className={`wbv ${it.myVote === -1 ? "on down" : ""}`} aria-label="Downvote" aria-pressed={it.myVote === -1} onClick={(e) => { e.stopPropagation(); void vote(it, -1); }}><Arrow down size={15} /></button>
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {items && all.length <= 1 && <p className="world-empty">No other wishes floating here yet. Yours is the first.</p>}

      {selected && (
        <div className="world-pop" role="dialog" aria-label={selected.title} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
          <div className="world-card">
            <button className="world-close" aria-label="Close" onClick={() => setSel(null)}>×</button>
            <div className="world-card-model">
              {selected.thumb ? <img src={selected.thumb} alt="" /> : <CategoryIcon category={selected.category ?? "generic"} size={120} />}
            </div>
            <div className="world-card-body">
              {selected.id === wishId && <span className="world-kicker">Your wish</span>}
              <h2 title={selected.title}>{selected.title}</h2>
              {selected.description && <p className="world-desc">{selected.description}</p>}
              {selected.priceUsd != null && <p className="world-price">Around ${Math.round(selected.priceUsd)}</p>}
              <div className="world-votes">
                <span className="wv-group" role="group" aria-label="Vote">
                  <button className={`wv up ${selected.myVote === 1 ? "on" : ""}`} aria-pressed={selected.myVote === 1} aria-label="Upvote" onClick={() => void vote(selected, 1)}><Arrow /></button>
                  <b className="wv-score" aria-label={`${selected.score} votes`}>{fmt(selected.score)}</b>
                  <button className={`wv down ${selected.myVote === -1 ? "on" : ""}`} aria-pressed={selected.myVote === -1} aria-label="Downvote" onClick={() => void vote(selected, -1)}><Arrow down /></button>
                </span>
                {selected.id !== wishId && (
                  <button className="wv-remix" onClick={() => onRemix(selected.id)}>
                    Remix
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
                  </button>
                )}
              </div>
              {selected.id === wishId ? (
                <button className="pill world-launch" onClick={onLaunch}>Make it real: launch a campaign</button>
              ) : selected.campaignId ? (
                <a className="pill world-launch" href={`/c/${selected.campaignId}`}>Back this wish</a>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="world-bar">
        <button className="pill world-organize" onClick={() => {
          setTidy((t) => !t);
          setSel(null);
          setGliding(true);
          setView({ x: 0, y: 0, z: tidy ? 1 : 0.75 });
        }}>
          {tidy ? "Let them float" : "Organize"}
        </button>
      </div>
    </div>
  );
}
