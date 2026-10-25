import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldItem } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { voterId } from "./Upvote.tsx";
import { CategoryIcon } from "./Icons.tsx";

/**
 * The wish world: your bubble flies in among past wishes that didn't exist yet. Drag to pan, scroll to
 * zoom, click a bubble to center it and see its details and votes. "Organize" lines them up by
 * popularity; "Let them float" scatters them again (most popular nearest the middle).
 */

type Pos = { x: number; y: number; size: number };
const YOUR_SIZE = 200;

/** Small stable hash, for per-bubble jitter and bobbing that doesn't change between renders. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

function floating(items: WorldItem[], yours: string): Map<string, Pos> {
  const out = new Map<string, Pos>();
  out.set(yours, { x: 0, y: 0, size: YOUR_SIZE });
  const others = items.filter((it) => it.id !== yours);
  const top = Math.max(1, ...others.map((it) => it.score));
  others.forEach((it, i) => {
    // A sunflower spiral: the most popular sit closest to your wish.
    const n = i + 1;
    const r = 175 * Math.sqrt(n) + 40;
    const a = n * 2.39996 + hash(it.id) * 0.5;
    const size = 104 + 70 * Math.max(0, it.score) / top;
    out.set(it.id, { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8, size });
  });
  return out;
}

function organized(items: WorldItem[]): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const sorted = [...items].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.6)));
  const rows = Math.ceil(sorted.length / cols);
  const cell = 210;
  sorted.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    out.set(it.id, { x: (c - (cols - 1) / 2) * cell, y: (r - (rows - 1) / 2) * cell, size: 150 });
  });
  return out;
}

export function WishWorld({ wishId, yourTitle, yourThumb, landed, onLaunch, onEdit }: {
  wishId: string;
  yourTitle: string;
  yourThumb: string | null;
  /** Your bubble has arrived (until then the 3D bubble flying in stands in for it). */
  landed: boolean;
  onLaunch: () => void;
  onEdit: () => void;
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
      ...(mine ?? { id: wishId, description: null, category: null, priceUsd: null, score: 0, up: 0, down: 0, myVote: 0, campaignId: null, createdAt: Date.now() }),
      title: yourTitle,
      thumb: yourThumb ?? mine?.thumb ?? null,
    } as WorldItem;
    return [you, ...items.filter((it) => it.id !== wishId)];
  }, [items, wishId, yourTitle, yourThumb]);
  const pos = useMemo(() => (tidy ? organized(all) : floating(all, wishId)), [all, tidy, wishId]);
  const selected = all.find((it) => it.id === sel) ?? null;

  /** Glide the view so this world point sits at the middle of the free space (left of the panel). */
  const centerOn = (p: { x: number; y: number }, z = view.z) => {
    const w = box.current?.clientWidth ?? 1200;
    const panel = w > 900 ? 380 : 0;
    setGliding(true);
    setView({ x: -p.x * z - panel / 2, y: -p.y * z, z });
  };
  useEffect(() => {
    if (!gliding) return;
    const t = setTimeout(() => setGliding(false), 650);
    return () => clearTimeout(t);
  }, [gliding, view]);

  const pick = (it: WorldItem) => {
    if (drag.current?.moved) return;
    setSel(it.id);
    const p = pos.get(it.id);
    if (p) centerOn(p, Math.max(view.z, 1));
  };

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
      className={`world ${tidy ? "tidy" : ""}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".world-panel, .world-bar")) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
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
      onClick={(e) => {
        if (e.target === e.currentTarget && !drag.current?.moved) setSel(null);
      }}
    >
      <div className={`world-plane ${gliding ? "glide" : ""}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {all.map((it) => {
          const p = pos.get(it.id);
          if (!p) return null;
          const yours = it.id === wishId;
          return (
            <button
              key={it.id}
              className={`wbub ${yours ? "yours" : ""} ${sel === it.id ? "on" : ""} ${yours && !landed ? "waiting" : ""}`}
              style={{ left: p.x, top: p.y, width: p.size, height: p.size, ["--bob" as string]: `${4 + hash(it.id) * 3}s`, ["--d" as string]: `${-hash(it.id + "d") * 5}s` }}
              onClick={() => pick(it)}
              aria-label={`${yours ? "Your wish: " : ""}${it.title}, ${it.score} votes`}
            >
              <span className="wbub-glass">
                {it.thumb ? <img src={it.thumb} alt="" draggable={false} /> : <CategoryIcon category={it.category ?? "generic"} size={p.size * 0.45} />}
              </span>
              <span className={`wbub-score ${it.score > 0 ? "up" : it.score < 0 ? "down" : ""}`}>▲ {it.score}</span>
              {yours && <span className="wbub-tag">Your wish</span>}
            </button>
          );
        })}
      </div>

      {items && all.length <= 1 && <p className="world-empty">No other wishes floating here yet. Yours is the first.</p>}

      {selected && (
        <aside className="world-panel" aria-label={selected.title}>
          <button className="world-close" aria-label="Close" onClick={() => setSel(null)}>×</button>
          {selected.thumb && <img className="world-thumb" src={selected.thumb} alt="" />}
          <span className="world-kicker">{selected.id === wishId ? "Your wish" : "Wished by someone"}</span>
          <h2>{selected.title}</h2>
          {selected.description && <p className="world-desc">{selected.description}</p>}
          {selected.priceUsd != null && <p className="world-price">Around ${Math.round(selected.priceUsd)}</p>}
          <div className="world-votes" role="group" aria-label="Vote">
            <button className={`wv up ${selected.myVote === 1 ? "on" : ""}`} aria-pressed={selected.myVote === 1} aria-label="Upvote" onClick={() => void vote(selected, 1)}>▲</button>
            <span className="wv-score">{selected.score}</span>
            <button className={`wv down ${selected.myVote === -1 ? "on" : ""}`} aria-pressed={selected.myVote === -1} aria-label="Downvote" onClick={() => void vote(selected, -1)}>▼</button>
            <span className="wv-split">{selected.up} up · {selected.down} down</span>
          </div>
          {selected.id === wishId ? (
            <div className="world-actions">
              <button className="pill world-launch" onClick={onLaunch}>Make it real: launch a campaign</button>
              <button className="chip" onClick={onEdit}>Keep editing</button>
            </div>
          ) : selected.campaignId ? (
            <a className="pill world-launch" href={`/c/${selected.campaignId}`}>Back this wish</a>
          ) : null}
        </aside>
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
