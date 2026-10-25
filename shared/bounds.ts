import { isEnumParam, kitById } from "./kit.ts";
import { displayBox } from "./modules/display.ts";
import { MESH_MODELS } from "./meshes.ts";
import { subtreeIds, type Part, type Product } from "./product.ts";
import { toPartSpace, toProductSpace } from "./frames.ts";
import { svgOutline } from "./svgpath.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Approximate bounding boxes without three.js, matching how the renderer builds each geometry
 * (centered boxes, cylinders and capsules along Y, lathes around Y, extrudes centered on Z).
 * Boxes are conservative: a torus arc or a partial lathe gets its full-ring box.
 */

export interface Box { min: Vec3; max: Vec3 }

/** The part's own geometry in its local frame (before its transform). */
export function localBox(part: Part): Box | null {
  if (part.kind === "mesh") {
    const [model, node] = (part.meshAsset ?? "").split("/");
    const b = MESH_MODELS[model]?.bounds?.[node];
    return b ? { min: [...b.min], max: [...b.max] } : null;
  }
  if (part.kind === "kit") {
    const kit = part.kitAsset ? kitById(part.kitAsset) : undefined;
    if (!kit) return null;
    if (part.kitPath?.length) {
      // A path kit hugs its path: the path's box, padded by the kit's thickness.
      const pad = Math.max(0.002, Math.min(kit.size[1], kit.size[2]) / 2);
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const q of part.kitPath) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], q[i] - pad);
        max[i] = Math.max(max[i], q[i] + pad);
      }
      return { min, max };
    }
    const shown = kit.family === "display" ? displayBox(kit.id, part.kitParams) : null;
    if (shown) return shown;
    const s: Vec3 = [...kit.size];
    // Size-like params stretch the catalog box: length along X, height along Y, radius everywhere.
    for (const [name, spec] of Object.entries(kit.params ?? {})) {
      const v = part.kitParams?.[name];
      if (typeof v !== "number" || isEnumParam(spec) || !spec.default) continue;
      const k = v / spec.default;
      if (name === "length") s[0] *= k;
      else if (name === "height") s[1] *= k;
      else if (name === "radius") for (let i = 0; i < 3; i++) s[i] *= k;
    }
    return { min: [-s[0] / 2, -s[1] / 2, -s[2] / 2], max: [s[0] / 2, s[1] / 2, s[2] / 2] };
  }
  const g = part.geometry;
  if (!g) return null;
  const sym = (x: number, y: number, z: number): Box => ({ min: [-x, -y, -z], max: [x, y, z] });
  switch (g.type) {
    case "roundedBox":
      return sym(g.params.width / 2, g.params.height / 2, g.params.depth / 2);
    case "cylinder": {
      const r = Math.max(g.params.radiusTop, g.params.radiusBottom);
      return sym(r, g.params.height / 2, r);
    }
    case "capsule":
      return sym(g.params.radius, g.params.length / 2 + g.params.radius, g.params.radius);
    case "sphere": {
      const r = g.params.radius;
      // A dome sweeps down from the top: angle 90 stops at the equator.
      const low = g.params.angle >= 90 ? (g.params.angle >= 180 ? -r : -r * Math.sin(((g.params.angle - 90) * Math.PI) / 180)) : r * Math.cos((g.params.angle * Math.PI) / 180);
      const w = g.params.angle >= 90 ? r : r * Math.sin((g.params.angle * Math.PI) / 180);
      return { min: [-w, low, -w], max: [w, r, w] };
    }
    case "torus": {
      const o = g.params.radius + g.params.tube;
      return sym(o, o, g.params.tube);
    }
    case "lathe": {
      const pts = g.params.points;
      const r = Math.max(...pts.map((p) => p[0])) * (1 + (g.params.fluteDepth ?? 0));
      return { min: [-r, Math.min(...pts.map((p) => p[1])), -r], max: [r, Math.max(...pts.map((p) => p[1])), r] };
    }
    case "extrude": {
      const drawn = g.params.svg ? svgOutline(g.params.svg, g.params.width ?? 0.05) : null;
      if (drawn) return { min: [-drawn.width / 2, -drawn.height / 2, -g.params.depth / 2], max: [drawn.width / 2, drawn.height / 2, g.params.depth / 2] };
      const xs = g.params.shape.map((p) => p[0]), ys = g.params.shape.map((p) => p[1]);
      const b = g.params.bevel ?? 0;
      return { min: [Math.min(...xs) - b, Math.min(...ys) - b, -g.params.depth / 2], max: [Math.max(...xs) + b, Math.max(...ys) + b, g.params.depth / 2] };
    }
    case "text": {
      const lines = g.params.text.split("\n");
      const natural = Math.max(...lines.map((l) => l.length)) * g.params.size * 0.72;
      const k = g.params.width && natural > g.params.width ? g.params.width / natural : 1;
      const w = (natural * k) / 2;
      const h = (k * g.params.size * (1 + 1.4 * (lines.length - 1))) / 2;
      return { min: [-w, -h, -g.params.depth / 2], max: [w, h, g.params.depth / 2] };
    }
    case "tube": {
      const r = g.params.width ? Math.max(g.params.width / 2, g.params.radius) : g.params.radius;
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const p of g.params.points) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i] - r);
        max[i] = Math.max(max[i], p[i] + r);
      }
      return { min, max };
    }
  }
  return null;
}

/** The part's own geometry, as an axis-aligned box in product space; an intersected part is clipped to what it keeps. */
export function partBox(product: Product, id: string): Box | null {
  const own = rawBox(product, id);
  if (!own) return null;
  for (const c of Object.values(product.parts)) {
    if (c.csg?.op !== "intersect" || c.csg.withPartId !== id) continue;
    const k = rawBox(product, c.id);
    // A tool that misses the part keeps nothing; the renderer ignores it, and so do the bounds.
    if (!k || [0, 1, 2].some((i) => Math.min(own.max[i], k.max[i]) <= Math.max(own.min[i], k.min[i]))) continue;
    for (let i = 0; i < 3; i++) {
      own.min[i] = Math.max(own.min[i], k.min[i]);
      own.max[i] = Math.min(own.max[i], k.max[i]);
    }
  }
  return own;
}

function rawBox(product: Product, id: string): Box | null {
  const part = product.parts[id];
  const local = part && localBox(part);
  if (!local) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const corner: Vec3 = [c & 1 ? local.max[0] : local.min[0], c & 2 ? local.max[1] : local.min[1], c & 4 ? local.max[2] : local.min[2]];
    const p = toProductSpace(product, id, corner);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return { min, max };
}

/** Distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box, b: Box): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d += Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]) ** 2;
  return Math.sqrt(d);
}

/** Cutters: parts that only exist to be carved out of another part (`csg.withPartId`), never drawn. */
function cutterIds(product: Product): Set<string> {
  return new Set(Object.values(product.parts).filter((p) => p.csg).map((p) => p.id));
}

/** The whole product's box. */
export function productBox(product: Product): Box | null {
  const cutters = cutterIds(product);
  let out: Box | null = null;
  for (const id of Object.keys(product.parts)) {
    if (cutters.has(id)) continue;
    const b = partBox(product, id);
    if (!b) continue;
    out = out ? { min: out.min.map((v, i) => Math.min(v, b.min[i])) as Vec3, max: out.max.map((v, i) => Math.max(v, b.max[i])) as Vec3 } : b;
  }
  return out;
}

/** How far a gap must be before a part counts as floating: a few mm, more on big products. */
function contactTolerance(product: Product): number {
  const b = productBox(product);
  const extent = b ? Math.max(...b.max.map((v, i) => v - b.min[i])) : 0.3;
  return Math.max(0.004, 0.012 * extent);
}

/**
 * Parts that touch nothing: not their parent, not any other part outside their own subtree.
 * Children of a floating part come along with it, so only the topmost floating part is listed.
 */
export function floatingParts(product: Product, only?: Iterable<string>): string[] {
  const tol = contactTolerance(product);
  const cutters = cutterIds(product);
  const boxes = new Map<string, Box>();
  for (const id of Object.keys(product.parts)) {
    if (cutters.has(id)) continue;
    const b = partBox(product, id);
    if (b) boxes.set(id, b);
  }
  const out: string[] = [];
  const candidates = only ? [...only] : Object.keys(product.parts);
  for (const id of candidates) {
    const part = product.parts[id];
    const box = boxes.get(id);
    if (!part?.parent || !box) continue;
    const mine = new Set(subtreeIds(product, id));
    let touching = false;
    for (const [other, b] of boxes) {
      if (mine.has(other)) continue;
      if (boxGap(box, b) <= tol) {
        touching = true;
        break;
      }
    }
    if (!touching) out.push(id);
  }
  return out;
}

/**
 * Where a floating part should go (a new position in its parent's frame), or null when it touches
 * something already. Two fixes, in order:
 *  1. the position was written in product space instead of the parent's frame (a common slip):
 *     read it that way if that lands it on the product;
 *  2. otherwise slide it straight toward the nearest part until it sits a little into its surface.
 */
export function groundPart(product: Product, id: string): Vec3 | null {
  const part = product.parts[id];
  if (!part?.parent || !product.parts[part.parent]) return null;
  const tol = contactTolerance(product);
  const cutters = cutterIds(product);
  const mine = new Set(subtreeIds(product, id));
  const others: Box[] = [];
  for (const oid of Object.keys(product.parts)) {
    if (mine.has(oid) || cutters.has(oid)) continue;
    const b = partBox(product, oid);
    if (b) others.push(b);
  }
  const box = partBox(product, id);
  if (!box || !others.length) return null;
  const nearest = (b: Box) => others.reduce((best, o) => (boxGap(b, o) < boxGap(b, best) ? o : best), others[0]);
  if (boxGap(box, nearest(box)) <= tol) return null;

  const round = (v: Vec3) => v.map((x) => Math.round(x * 1000) / 1000) as Vec3;
  const at = (position: Vec3): Product => ({ ...product, parts: { ...product.parts, [id]: { ...part, transform: { ...part.transform, position } } } });

  // 1. Product-space slip.
  const asProduct = round(toPartSpace(product, part.parent, part.transform.position));
  const slipped = partBox(at(asProduct), id);
  if (slipped && boxGap(slipped, nearest(slipped)) <= tol) return asProduct;

  // 2. Slide toward the nearest part, along each separated axis, sinking in by a fifth of the
  //    part's own thickness on that axis (capped) so curved surfaces still meet it.
  const target = nearest(box);
  const delta: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const sink = Math.min(0.2 * (box.max[i] - box.min[i]), 0.01);
    if (box.min[i] > target.max[i]) delta[i] = target.max[i] - box.min[i] - sink;
    else if (box.max[i] < target.min[i]) delta[i] = target.min[i] - box.max[i] + sink;
  }
  const origin = toProductSpace(product, part.parent, part.transform.position);
  return round(toPartSpace(product, part.parent, [origin[0] + delta[0], origin[1] + delta[1], origin[2] + delta[2]]));
}

// ---------- Levels: big flat parts that people sit on or set things on ----------

/** Overlap length of two boxes on one axis (negative when apart). */
const overlap = (a: Box, b: Box, i: number) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
const ext = (b: Box, i: number) => b.max[i] - b.min[i];

/**
 * A level: flat (no taller than half its narrower side) and covering a good share of the product's
 * footprint, like a bunk's upper deck, a shelf or a tabletop. Those must rest on something and must
 * not slice through what's below them.
 */
function isLevel(part: Part, box: Box, all: Box): boolean {
  // Slabs and discs; rings, bands and shells (a waistband, a mug's rim) have open middles.
  const t = part.geometry?.type;
  if (part.kind !== "primitive" || (t !== "roundedBox" && t !== "cylinder" && t !== "extrude")) return false;
  const w = ext(box, 0), d = ext(box, 2);
  return ext(box, 1) <= 0.5 * Math.min(w, d) && w * d >= 0.25 * ext(all, 0) * ext(all, 2);
}

/** Tall and thin: posts, rails, legs, side arms. Levels may pass through these. */
const isPost = (b: Box) => ext(b, 1) >= 2.5 * Math.min(ext(b, 0), ext(b, 2));

export type LevelIssue =
  /** Its underside is inside `others` (cushions below a bunk's deck): it needs to sit above `clearY`. */
  | { kind: "cuts"; id: string; others: string[]; clearY: number }
  /** Nothing holds it up, but `below` sits under it, `gap` meters down; `posts` are supports to stretch up. */
  | { kind: "hovers"; id: string; gap: number; below: string[]; posts: string[] }
  /** It runs into `other`, a part of similar size, filling `share` of the smaller one's box. */
  | { kind: "collides"; id: string; other: string; share: number };

function solidBoxes(product: Product): Map<string, Box> {
  const cutters = cutterIds(product);
  const boxes = new Map<string, Box>();
  for (const id of Object.keys(product.parts)) {
    if (cutters.has(id)) continue;
    const b = partBox(product, id);
    if (b) boxes.set(id, b);
  }
  return boxes;
}

/**
 * Levels (see isLevel) among `only` that slice through other parts or hover above their supports.
 * A level is held up when any part of its subtree rests on the ground, sits on or in something below,
 * hangs from something above, or is clamped along a whole side (a shelf between two panels).
 */
export function levelIssues(product: Product, only?: Iterable<string>): LevelIssue[] {
  const all = productBox(product);
  if (!all) return [];
  const tol = contactTolerance(product);
  const boxes = solidBoxes(product);
  const out: LevelIssue[] = [];
  const ancestors = (id: string) => {
    const up = new Set<string>();
    for (let p = product.parts[id]?.parent; p && !up.has(p); p = product.parts[p]?.parent) up.add(p);
    return up;
  };
  for (const id of only ?? Object.keys(product.parts)) {
    const part = product.parts[id];
    const box = boxes.get(id);
    if (!part?.parent || !box || !isLevel(part, box, all)) continue;
    const mine = new Set(subtreeIds(product, id));
    const up = ancestors(id);
    const others = [...boxes].filter(([o]) => !mine.has(o));

    // Slicing through: its underside is well inside a bulky part it spans (a deck through the cushions
    // below it). Not posts or panels, not its parents, not small fittings, not parts sitting on top.
    const area = ext(box, 0) * ext(box, 2);
    const cut = others.filter(([o, b]) => {
      if (up.has(o) || isPost(b) || ext(b, 0) * ext(b, 2) < 0.05 * area) return false;
      const m = Math.max(tol, 0.15 * ext(b, 1));
      const shared = Math.max(0, overlap(box, b, 0)) * Math.max(0, overlap(box, b, 2));
      // It covers most of the part, rather than sitting inside it (a drawer's floor in its carcass).
      const spans = shared >= 0.3 * ext(b, 0) * ext(b, 2) && shared < 0.9 * area;
      return spans && b.min[1] + m < box.min[1] && box.min[1] < b.max[1] - m;
    });
    if (cut.length) {
      out.push({ kind: "cuts", id, others: cut.map(([o]) => o), clearY: Math.max(...cut.map(([, b]) => b.max[1])) });
      continue;
    }

    // Held up?
    const held = [...mine].some((q) => {
      const qb = boxes.get(q);
      if (!qb) return false;
      if (qb.min[1] <= all.min[1] + tol) return true;
      return others.some(([, b]) => {
        if (boxGap(qb, b) > tol) return false;
        const xo = overlap(qb, b, 0), zo = overlap(qb, b, 2);
        if (xo > 0 && zo > 0) {
          if (b.min[1] - tol <= qb.min[1] && qb.min[1] <= b.max[1] + tol) return true; // on or in it
          if (Math.abs(b.min[1] - qb.max[1]) <= tol) return true; // hanging from it
        }
        // Clamped along a side: the contact runs most of the way along it, over most of its thickness.
        return overlap(qb, b, 1) >= 0.5 * ext(qb, 1) && (xo >= 0.5 * ext(qb, 0) || zo >= 0.5 * ext(qb, 2));
      });
    });
    if (held) continue;
    const bottom = Math.min(...[...mine].map((q) => boxes.get(q)?.min[1] ?? Infinity));
    const below = others.filter(([, b]) => overlap(box, b, 0) > 0 && overlap(box, b, 2) > 0 && b.max[1] < bottom);
    if (!below.length) continue;
    const top = Math.max(...below.map(([, b]) => b.max[1]));
    const highest = below.filter(([, b]) => b.max[1] >= top - tol);
    out.push({
      kind: "hovers",
      id,
      gap: bottom - top,
      below: highest.map(([o]) => o),
      posts: highest.filter(([, b]) => isPost(b) && ext(b, 0) * ext(b, 2) < 0.25 * ext(box, 0) * ext(box, 2)).map(([o]) => o),
    });
  }
  return out;
}

/** The part's new position (in its parent's frame) after moving it by `d` in product space. */
export function movedBy(product: Product, id: string, d: Vec3): Vec3 | null {
  const part = product.parts[id];
  if (!part?.parent) return null;
  const at = toProductSpace(product, part.parent, part.transform.position);
  return toPartSpace(product, part.parent, [at[0] + d[0], at[1] + d[1], at[2] + d[2]]).map((x) => Math.round(x * 1000) / 1000) as Vec3;
}

type Update = { op: "update"; id: string; changes: { geometry?: { params: Record<string, number> }; transform: { position: Vec3 } } };

/**
 * Updates that grow an upright post `dy` meters taller with its foot where it is, children at its top
 * riding up with the top. Null when it can't: not a box, cylinder or capsule, or not upright.
 */
export function stretchUp(product: Product, id: string, dy: number): Update[] | null {
  const part = product.parts[id];
  const g = part?.geometry;
  const key = g?.type === "roundedBox" || g?.type === "cylinder" ? "height" : g?.type === "capsule" ? "length" : null;
  if (!part?.parent || !g || !key) return null;
  const o = toProductSpace(product, id, [0, 0, 0]), u = toProductSpace(product, id, [0, 1, 0]);
  const s = u[1] - o[1];
  if (s <= 0 || Math.abs(u[0] - o[0]) > 0.02 * s || Math.abs(u[2] - o[2]) > 0.02 * s) return null;
  const position = movedBy(product, id, [0, dy / 2, 0]);
  if (!position) return null;
  const h = (g.params as Record<string, number>)[key];
  const grow = dy / s;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const out: Update[] = [{ op: "update", id, changes: { geometry: { params: { [key]: round(h + grow) } }, transform: { position } } }];
  for (const c of Object.values(product.parts)) {
    if (c.parent !== id || Math.abs(c.transform.position[1]) < h / 4) continue;
    const [x, y, z] = c.transform.position;
    out.push({ op: "update", id: c.id, changes: { transform: { position: [x, round(y + Math.sign(y) * grow / 2), z] } } });
  }
  return out;
}

const volume = (b: Box) => ext(b, 0) * ext(b, 1) * ext(b, 2);
/** Share of the smaller box that the two boxes have in common. */
function overlapShare(a: Box, b: Box): number {
  const v = Math.max(0, overlap(a, b, 0)) * Math.max(0, overlap(a, b, 1)) * Math.max(0, overlap(a, b, 2));
  return v / Math.max(1e-9, Math.min(volume(a), volume(b)));
}

/**
 * Collisions an edit just made: a part in `only` now deeply overlaps a part of similar size (a new
 * upper seat inside a pillow) that it didn't overlap before. Pairs that already overlapped stay
 * (designs tuck cushions into each other on purpose), as do pairs of parts added together (a charm's
 * head and body), parents, posts and small fittings set into bigger parts (a cup holder in an
 * armrest). Boxes are coarse, so only big overlaps count.
 */
export function newCollisions(before: Product, after: Product, only: Iterable<string>): LevelIssue[] {
  const now = solidBoxes(after);
  const was = solidBoxes(before);
  const out: LevelIssue[] = [];
  const seen = new Set<string>();
  // Solids only: a ring, a shell or a swept cord is mostly empty inside its box.
  const solid = (p?: Part) => p?.kind === "primitive" && ["roundedBox", "sphere", "capsule", "cylinder", "extrude"].includes(p.geometry?.type ?? "") && !(p.geometry?.type === "cylinder" && p.geometry.params.open);
  for (const id of only) {
    const box = now.get(id);
    if (!box || isPost(box) || !solid(after.parts[id])) continue;
    const mine = new Set(subtreeIds(after, id));
    for (let p = after.parts[id]?.parent; p && !mine.has(p); p = after.parts[p]?.parent) mine.add(p);
    for (const [o, b] of now) {
      if (mine.has(o) || isPost(b) || seen.has(`${o}|${id}`) || !solid(after.parts[o])) continue;
      const big = Math.max(volume(box), volume(b)), small = Math.min(volume(box), volume(b));
      if (small < big / 8) continue;
      const share = overlapShare(box, b);
      if (share < 0.5) continue;
      const pb = was.get(id), ob = was.get(o);
      if (!before.parts[id] && !before.parts[o]) continue;
      if (pb && ob && overlapShare(pb, ob) >= 0.2) continue;
      seen.add(`${id}|${o}`);
      out.push({ kind: "collides", id, other: o, share: Math.round(share * 100) / 100 });
    }
  }
  return out;
}
