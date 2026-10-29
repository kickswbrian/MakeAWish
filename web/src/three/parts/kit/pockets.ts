import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartMaterial } from "@wishit/shared";
import { METAL_OPTIONS, POCKET_OPTIONS as O, THREAD_OPTIONS } from "@wishit/shared/modules/pockets.ts";
import { getMaterial } from "../materials.ts";
import { boxProjectUVs } from "../uv.ts";
import { Acc, type Builder, M, type MatRef, type Params, type Piece, clamp, contrastThread, latheZ, luminance } from "./core.ts";
import { buttonSewn, snapButton } from "./fasteners.ts";

/**
 * Detail module builders: pockets (catalog entries in shared/modules/pockets.ts).
 *
 * Fabric panels are heightfields over a 2D outline: a rounded rim strip (the folded edge) plus a top
 * face refined to small triangles so the whole panel can bend onto a curved garment (`bend`), puff a
 * little, ramp over what it covers (flaps over pocket mouths) and carry stitching that sits exactly on
 * its surface. The toolkit is exported for the label builders.
 */

export type P2 = [number, number];
export type ZFn = (x: number, y: number) => number;

// ---------- Materials ----------

export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k <= 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), Math.min(1, k - 1));
  return `#${c.getHexString()}`;
}

const GOLD_THREAD: PartMaterial = { preset: "cotton", color: "#C68A3A" };
export const contrastMat = (m: PartMaterial) => getMaterial(contrastThread(m));
export const tonalMat = (m: PartMaterial) => getMaterial({ preset: "cotton", color: shade(m.color, luminance(m.color) > 0.3 ? 0.8 : 1.1) });
/** Thread by catalog option (contrast / gold / tonal). Stable refs so the Acc merges per thread. */
export function threadMat(i: number): MatRef {
  const k = THREAD_OPTIONS[Math.round(i)] ?? "contrast";
  return k === "gold" ? GOLD_THREAD : k === "tonal" ? tonalMat : contrastMat;
}

export const METAL_MATS: Record<string, PartMaterial> = {
  copper: { preset: "metal_polished", color: "#A86A43", roughness: 0.38 },
  brass: M.brass,
  nickel: M.steel,
  gunmetal: { preset: "metal_polished", color: "#4A4C52", roughness: 0.3 },
  black: { preset: "metal_brushed", color: "#2A2A2E", roughness: 0.5 },
};
export const metalMat = (i: number): PartMaterial => METAL_MATS[METAL_OPTIONS[Math.round(i)] ?? "brass"] ?? M.brass;

/** The fabric seen inside a pocket mouth: same cloth, in shadow. */
export const insideMat = (m: PartMaterial) => getMaterial({ ...m, color: shade(m.color, 0.42) });
/** A slit's dark gap. */
export const gapMat = (m: PartMaterial) => getMaterial({ preset: "cotton", color: shade(m.color, 0.16) });
/** Sewn buttons: a darker gloss version of the fabric color. */
const buttonMat = (m: PartMaterial) => getMaterial({ preset: "plastic_gloss", color: shade(m.color, luminance(m.color) > 0.5 ? 0.82 : 0.62) });

export const opt = (list: string[], i: number): string => list[Math.round(i)] ?? list[0];

// ---------- 2D outlines ----------

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoothstep = (a: number, b: number, x: number) => smooth01((x - a) / (b - a));

export function signedArea(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const ccw = (pts: P2[]): P2[] => (signedArea(pts) < 0 ? [...pts].reverse() : pts);

/** Split segments longer than `step` (keeps every input vertex). */
export function resample(pts: P2[], step: number, closed = true): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-7) continue;
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Offset a polyline: positive d moves to the LEFT of the travel direction (inward for a CCW
 * outline). Mitered at corners (capped so sharp tips don't spike). Keeps one point per input point
 * unless `clean` (for stitch paths), which drops the loops an inset folds into past tight corners.
 */
export function offsetPoly(pts: P2[], d: number, closed = true, clean = false): P2[] {
  const n = pts.length;
  const left = (a: P2, b: P2): P2 => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const res = pts.map((p, i): P2 => {
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const n1 = hasPrev ? left(prev, p) : left(p, next);
    const n2 = hasNext ? left(p, next) : n1;
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const c = Math.max(0.5, nx * n1[0] + ny * n1[1]);
    return [p[0] + (nx * d) / c, p[1] + (ny * d) / c];
  });
  if (!clean) return res;
  // Insetting past a corner's radius folds the curve back on itself: drop points that run backwards.
  const keep: P2[] = [res[0]];
  let last = 0;
  for (let i = 1; i < n; i++) {
    const a = keep[keep.length - 1];
    const ox = pts[i][0] - pts[last][0], oy = pts[i][1] - pts[last][1];
    if ((res[i][0] - a[0]) * ox + (res[i][1] - a[1]) * oy > 0 || (!closed && i === n - 1)) {
      keep.push(res[i]);
      last = i;
    }
  }
  return keep.length >= (closed ? 3 : 2) ? keep : res;
}

/** Round polygon corners: corner i gets radius r (or r[i]); 0 keeps it sharp. */
export function fillet(pts: P2[], r: number | number[], segs = 8): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let ri = typeof r === "number" ? r : (r[i] ?? 0);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d1: P2 = [(a[0] - p[0]) / la, (a[1] - p[1]) / la], d2: P2 = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const th = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
    if (ri <= 0 || th > Math.PI - 0.02) {
      out.push(p);
      continue;
    }
    let t = ri / Math.tan(th / 2);
    const tMax = 0.48 * Math.min(la, lb);
    if (t > tMax) {
      t = tMax;
      ri = t * Math.tan(th / 2);
    }
    const bis: P2 = [d1[0] + d2[0], d1[1] + d2[1]];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    const h = ri / Math.sin(th / 2);
    const c: P2 = [p[0] + (bis[0] / bl) * h, p[1] + (bis[1] / bl) * h];
    const s: P2 = [p[0] + d1[0] * t, p[1] + d1[1] * t], e: P2 = [p[0] + d2[0] * t, p[1] + d2[1] * t];
    const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let da = Math.atan2(e[1] - c[1], e[0] - c[0]) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let k = 0; k <= segs; k++) out.push([c[0] + Math.cos(a0 + (da * k) / segs) * ri, c[1] + Math.sin(a0 + (da * k) / segs) * ri]);
  }
  return out;
}

/** Distance from (x, y) to a polyline (closed: the outline). */
export function distToPoly(pts: P2[], x: number, y: number, closed = true): number {
  let best = Infinity;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1) : 0;
    const ex = a[0] + dx * t - x, ey = a[1] + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function inside(pts: P2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Arc-length walker over a polyline. */
export class Poly {
  readonly cum: number[] = [0];
  readonly length: number;
  constructor(readonly pts: P2[], readonly closed = false) {
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.cum.push(this.cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }
  /** Point and unit tangent at arc length s. */
  at(s: number): { x: number; y: number; tx: number; ty: number } {
    const L = this.length;
    s = this.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const n = this.pts.length;
    const a = this.pts[lo], b = this.pts[(lo + 1) % n];
    const sl = this.cum[lo + 1] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / sl;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / sl, ty: (b[1] - a[1]) / sl };
  }
}

// ---------- Triangulation ----------

/** Grid lines from lo to hi whose spacing follows step(v) (smoothly, never below 0.2 mm). */
function axisLines(lo: number, hi: number, step: (v: number) => number): number[] {
  const out = [lo];
  let v = lo;
  while (v < hi - 1e-9) {
    v += Math.max(0.0002, step(v));
    out.push(Math.min(v, hi));
  }
  // Even out the last (possibly tiny) interval.
  if (out.length > 2 && out[out.length - 1] - out[out.length - 2] < 0.4 * (out[out.length - 2] - out[out.length - 3])) out.splice(out.length - 2, 1);
  return out;
}

/**
 * Triangulate a polygon (with optional holes) into small triangles so heightfields and bends have
 * vertices to move: a tensor grid fills the interior (column spacing from size(x, y), row spacing
 * from sizeY, so a horizontal hem line gets dense rows without dense columns), and earcut stitches
 * the band between the grid and the outline.
 */
export function triangulate(contour: P2[], holes: P2[][], size: ZFn, sizeY: ZFn = size): { xy: P2[]; tri: number[] } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of contour) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const NS = 24;
  const xs = axisLines(x0, x1, (x) => {
    let m = Infinity;
    for (let k = 0; k <= NS; k++) m = Math.min(m, size(x, y0 + ((y1 - y0) * k) / NS));
    return m;
  });
  const ys = axisLines(y0, y1, (y) => {
    let m = Infinity;
    for (let k = 0; k <= NS; k++) m = Math.min(m, sizeY(x0 + ((x1 - x0) * k) / NS, y));
    return m;
  });
  const nx = xs.length, ny = ys.length;
  const loops = [contour, ...holes];
  const keep: boolean[] = new Array(nx * ny).fill(false);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = xs[i], y = ys[j];
      if (!inside(contour, x, y) || holes.some((h) => inside(h, x, y))) continue;
      const h = Math.max(xs[Math.min(nx - 1, i + 1)] - xs[Math.max(0, i - 1)], ys[Math.min(ny - 1, j + 1)] - ys[Math.max(0, j - 1)]) / 2;
      if (loops.every((l) => distToPoly(l, x, y) > 0.55 * h)) keep[i * ny + j] = true;
    }
  }
  const cx = nx - 1, cy = ny - 1;
  const occ: boolean[] = new Array(cx * cy).fill(false);
  for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) occ[i * cy + j] = keep[i * ny + j] && keep[(i + 1) * ny + j] && keep[(i + 1) * ny + j + 1] && keep[i * ny + j + 1];
  const O = (i: number, j: number) => i >= 0 && j >= 0 && i < cx && j < cy && occ[i * cy + j];
  // Cells touching only diagonally would make a pinched hole loop: drop one of each such pair.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < cx - 1; i++) {
      for (let j = 0; j < cy - 1; j++) {
        const a = O(i, j), b = O(i + 1, j), c = O(i, j + 1), d = O(i + 1, j + 1);
        if (a && d && !b && !c) { occ[i * cy + j] = false; changed = true; }
        else if (b && c && !a && !d) { occ[(i + 1) * cy + j] = false; changed = true; }
      }
    }
  }
  const xy: P2[] = [];
  const tri: number[] = [];
  const gid = new Map<number, number>();
  const G = (i: number, j: number) => {
    const k = i * ny + j;
    let id = gid.get(k);
    if (id === undefined) {
      id = xy.length;
      xy.push([xs[i], ys[j]]);
      gid.set(k, id);
    }
    return id;
  };
  // Boundary edges of the occupied region, interior on the left, keyed by start vertex.
  const next = new Map<number, number>();
  for (let i = 0; i < cx; i++) {
    for (let j = 0; j < cy; j++) {
      if (!O(i, j)) continue;
      const a = G(i, j), b = G(i + 1, j), c = G(i + 1, j + 1), d = G(i, j + 1);
      tri.push(a, b, c, a, c, d);
      if (!O(i, j - 1)) next.set(i * ny + j, (i + 1) * ny + j);
      if (!O(i + 1, j)) next.set((i + 1) * ny + j, (i + 1) * ny + j + 1);
      if (!O(i, j + 1)) next.set((i + 1) * ny + j + 1, i * ny + j + 1);
      if (!O(i - 1, j)) next.set(i * ny + j + 1, i * ny + j);
    }
  }
  const gridLoops: P2[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: P2[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k);
      loop.push([xs[Math.floor(k / ny)], ys[k % ny]]);
      k = next.get(k);
    }
    if (loop.length >= 3) gridLoops.push(loop);
  }
  // Band between the outline (and its holes) and the grid region. Loops nest (a grid region can
  // ring a hole, a hole can sit in a grid void), so the band is triangulated per nesting level:
  // every loop at even depth is an outer boundary, the loops directly inside it are its holes.
  const all = [contour, ...holes, ...gridLoops];
  const depth = all.map((l, i) => all.reduce((n, o, j) => n + (j !== i && inside(o, l[0][0], l[0][1]) ? 1 : 0), 0));
  const faces: number[][] = [];
  const base = xy.length;
  const offs: number[] = [];
  for (const l of all) {
    offs.push(xy.length - base);
    xy.push(...l);
  }
  all.forEach((outer, i) => {
    if (depth[i] % 2) return;
    const kids = all.map((_, j) => j).filter((j) => depth[j] === depth[i] + 1 && inside(outer, all[j][0][0], all[j][0][1]));
    const f = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), kids.map((j) => all[j].map(([x, y]) => new THREE.Vector2(x, y))));
    // Map local indices (outer, then each kid) back to the shared vertex list.
    const map: number[] = [];
    for (let q = 0; q < outer.length; q++) map.push(offs[i] + q);
    for (const j of kids) for (let q = 0; q < all[j].length; q++) map.push(offs[j] + q);
    for (const t of f) faces.push([map[t[0]], map[t[1]], map[t[2]]]);
  });
  for (const [a, b, c] of faces) {
    let A = xy[base + a], B = xy[base + b], C = xy[base + c];
    const ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(ar) < 1e-14) continue;
    if (ar < 0) [B, C] = [C, B];
    // Earcut can leave long slivers along a narrow band; split them so a bend can't sink their middle:
    // a strip from the apex where the two longest edges meet (2n - 1 triangles), or a full grid for
    // a big fat triangle.
    const e = [Math.hypot(C[0] - B[0], C[1] - B[1]), Math.hypot(A[0] - C[0], A[1] - C[1]), Math.hypot(B[0] - A[0], B[1] - A[1])];
    const lim = 1.5 * Math.max(0.0008, size((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3));
    const n = Math.min(32, Math.ceil(Math.max(...e) / lim));
    const emit = (p: P2, q: P2, r: P2) => {
      tri.push(xy.length, xy.length + 1, xy.length + 2);
      xy.push(p, q, r);
    };
    if (n <= 1) {
      emit(A, B, C);
      continue;
    }
    const lerp2 = (p: P2, q: P2, t: number): P2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (Math.min(...e) > lim) {
      const P = (i: number, j: number): P2 => [A[0] + ((B[0] - A[0]) * i + (C[0] - A[0]) * j) / n, A[1] + ((B[1] - A[1]) * i + (C[1] - A[1]) * j) / n];
      for (let i = 0; i < n; i++) {
        for (let j = 0; i + j < n; j++) {
          emit(P(i, j), P(i + 1, j), P(i, j + 1));
          if (i + j < n - 1) emit(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
        }
      }
      continue;
    }
    // Apex = the vertex opposite the shortest edge (keeps CCW order by rotating the triple).
    const k = e.indexOf(Math.min(...e));
    const [V0, V1, V2] = k === 0 ? [A, B, C] : k === 1 ? [B, C, A] : [C, A, B];
    for (let i = 0; i < n; i++) {
      const p0 = lerp2(V0, V1, i / n), q0 = lerp2(V0, V2, i / n), p1 = lerp2(V0, V1, (i + 1) / n), q1 = lerp2(V0, V2, (i + 1) / n);
      if (i > 0) emit(p0, p1, q0);
      emit(q0, p1, q1);
    }
  }
  return { xy, tri };
}

// ---------- Fabric panels ----------

export interface PanelSpec {
  /** Closed outline (any winding). */
  outline: P2[];
  /** Thickness above the base. */
  t: number;
  /** Width of the rounded edge (default t). */
  rim?: number;
  /** Height of what the panel lies on (default 0, the garment). */
  base?: ZFn;
  /** Extra height on top (puff, hem steps), given the distance d to the outline. */
  lift?: (x: number, y: number, d: number) => number;
  /** Max triangle edge on the top face (default 3 mm). */
  size?: ZFn;
  /** Row spacing where it should be finer than size (horizontal features: hem lines). */
  sizeY?: ZFn;
  /** Outline sampling (default 1.2 mm). */
  step?: number;
  rings?: number;
  /** Holes cut through the panel (CCW or not), with a rounded rim of their own. */
  holes?: P2[][];
  /** Rim width around holes (default rim): small for crisp debossed / punched holes. */
  holeRim?: number;
}

export interface Panel {
  geo: THREE.BufferGeometry;
  /** Top surface height at (x, y). */
  z: ZFn;
  outline: P2[];
}

export function panel(s: PanelSpec): Panel {
  const step = s.step ?? 0.0012;
  const outline = resample(ccw(s.outline), step);
  const holes = (s.holes ?? []).map((h) => resample(ccw(h).reverse(), step));
  const rim = s.rim ?? s.t;
  const base = s.base ?? (() => 0);
  const lift = s.lift ?? (() => 0);
  const K = s.rings ?? 5;
  const dist = (x: number, y: number) => {
    let d = distToPoly(outline, x, y);
    for (const h of holes) d = Math.min(d, distToPoly(h, x, y));
    return d;
  };
  const top = (x: number, y: number, d: number) => (d >= rim ? s.t + lift(x, y, d) : Math.sin(Math.acos(1 - d / rim)) * (s.t + lift(x, y, rim)));
  const z: ZFn = (x, y) => base(x, y) + top(x, y, dist(x, y));
  const pos: number[] = [];
  const P = (x: number, y: number, zz: number) => pos.push(x, y, zz);
  // Rim: rings from a tucked edge (just under the base) to the cap boundary.
  const strip = (loop: P2[], rw = rim) => {
    const rings: { pts: P2[]; z: number[] }[] = [];
    rings.push({ pts: loop, z: loop.map(([x, y]) => base(x, y) - 0.0002) });
    for (let k = 0; k <= K; k++) {
      const a = (Math.PI / 2) * (k / K);
      const pts = offsetPoly(loop, rw * (1 - Math.cos(a)));
      rings.push({ pts, z: pts.map(([x, y]) => base(x, y) + Math.sin(a) * (s.t + lift(x, y, rim))) });
    }
    const n = loop.length;
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], C = rings[k + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        P(A.pts[i][0], A.pts[i][1], A.z[i]); P(A.pts[j][0], A.pts[j][1], A.z[j]); P(C.pts[j][0], C.pts[j][1], C.z[j]);
        P(A.pts[i][0], A.pts[i][1], A.z[i]); P(C.pts[j][0], C.pts[j][1], C.z[j]); P(C.pts[i][0], C.pts[i][1], C.z[i]);
      }
    }
    return rings[rings.length - 1].pts;
  };
  const cap = strip(outline);
  const capHoles = holes.map((h) => strip(h, s.holeRim ?? rim));
  const size = s.size ?? (() => 0.003);
  const { xy, tri } = triangulate(cap, capHoles, size, s.sizeY ?? size);
  const zs = xy.map(([x, y]) => base(x, y) + s.t + lift(x, y, Math.max(rim, dist(x, y))));
  for (const i of tri) P(xy[i][0], xy[i][1], zs[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return { geo, z, outline };
}

/** Miter-offset a sharp polygon (CCW): positive d insets. Exact for straight edges. */
export function offsetSharp(pts: P2[], d: number): P2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1: P2 = [-(p[1] - a[1]) / l1, (p[0] - a[0]) / l1], n2: P2 = [-(b[1] - p[1]) / l2, (b[0] - p[0]) / l2];
    const k = d / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
}

export interface PolyPanelSpec extends Omit<PanelSpec, "outline" | "holes"> {
  /** Sharp polygon corners (any winding) and their radii. */
  pts: P2[];
  r: number | number[];
  /** Width of the edge band built from inset rings (stitch grooves live here); default = rim. */
  inner?: number;
  /** Ring spacing inside the band (default 0.75 mm). */
  bandStep?: number;
  /** Max spacing along straight edges (default 4 mm; size(x, y) refines it). */
  along?: number;
}

export interface PolyPanel extends Panel {
  /** The outline inset by d (exact corners), as a closed CCW polyline starting at corner 0. */
  ring: (d: number) => P2[];
  /** The same without the closing edge (last corner -> corner 0): the open U of a pocket. */
  open: (d: number) => P2[];
}

/**
 * A panel over a rounded polygon. Its edge band is a stack of exact inset rings (same vertex count
 * each), so stitch grooves and the folded edge stay smooth at any size, while the middle is a coarse
 * grid. lift(x, y, d) gets the true distance to the edge.
 */
export function polyPanel(s: PolyPanelSpec): PolyPanel {
  const pts = ccw(s.pts);
  const flip = pts !== s.pts;
  const n = pts.length;
  const rr = typeof s.r === "number" ? pts.map(() => s.r as number) : flip ? [...s.r].reverse() : s.r;
  const radii = pts.map((_, i) => rr[i] ?? 0);
  const rim = s.rim ?? s.t;
  const inner = Math.max(rim, s.inner ?? rim);
  const base = s.base ?? (() => 0);
  const lift = s.lift ?? (() => 0);
  const size = s.size ?? (() => 0.003);
  const sizeY = s.sizeY ?? size;
  const along = s.along ?? 0.004;
  const SEG = 8;
  const arcRing = (d: number) => fillet(offsetSharp(pts, d), radii.map((r) => Math.max(0.0003, r - d)), SEG);
  // Edge subdivisions (fractions) from the outer ring, reused for every ring so vertices correspond.
  const r0 = arcRing(0);
  const fr: number[][] = [];
  for (let c = 0; c < n; c++) {
    const a = r0[c * (SEG + 1) + SEG], b = r0[((c + 1) % n) * (SEG + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const f: number[] = [];
    let u = 0;
    const ty = L > 1e-9 ? Math.abs(b[1] - a[1]) / L : 0;
    while (L > 1e-6) {
      const px = a[0] + (b[0] - a[0]) * u, py = a[1] + (b[1] - a[1]) * u;
      const st = Math.min(along, size(px, py), sizeY(px, py) / Math.max(0.05, ty)) / L;
      if (u + st >= 1 - 0.3 * st) break;
      u += st;
      f.push(u);
    }
    fr.push(f);
  }
  const ring = (d: number): P2[] => {
    const arc = arcRing(d);
    const out: P2[] = [];
    for (let c = 0; c < n; c++) {
      for (let k = 0; k <= SEG; k++) out.push(arc[c * (SEG + 1) + k]);
      const a = arc[c * (SEG + 1) + SEG], b = arc[((c + 1) % n) * (SEG + 1)];
      for (const u of fr[c]) out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return out;
  };
  const outline = ring(0);
  const K = s.rings ?? 5;
  const insets: number[] = [];
  for (let k = 0; k <= K; k++) insets.push(rim * (1 - Math.cos((Math.PI / 2) * (k / K))));
  const bandStep = s.bandStep ?? 0.00075;
  for (let d = rim + bandStep; d < inner - bandStep * 0.4; d += bandStep) insets.push(d);
  if (inner > rim) insets.push(inner);
  const height = (x: number, y: number, d: number) => (d >= rim ? s.t + lift(x, y, d) : Math.sin(Math.acos(1 - d / rim)) * (s.t + lift(x, y, rim)));
  const z: ZFn = (x, y) => base(x, y) + height(x, y, distToPoly(outline, x, y));
  const pos: number[] = [];
  const P = (q: P2, zz: number) => pos.push(q[0], q[1], zz);
  let prev = outline, prevZ = outline.map(([x, y]) => base(x, y) - 0.0002);
  for (const d of insets) {
    const cur = d === 0 ? outline : ring(d);
    const curZ = cur.map(([x, y]) => base(x, y) + height(x, y, d));
    for (let i = 0; i < cur.length; i++) {
      const j = (i + 1) % cur.length;
      P(prev[i], prevZ[i]); P(prev[j], prevZ[j]); P(cur[j], curZ[j]);
      P(prev[i], prevZ[i]); P(cur[j], curZ[j]); P(cur[i], curZ[i]);
    }
    prev = cur;
    prevZ = curZ;
  }
  const { xy, tri } = triangulate(prev, [], size, sizeY);
  const zs = xy.map(([x, y]) => base(x, y) + height(x, y, Math.max(inner, distToPoly(outline, x, y))));
  for (const i of tri) P(xy[i], zs[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const open = (d: number) => {
    const r = ring(d);
    return r.slice(0, r.length - fr[n - 1].length);
  };
  return { geo, z, outline, ring, open };
}

/** A stitch line pulling the cloth down: subtract from a panel's lift. */
export const groove = (d: number, at: number, depth = 0.00022, w = 0.0006) => depth * Math.exp(-(((d - at) / w) ** 2));

/**
 * A strip swept along an open 2D polyline. `profile` is [left offset, height] in increasing offset
 * order (positive = left of the travel direction); the side facing +Z is the front. Ends are capped.
 */
export function ribbon(path: P2[], profile: P2[], z0: ZFn = () => 0, heightAt?: (h: number, x: number, y: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const rows = profile.map(([o]) => offsetPoly(path, o, false));
  const n = path.length, m = profile.length;
  const V = (k: number, i: number): [number, number, number] => {
    const [x, y] = rows[k][i];
    return [x, y, z0(x, y) + (heightAt ? heightAt(profile[k][1], path[i][0], path[i][1]) : profile[k][1])];
  };
  const push = (...vs: [number, number, number][]) => vs.forEach((v) => pos.push(...v));
  for (let k = 0; k < m - 1; k++) {
    for (let i = 0; i < n - 1; i++) {
      push(V(k, i), V(k, i + 1), V(k + 1, i + 1));
      push(V(k, i), V(k + 1, i + 1), V(k + 1, i));
    }
  }
  // End caps: the profile closed along a flat base under it, facing out of the strip.
  const hb = Math.min(...profile.map(([, h]) => h));
  const cap2: P2[] = [...profile];
  const addPt = (q: P2) => {
    const l = cap2[cap2.length - 1];
    if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-7 && Math.hypot(q[0] - cap2[0][0], q[1] - cap2[0][1]) > 1e-7) cap2.push(q);
  };
  addPt([profile[m - 1][0], hb]);
  addPt([profile[0][0], hb]);
  const faces = THREE.ShapeUtils.triangulateShape(cap2.map(([o, h]) => new THREE.Vector2(o, h)), []);
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3();
  for (const end of [0, n - 1]) {
    const pts = profile.map((_, k) => V(k, end));
    for (let q = profile.length; q < cap2.length; q++) {
      const k = cap2[q][0] === profile[0][0] ? 0 : m - 1;
      const [x, y] = rows[k][end];
      pts.push([x, y, z0(x, y) + hb]);
    }
    const i2 = end === 0 ? 1 : n - 2;
    const out = new THREE.Vector3(path[end][0] - path[i2][0], path[end][1] - path[i2][1], 0);
    for (const f of faces) {
      const a = pts[f[0]], b = pts[f[1]], c = pts[f[2]];
      A.set(...a); Bv.set(...b); C.set(...c);
      const nrm = Bv.sub(A).cross(C.sub(A));
      if (nrm.dot(out) >= 0) push(a, b, c);
      else push(a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------- Stitches ----------

export interface StitchOpts {
  pitch: number;
  /** Visible stitch length (default 0.74 pitch). */
  len?: number;
  r: number;
  flat?: number;
  closed?: boolean;
  /** Skip this much at both ends of an open path. */
  trim?: number;
}

/**
 * Lean thread stitch (unit, along +Y): a blunt-ended pill (the mid rings pushed out toward the ends),
 * which reads as a taut thread lying in the cloth at ~36 triangles.
 */
const stitchBase = () => {
  const g = new THREE.SphereGeometry(1, 6, 4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (Math.abs(y) > 0.99 || Math.abs(y) < 0.01) continue;
    const k = 0.93 / Math.hypot(pos.getX(i), pos.getZ(i));
    pos.setXYZ(i, pos.getX(i) * k, Math.sign(y) * 0.8, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
};
const _bm = new THREE.Matrix4();

function placeStitch(base: THREE.BufferGeometry, out: THREE.BufferGeometry[], ax: number, ay: number, bx: number, by: number, z: ZFn, r: number, flat: number) {
  const za = z(ax, ay), zb = z(bx, by);
  const A = new THREE.Vector3(ax, ay, za), Bv = new THREE.Vector3(bx, by, zb);
  const len = A.distanceTo(Bv);
  if (len < 1e-6) return;
  const Y = Bv.clone().sub(A).normalize();
  const Z = new THREE.Vector3(0, 0, 1).addScaledVector(Y, -Y.z).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  const g = base.clone().scale(r, len / 2, r * flat);
  g.applyMatrix4(_bm.makeBasis(X, Y, Z));
  const c = A.add(Bv).multiplyScalar(0.5);
  // Sunk a little: the ends dive into the cloth, the middle rides on top.
  g.translate(c.x, c.y, c.z + r * flat * 0.05);
  out.push(g);
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const nonIdx = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    return n;
  });
  const m = mergeGeometries(nonIdx, false);
  for (const g of nonIdx) g.dispose();
  return m;
}

/** Running stitches along a 2D polyline, sitting on the surface z(x, y). */
export function stitches(pts: P2[], z: ZFn, o: StitchOpts): THREE.BufferGeometry | null {
  const path = new Poly(pts, !!o.closed);
  const trim = o.closed ? 0 : (o.trim ?? 0);
  const L = path.length - 2 * trim;
  if (L <= o.pitch * 0.5) return null;
  const count = Math.max(1, Math.floor(L / o.pitch));
  const off = trim + (o.closed ? 0 : (L - count * o.pitch) / 2 + o.pitch / 2);
  // Lockstitch: neighbours share a needle hole, so the visible stitch nearly fills the pitch.
  const len = o.len ?? o.pitch * 0.84;
  const base = stitchBase();
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const s = off + i * o.pitch;
    const a = path.at(s - len / 2), b = path.at(s + len / 2);
    placeStitch(base, out, a.x, a.y, b.x, b.y, z, o.r, o.flat ?? 0.72);
  }
  base.dispose();
  return mergeAll(out);
}

/** Bar tack: a dense zigzag of short stitches across a line (pocket corners, belt loops). */
export function barTack(cx: number, cy: number, ang: number, len: number, w: number, z: ZFn, r = 0.00024): THREE.BufferGeometry | null {
  const n = Math.max(4, Math.round(len / (r * 1.25)));
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const base = stitchBase();
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const s = -len / 2 + (len * i) / (n - 1);
    const zig = (i % 2 ? 1 : -1) * r * 0.35;
    const x = cx + ux * s, y = cy + uy * s;
    placeStitch(base, out, x - uy * (w / 2) - ux * zig, y + ux * (w / 2) - uy * zig, x + uy * (w / 2) + ux * zig, y - ux * (w / 2) + uy * zig, (px, py) => z(px, py) + r * 0.6, r, 0.8);
  }
  base.dispose();
  return mergeAll(out);
}

// ---------- Bending and assembly ----------

/** Wraps flat geometry onto a cylinder of radius R around +Y (axis at z = -R). R = 0: flat. */
export class Bender {
  constructor(readonly R: number) {}
  private map(g: THREE.BufferGeometry, f: (x: number, z: number) => { x: number; z: number; th: number }) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const r = f(pos.getX(i), pos.getZ(i));
      pos.setX(i, r.x);
      pos.setZ(i, r.z);
      if (nor) {
        const nx = nor.getX(i), nz = nor.getZ(i), c = Math.cos(r.th), sn = Math.sin(r.th);
        nor.setX(i, nx * c + nz * sn);
        nor.setZ(i, -nx * sn + nz * c);
      }
    }
    pos.needsUpdate = true;
    if (nor) nor.needsUpdate = true;
    return g;
  }
  /** Deform every vertex (fabric, stitches). */
  soft(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const R = this.R;
    if (!(R > 0)) return g;
    return this.map(g, (x, z) => {
      const th = x / R;
      return { x: (R + z) * Math.sin(th), z: (R + z) * Math.cos(th) - R, th };
    });
  }
  /** Move rigid hardware centered at x = cx onto the bent surface without deforming it. */
  rigid(g: THREE.BufferGeometry, cx: number): THREE.BufferGeometry {
    const R = this.R;
    if (!(R > 0)) return g;
    const th = cx / R, c = Math.cos(th), sn = Math.sin(th);
    return this.map(g, (x, z) => {
      const xr = x - cx;
      return { x: xr * c + z * sn + R * sn, z: -xr * sn + z * c + R * c - R, th };
    });
  }
}

/** Mirror geometry in X keeping faces front-facing. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  const pos = ng.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  const nor = ng.attributes.normal;
  if (nor) for (let i = 0; i < nor.count; i++) nor.setX(i, -nor.getX(i));
  for (const name of Object.keys(ng.attributes)) {
    const a = ng.attributes[name];
    for (let t = 0; t < a.count; t += 3) {
      for (let c = 0; c < a.itemSize; c++) {
        const v1 = a.getComponent(t + 1, c);
        a.setComponent(t + 1, c, a.getComponent(t + 2, c));
        a.setComponent(t + 2, c, v1);
      }
    }
  }
  return ng;
}

/**
 * Builds one module: fabric gets meter UVs from its flat layout before bending, hardware is placed
 * rigidly, and everything merges per material.
 */
export class Kit {
  readonly acc = new Acc();
  readonly bend: Bender;
  constructor(R: number, private mirror = false) {
    this.bend = new Bender(R);
  }
  private pre(g: THREE.BufferGeometry) {
    return this.mirror ? mirrorX(g) : g;
  }
  /** Fabric / ink: smooth heightfield normals, flat-layout UVs. */
  fabric(g: THREE.BufferGeometry, mat: MatRef, crease = 1.0): this {
    if (!g.attributes.uv) boxProjectUVs(g);
    this.acc.add(this.bend.soft(this.pre(g)), mat, { crease, keepUV: true });
    return this;
  }
  /** Thread and other small soft details that keep their own normals. */
  thread(g: THREE.BufferGeometry | null, mat: MatRef): this {
    if (g) this.acc.add(this.bend.soft(this.pre(g)), mat);
    return this;
  }
  /** Rigid hardware built at (x, y, z) facing +Z. */
  hardware(pieces: Piece[], x: number, y: number, z: number, remap: (m: MatRef) => MatRef, rotZ = 0, scale = 1): this {
    const mx = this.mirror ? -x : x;
    for (const pc of pieces) {
      const g = pc.geo.clone();
      if (scale !== 1) g.scale(scale, scale, scale);
      if (rotZ) g.rotateZ(rotZ);
      g.translate(mx, y, z);
      this.acc.add(this.bend.rigid(g, mx), remap(pc.mat));
    }
    return this;
  }
  finish(): Piece[] {
    return this.acc.finish();
  }
}

// ---------- Hardware ----------

/** Cached hardware pieces (built once, cloned per placement). */
let _rivet: Piece[] | null = null;
let _snap: Piece[] | null = null;
/** Jeans rivet cap: ~8.6 mm, low dome on a rolled flange, with a stamped ring of letters. */
function jeansRivet(): Piece[] {
  const acc = new Acc();
  const prof: [number, number][] = [
    [0, 0.00205], [0.001, 0.00202], [0.0019, 0.00193], [0.0026, 0.00178], [0.0031, 0.00163], [0.0034, 0.0014], [0.0036, 0.00105],
    [0.0039, 0.00078], [0.0042, 0.00066], [0.00435, 0.00048], [0.0044, 0.00025], [0.00432, 0.00004], [0.0039, 0], [0, 0],
  ];
  acc.add(latheZ([...prof].reverse(), 64), "main", { crease: 0.5 });
  for (let i = 0; i < 30; i++) {
    if (i % 15 === 14) continue;
    const a = (i / 30) * Math.PI * 2;
    acc.add(new THREE.BoxGeometry(0.00028, 0.0006, 0.00012).rotateZ(a).translate(Math.cos(a) * 0.0029, Math.sin(a) * 0.0029, 0.00168), "main");
  }
  return acc.finish();
}
const rivetPieces = () => (_rivet ??= jeansRivet());
const snapPieces = () => (_snap ??= snapButton());
/** Stand-in for the button thread while caching; swapped for the module's thread when placed. */
const BUTTON_THREAD: PartMaterial = { preset: "cotton", color: "#000000" };
const sewnCache = new Map<number, Piece[]>();
const sewnButton = (r: number, thread: MatRef) => {
  const k = Math.round(r * 1e5);
  let p = sewnCache.get(k);
  if (!p) sewnCache.set(k, (p = buttonSewn({ radius: r }, BUTTON_THREAD)));
  return p.map((pc) => ({ ...pc, mat: pc.mat === "main" ? buttonMat : pc.mat === BUTTON_THREAD ? thread : pc.mat }));
};

let _shank: Piece[] | null = null;
/** Metal shank (jeans / trucker) button cap: rolled rim, a ring groove and a low center boss. */
function shankPieces(): Piece[] {
  if (_shank) return _shank;
  const R = 0.0085;
  const prof: [number, number][] = [
    [0, 0.0035], [0.18 * R, 0.00352], [0.34 * R, 0.00338], [0.44 * R, 0.0031], [0.5 * R, 0.00296], [0.6 * R, 0.00302], [0.7 * R, 0.0032],
    [0.8 * R, 0.00338], [0.88 * R, 0.0034], [0.95 * R, 0.0031], [0.99 * R, 0.0025], [1.0 * R, 0.0017], [0.97 * R, 0.0009],
    [0.88 * R, 0.0006], [0.5 * R, 0.0005], [0.3 * R, 0.0003], [0, 0.0003],
  ];
  const acc = new Acc();
  acc.add(latheZ([...prof].reverse(), 64), "main", { crease: 0.6 });
  // Stamped dot ring on the face.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    acc.add(new THREE.SphereGeometry(0.00028, 6, 4).scale(1, 1, 0.5).translate(Math.cos(a) * 0.76 * R, Math.sin(a) * 0.76 * R, 0.00334), "main");
  }
  return (_shank = acc.finish());
}

const asMetal = (metal: PartMaterial) => (m: MatRef): MatRef => (m === "main" ? metal : m);

// ---------- Common pocket pieces ----------

export const HEAVY = { pitch: 0.0032, r: 0.00042, flat: 0.72 };
export const MEDIUM = { pitch: 0.003, r: 0.00034, flat: 0.72 };
export const FINE = { pitch: 0.0026, r: 0.00026, flat: 0.7 };

interface Shape {
  pts: P2[];
  r: number[];
}

/**
 * Pocket / flap outline from its top-left corner, CCW (down the left side, across the bottom, up
 * the right side); the closing edge is the top. Square corners are barely eased.
 */
function shapePoly(W: number, top: number, bottom: number, corner: string, rr?: number): Shape {
  const hw = W / 2;
  if (corner === "pointed") {
    const tip = Math.min(0.14 * W, (top - bottom) * 0.3);
    return { pts: [[-hw, top], [-hw, bottom + tip], [0, bottom], [hw, bottom + tip], [hw, top]], r: [0, 0.003, 0.004, 0.003, 0] };
  }
  const r = corner === "rounded" ? (rr ?? Math.min(0.2 * W, 0.016, (top - bottom) * 0.4)) : 0.0018;
  return { pts: [[-hw, top], [-hw, bottom], [hw, bottom], [hw, top]], r: [0, r, r, 0] };
}

/** The open U of a shape inset by d (everything but the top edge), run up to `topY` at both ends. */
function uPath(pp: PolyPanel, d: number, topY: number): P2[] {
  const u = pp.open(d);
  return [[u[0][0], topY], ...u, [u[u.length - 1][0], topY]];
}

/** Gaussian groove under a straight stitch row at y = at. */
const rowGroove = (y: number, at: number, depth = 0.0002, w = 0.0006) => depth * Math.exp(-(((y - at) / w) ** 2));
/** Mid-surface hem step at the top of a pocket (double layer under the folded hem). */
const hemLift = (topY: number, hem: number, rise = 0.00032) => (y: number) => rise * smoothstep(topY - hem - 0.0012, topY - hem + 0.0006, y);
/** Fine grid near the given rows. */
const rowsSize = (rows: number[], coarse = 0.004, fine = 0.0007) => (x: number, y: number) => (rows.some((r) => Math.abs(y - r) < 0.0022) ? fine : coarse);

interface FlapSpec {
  W: number;
  top: number;
  H: number;
  corner: string;
  base: ZFn;
  t?: number;
  stitch: "single" | "double";
  thread: MatRef;
  heavy?: boolean;
  closure: "none" | "button" | "snap" | "metal";
  metal: PartMaterial;
  buttonR?: number;
  closures?: number[];
  /** Tailored: no seam rows, hand pick stitches around the edge. */
  pick?: boolean;
}

/** A flap sewn along y = top and hanging down -Y over `base`. */
function addFlap(k: Kit, f: FlapSpec): void {
  const bottom = f.top - f.H;
  const shape = shapePoly(f.W, f.top, bottom, f.corner, Math.min(0.012, f.H * 0.3));
  if (f.pick) shape.r = shape.r.map((r, i) => (i === 0 || i === shape.r.length - 1 ? 0.0006 : r));
  const t = f.t ?? 0.0016;
  const st = f.heavy ? HEAVY : f.pick ? { pitch: 0.0042, len: 0.0011, r: 0.00026, flat: 0.75 } : MEDIUM;
  const ins = f.pick ? [0.004] : f.stitch === "double" ? [0.0017, 0.0077] : [0.0018];
  const seamRows = f.pick ? [] : (f.stitch === "double" ? [0.0024, 0.0084] : [0.0026]).map((d) => f.top - d);
  const pp = polyPanel({
    pts: shape.pts, r: shape.r, t, rim: t * 0.85, base: f.base, inner: Math.max(...ins) + 0.0018,
    lift: (x, y, d) => {
      let l = 0.00035 * smoothstep(0, 0.012, d) + 0.00025 * smoothstep(f.top - 0.006, f.top - 0.0015, y);
      if (!f.pick) for (const a of ins) l -= groove(d, a) * (1 - smoothstep(f.top - 0.004, f.top - 0.001, y));
      for (const r of seamRows) l -= rowGroove(y, r);
      return l;
    },
    size: () => 0.004,
    sizeY: (x, y) => (y > f.top - 0.011 ? 0.0008 : 0.004),
  });
  k.fabric(pp.geo, "main");
  for (const d of ins) k.thread(stitches(uPath(pp, d, f.top - d).slice(1, -1), pp.z, { ...st, trim: 0.0004 }), f.thread);
  for (const y of seamRows) k.thread(stitches([[-f.W / 2 + 0.0016, y], [f.W / 2 - 0.0016, y]], pp.z, st), f.thread);
  if (f.closure === "none") return;
  for (const x of f.closures ?? [0]) {
    const yAt = f.corner === "pointed" && Math.abs(x) < 1e-6 ? bottom + 0.0115 : bottom + Math.min(0.012, f.H * 0.32);
    const zc = pp.z(x, yAt);
    if (f.closure === "snap") k.hardware(snapPieces(), x, yAt, zc - 0.0001, asMetal(f.metal));
    else if (f.closure === "metal") k.hardware(shankPieces(), x, yAt, zc - 0.0002, asMetal(f.metal));
    else {
      const r = f.buttonR ?? 0.0068;
      // Vertical buttonhole: two satin bars peeking out above and below the button.
      for (const sx of [-1, 1]) k.thread(barTack(x + sx * 0.0009, yAt, Math.PI / 2, 2 * r + 0.003, 0.0009, pp.z, 0.0002), f.thread);
      k.hardware(sewnButton(r, f.thread), x, yAt, zc + 0.0002, (m) => m);
    }
  }
}

/**
 * A hemmed patch (patch, coin, back and cargo pockets): folded top hem with stitch rows, U topstitch
 * rows that pull the cloth into grooves, a slight puff. Returns the panel for further details.
 */
function hemmedPatch(k: Kit, o: { shape: Shape; top: number; hem: number; t: number; rim: number; puff: number; uRows: number[]; hemRows: number[]; thread: MatRef; stitch: StitchOpts; base?: ZFn; coarse?: number; along?: number }): PolyPanel {
  const hl = hemLift(o.top, o.hem);
  const pp = polyPanel({
    pts: o.shape.pts, r: o.shape.r, t: o.t, rim: o.rim, inner: Math.max(...o.uRows) + 0.0022, base: o.base,
    lift: (x, y, d) => {
      let l = o.puff * smoothstep(0, 0.03, d) * (1 - 0.75 * smoothstep(o.top - o.hem - 0.012, o.top - o.hem, y)) + hl(y);
      const nearTop = smoothstep(o.top - 0.004, o.top - 0.0012, y);
      for (const a of o.uRows) l -= groove(d, a) * (1 - nearTop);
      for (const r of o.hemRows) l -= rowGroove(y, r);
      return l;
    },
    size: () => o.coarse ?? 0.004,
    sizeY: rowsSize([...o.hemRows, o.top - o.hem], o.coarse ?? 0.004),
    along: o.along,
  });
  k.fabric(pp.geo, "main");
  for (const d of o.uRows) k.thread(stitches(uPath(pp, d, o.top - 0.0012), pp.z, { ...o.stitch, trim: 0.0004 }), o.thread);
  const W = Math.max(...o.shape.pts.map(([x]) => Math.abs(x))) * 2;
  for (const y of o.hemRows) k.thread(stitches([[-W / 2 + 0.0011, y], [W / 2 - 0.0011, y]], pp.z, o.stitch), o.thread);
  return pp;
}

// ---------- patch_pocket ----------

function patchPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const corner = opt(O.corner, p.corner);
  const flap = opt(O.patchFlap, p.flap);
  const double = opt(O.stitch, p.stitch) === "double";
  const thread = threadMat(p.thread);
  const top = H / 2, bottom = -H / 2;
  const hem = clamp(H * 0.17, 0.014, 0.03);
  const t = 0.0014;
  const puff = 0.0009 * clamp(Math.sqrt((W * H) / (0.12 * 0.14)), 0.5, 1.4);
  const hy = top - hem + 0.0018;
  const pp = hemmedPatch(k, {
    shape: shapePoly(W, top, bottom, corner), top, hem, t, rim: 0.0013, puff,
    uRows: double ? [0.0016, 0.0076] : [0.0016], hemRows: double ? [hy, hy + 0.006] : [hy], thread, stitch: MEDIUM,
  });
  // Reinforced top corners: bar tacks (double) or small stitched triangles (single).
  for (const sx of [-1, 1]) {
    if (double) k.thread(barTack(sx * (W / 2 - 0.0046), top - 0.005, Math.PI / 2, 0.0068, 0.0019, pp.z), thread);
    else {
      const x0 = sx * (W / 2 - 0.0016);
      const tri: P2[] = [[x0, top - 0.0012], [x0 - sx * 0.0055, top - 0.0012], [x0, top - 0.0085]];
      k.thread(stitches([...tri, tri[0]], pp.z, { ...FINE, pitch: 0.0019 }), thread);
    }
  }
  if (flap !== "none") {
    const fH = clamp(H * 0.36, 0.028, 0.065);
    const seam = top + 0.011;
    const pz = t + 0.00032 + puff * 0.25;
    addFlap(k, {
      W: W + 0.004, top: seam, H: fH + 0.011, corner, stitch: double ? "double" : "single", thread, metal: metalMat(p.metal),
      base: (x, y) => 0.0001 + (pz + 0.0003) * smoothstep(top + 0.002, top - 0.003, y) * (1 - 0.55 * smoothstep(W / 2 - 0.0012, W / 2 + 0.002, Math.abs(x))),
      closure: flap === "flap_button" ? (opt(O.button, p.button) === "metal" ? "metal" : "button") : "none",
    });
  }
  return k.finish();
}

// ---------- flap ----------

function flapModule(p: Params): Piece[] {
  const k = new Kit(p.bend);
  const closure = opt(O.flapClosure, p.closure) as "none" | "button" | "snap";
  addFlap(k, {
    W: p.width, top: p.height / 2, H: p.height, corner: opt(O.corner, p.shape), base: () => 0.0001,
    stitch: opt(O.stitch, p.stitch) === "double" ? "double" : "single", thread: threadMat(p.thread), metal: metalMat(p.metal), closure,
  });
  return k.finish();
}

// ---------- coin_pocket ----------

function coinPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const thread = threadMat(p.thread);
  const top = H / 2, bottom = -H / 2;
  const hem = clamp(H * 0.2, 0.009, 0.014);
  const hy = top - hem + 0.0018;
  const pp = hemmedPatch(k, {
    shape: shapePoly(W, top, bottom, "square"), top, hem, t: 0.0013, rim: 0.0012, puff: 0.0004,
    uRows: [0.0016, 0.0072], hemRows: [hy, hy + 0.0058], thread, stitch: HEAVY, coarse: 0.003,
  });
  if (opt(O.rivet, p.rivet) === "rivet") {
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.0042), y = top - 0.0045;
      k.hardware(rivetPieces(), x, y, pp.z(x, y) - 0.0002, asMetal(metalMat(p.metal)));
    }
  }
  return k.finish();
}

// ---------- jeans_back_pocket ----------

function jeansBackPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const thread = threadMat(p.thread);
  const top = H / 2, bottom = -H / 2;
  const v = Math.min(0.2 * W, H * 0.25);
  const bw = W * 0.47;
  const hem = clamp(H * 0.13, 0.016, 0.024);
  const hy = top - hem + 0.0018;
  const pp = hemmedPatch(k, {
    shape: { pts: [[-W / 2, top], [-bw, bottom + v], [0, bottom], [bw, bottom + v], [W / 2, top]], r: [0, 0.003, 0.004, 0.003, 0] },
    top, hem, t: 0.0013, rim: 0.0012, puff: 0.0011, uRows: [0.0016, 0.0076], hemRows: [hy, hy + 0.0062], thread, stitch: HEAVY,
  });
  for (const sx of [-1, 1]) k.thread(barTack(sx * (W / 2 - 0.0046), top - 0.0055, Math.PI / 2 + sx * 0.06, 0.0075, 0.0021, pp.z, 0.00028), thread);
  // Decorative stitching across the middle: two parallel arcs or a V, ending inside the side rows.
  const deco = opt(O.deco, p.deco);
  if (deco !== "none") {
    const y0 = top - hem - 0.024;
    const sag = deco === "arc" ? H * 0.12 : H * 0.17;
    for (const off of [0, -0.0062]) {
      const pts: P2[] = [];
      const xs = W / 2 - 0.0125;
      for (let i = 0; i <= 40; i++) {
        const u = -1 + (2 * i) / 40;
        const yy = deco === "arc" ? y0 + off - sag * (1 - u * u) : y0 + off - sag * (1 - Math.abs(u));
        pts.push([u * (xs - (y0 - yy) * 0.06), yy]);
      }
      k.thread(stitches(pts, pp.z, HEAVY), thread);
    }
  }
  return k.finish();
}

// ---------- welt_pocket ----------

function weltPocket(p: Params): Piece[] {
  const W = p.width, Ht = p.height;
  const k = new Kit(p.bend);
  const thread = threadMat(p.thread);
  const double = opt(O.lips, p.lips) === "double";
  const hw = W / 2;
  const lipT = 0.0017;
  const lipZ: ZFn[] = [];
  const lips: { y0: number; y1: number }[] = double ? [{ y0: 0.0003, y1: Ht / 2 }, { y0: -Ht / 2, y1: -0.0003 }] : [{ y0: -Ht / 2, y1: Ht / 2 - 0.0008 }];
  for (const l of lips) {
    const h = l.y1 - l.y0;
    const pp = polyPanel({
      pts: [[-hw, l.y1], [-hw, l.y0], [hw, l.y0], [hw, l.y1]], r: 0.0006,
      t: double ? lipT : 0.0013, rim: double ? Math.min(lipT, h * 0.45) : 0.0011, inner: double ? h * 0.48 : 0.0011,
      // Piped lips are round toward the opening; a welt board is flat with a folded top.
      // A welt board is flat with a crisp folded top, and runs flush into its seam at the bottom.
      lift: double ? (x, y, d) => 0.0004 * smoothstep(0, h * 0.45, d) : (x, y) => 0.0003 * smoothstep(l.y1 - 0.004, l.y1 - 0.001, y) - 0.001 * (1 - smoothstep(l.y0, l.y0 + 0.004, y)),
      size: () => 0.004, sizeY: () => Math.min(0.0012, h * 0.3), bandStep: 0.0004, along: 0.004,
    });
    k.fabric(pp.geo, "main");
    lipZ.push(pp.z);
  }
  // Dark opening line (between the lips, or above the board).
  const gy = double ? 0 : Ht / 2 - 0.0002;
  const gap = polyPanel({ pts: [[-hw + 0.0006, gy + 0.00055], [-hw + 0.0006, gy - 0.00055], [hw - 0.0006, gy - 0.00055], [hw - 0.0006, gy + 0.00055]], r: 0.0002, t: 0.0004, rim: 0.0002, size: () => 0.004 });
  k.fabric(gap.geo, gapMat);
  // Tacked ends: short vertical rows of fine stitches across the lips.
  const zEnd: ZFn = (x, y) => Math.max(0, ...lipZ.map((f) => f(x, y)));
  if (double) for (const sx of [-1, 1]) k.thread(barTack(sx * (hw - 0.001), 0, Math.PI / 2, Ht * 0.9, 0.0008, zEnd, 0.00014), thread);
  if (opt(O.weltFlap, p.flap) === "flap") {
    const fH = clamp(W * 0.36, 0.035, 0.065);
    const ftop = double ? 0 : Ht / 2 - 0.0004;
    addFlap(k, {
      W: W - 0.0012, top: ftop, H: fH, corner: "rounded", stitch: "single", thread, metal: METAL_MATS.brass, closure: "none", t: 0.0013, pick: true,
      base: (x, y) => 0.00015 + (lipT + 0.0004) * smoothstep(-Ht / 2 - 0.004, -Ht / 2 + 0.001, y),
    });
  }
  return k.finish();
}

// ---------- cargo_pocket ----------

function cargoPocket(p: Params): Piece[] {
  const W = p.width, H = p.height, D = p.depth;
  const k = new Kit(p.bend);
  const thread = threadMat(p.thread);
  const metal = metalMat(p.metal);
  const top = H / 2, bottom = -H / 2;
  const shape = shapePoly(W, top, bottom, "rounded", 0.007);
  const hem = 0.028;
  const hy = top - hem + 0.002;
  // The bellows hangs: it stands off more at the bottom than at the opening.
  const Dz = (y: number) => D * (0.55 + 0.45 * clamp((top - y) / H, 0, 1));
  const front = hemmedPatch(k, {
    shape, top, hem, t: 0.0014, rim: 0.0013, puff: 0.0018, uRows: [0.0017], hemRows: [hy, hy + 0.0068], thread, stitch: HEAVY, base: (x, y) => Dz(y), coarse: 0.006, along: 0.005,
  });
  // Gusset: from a stitched flange on the garment, out over a pleat fold, back in under the front edge.
  const u = front.open(0);
  const fold = Math.min(0.006, D * 0.42);
  // [offset to the left of travel (= into the pocket), height], increasing offset; heights above the
  // flange are scaled to the local stand-off.
  const prof: P2[] = [
    [-0.008, -0.0002], [-0.0078, 0.0004], [-0.0072, 0.0007], [-0.0024, 0.0008], [-0.0012, 0.0011], [-fold * 0.3, D * 0.14],
    [-fold * 0.85, D * 0.33], [-fold, D * 0.5], [-fold * 0.85, D * 0.68], [-fold * 0.35, D * 0.88], [0.0004, D - 0.0002],
  ];
  const scaleH = (h: number, x: number, y: number) => (h <= 0.0011 ? h : 0.0011 + ((h - 0.0011) * (Dz(y) - 0.0011)) / (D - 0.0011));
  k.fabric(ribbon(u, prof, () => 0, scaleH), "main");
  // Flange topstitch on the garment.
  k.thread(stitches(offsetPoly(u, -0.0052, false, true), () => 0.0008, { ...HEAVY, trim: 0.002 }), thread);
  if (opt(O.pleat, p.pleat) === "box") {
    // Box pleat: a raised center panel whose fold edges are tacked at the bottom.
    const pw = Math.min(0.04, W * 0.24);
    const pl = polyPanel({
      pts: [[-pw / 2, top - hem + 0.0002], [-pw / 2, bottom + 0.004], [pw / 2, bottom + 0.004], [pw / 2, top - hem + 0.0002]], r: 0.0004,
      t: 0.0007, rim: 0.0006, base: (x, y) => front.z(x, y) - 0.0002, size: () => 0.005,
    });
    k.fabric(pl.geo, "main");
    k.fabric(polyPanel({ pts: [[-0.00035, top - hem - 0.0005], [-0.00035, bottom + 0.006], [0.00035, bottom + 0.006], [0.00035, top - hem - 0.0005]], r: 0.0001, t: 0.0001, rim: 0.0001, base: (x, y) => pl.z(x, y), size: () => 0.005 }).geo, insideMat);
    for (const sx of [-1, 1]) k.thread(barTack(sx * (pw / 2 - 0.004), bottom + 0.012, 0, 0.007, 0.0016, pl.z, 0.00026), thread);
  }
  // Flap: sewn above the opening, folds out over the standing front.
  const fH = clamp(H * 0.3, 0.045, 0.075);
  const seam = top + 0.016;
  addFlap(k, {
    W: W + 2 * fold + 0.003, top: seam, H: fH + 0.016, corner: "square", stitch: "double", thread, metal, heavy: true, t: 0.0018,
    // Rides just over the front panel (which leans out toward the bottom, and puffs below the hem).
    base: (x, y) => 0.0002 + smoothstep(seam - 0.0015, top - 0.002, y) * (Dz(Math.min(y, top)) + 0.0025 + 0.0018 * (1 - 0.8 * smoothstep(top - hem - 0.02, top - hem, y))),
    closure: opt(O.closure, p.closure) === "snap" ? "snap" : "button", buttonR: 0.0085, closures: [-W * 0.27, W * 0.27],
  });
  return k.finish();
}

// ---------- slash_pocket ----------

function slashPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const right = opt(O.side, p.side) === "right";
  const k = new Kit(p.bend, right);
  const thread = threadMat(p.thread);
  const curved = opt(O.slash, p.shape) === "curved";
  const double = opt(O.stitch, p.stitch) === "double";
  // Opening edge from the waist (+Y) down to the side seam at -X, bulging toward the front. Offsets
  // to the left of this travel direction point to the front panel.
  const curve: P2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const ph = (i / N) * (Math.PI / 2);
    const ex = -W / 2 + W * Math.cos(ph), ey = H / 2 - H * Math.sin(ph);
    const lx = W / 2 - W * (i / N), ly = H / 2 - H * (i / N);
    const kk = curved ? 0.78 : 0;
    curve.push([lx + (ex - lx) * kk, ly + (ey - ly) * kk]);
  }
  // Facing: the corner region behind the opening, tucked a little under the lip.
  const under = offsetPoly(curve, 0.004, false);
  // It disappears into the waistband and side seam, so it fades in from those edges.
  const fadeIn = (x: number, y: number) => smoothstep(0, 0.008, Math.min(H / 2 - y, x + W / 2));
  const facing = panel({
    outline: [[-W / 2, H / 2], [under[0][0], H / 2], ...under.slice(1, -1), [-W / 2, under[under.length - 1][1]]],
    t: 0.0005, rim: 0.0003, base: (x, y) => -0.0006 * (1 - fadeIn(x, y)), size: (x, y) => (fadeIn(x, y) < 1 ? 0.0025 : 0.005), step: 0.002, rings: 2,
  });
  k.fabric(facing.geo, "main");
  // Shadowed mouth just inside the edge.
  const mouthIn = offsetPoly(curve, -0.0018, false);
  k.fabric(panel({ outline: [...curve, ...[...mouthIn].reverse()], t: 0.00002, rim: 0.00001, base: () => 0.00056, size: () => 0.004, step: 0.0015, rings: 1 }).geo, insideMat);
  // Lip: the front panel's rolled edge, tapering into the garment over ~17 mm.
  const lipProf: P2[] = [
    [0, 0.0011], [0.0001, 0.0004], [0.0004, 0.0017], [0.0012, 0.002], [0.003, 0.0019], [0.006, 0.00155], [0.0095, 0.001],
    [0.013, 0.00045], [0.0165, 0.0001], [0.0168, -0.0002],
  ];
  const lipZ = (x: number, y: number) => {
    // Lip height at a point (for stitches and rivets): the profile at the distance to the edge.
    const d = distToPoly(curve, x, y, false);
    for (let i = 3; i < lipProf.length; i++) {
      const d0 = lipProf[i - 1][0], d1 = lipProf[i][0];
      if (d <= d1) return lipProf[i - 1][1] + ((lipProf[i][1] - lipProf[i - 1][1]) * (d - d0)) / Math.max(1e-6, d1 - d0);
    }
    return 0;
  };
  k.fabric(ribbon(resample(curve, 0.0012, false), lipProf), "main");
  for (const ins of double ? [0.0028, 0.0092] : [0.0035]) k.thread(stitches(offsetPoly(curve, ins, false, true), lipZ, { ...HEAVY, trim: 0.002 }), thread);
  if (opt(O.rivet, p.rivet) === "rivet") {
    const path = new Poly(curve);
    for (const s of [0.007, path.length - 0.007]) {
      const a = path.at(s);
      const x = a.x - a.ty * 0.0062, y = a.y + a.tx * 0.0062;
      k.hardware(rivetPieces(), x, y, lipZ(x, y) - 0.0002, asMetal(metalMat(p.metal)));
    }
  }
  return k.finish();
}

// ---------- kangaroo_pocket ----------

function kangarooPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const thread = threadMat(p.thread);
  const top = H / 2, bottom = -H / 2;
  const tw = W * 0.31, sideTop = bottom + H * 0.2;
  /** Distance to a slanted hand opening (mirrored), and how far along it (0..1). */
  const opening = (x: number, y: number) => {
    const ax = W / 2, ay = sideTop, dx = tw - ax, dy = top - ay;
    const px = Math.abs(x);
    const t = clamp(((px - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return { d: Math.hypot(ax + dx * t - px, ay + dy * t - y), t };
  };
  // The opening edges stand off the body a little (the hand goes in there); sewn edges lie flat.
  const open = (x: number, y: number) => {
    const o = opening(x, y);
    return (1 - smoothstep(0.003, 0.03, o.d)) * smoothstep(0, 0.15, o.t) * (1 - smoothstep(0.85, 1, o.t));
  };
  const pp = polyPanel({
    pts: [[-W / 2, bottom], [W / 2, bottom], [W / 2, sideTop], [tw, top], [-tw, top], [-W / 2, sideTop]], r: [0.006, 0.006, 0.004, 0.004, 0.004, 0.004],
    t: 0.0018, rim: 0.0017, inner: 0.01,
    base: (x, y) => 0.0026 * open(x, y),
    lift: (x, y, d) => 0.0035 * smoothstep(0, 0.06, d) - groove(d, 0.0018, 0.00025, 0.0007) - groove(d, 0.0078, 0.00025, 0.0007) * open(x, y),
    size: () => 0.006, along: 0.006,
  });
  k.fabric(pp.geo, "main");
  for (const sx of [-1, 1]) {
    const a: P2 = [(sx * W) / 2, sideTop], b: P2 = [sx * tw, top];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    // Normal pointing into the pocket (toward x = 0).
    const flip = -uy * -sx < 0 ? -1 : 1;
    const inx = -uy * flip, iny = ux * flip;
    const q = (o: number, s: number): P2 => [a[0] + ux * s + inx * o, a[1] + uy * s + iny * o];
    // Shadow under the raised opening.
    k.fabric(polyPanel({ pts: [q(-0.0006, 0.008), q(-0.0006, l - 0.006), q(0.012, l - 0.012), q(0.012, 0.014)], r: 0.0002, t: 0.00005, rim: 0.00004, base: () => 0.0001, size: () => 0.006 }).geo, insideMat);
    // Twin-needle cover stitch on the opening's binding.
    k.thread(stitches([q(0.0078, 0.006), q(0.0078, l - 0.006)], pp.z, MEDIUM), thread);
  }
  k.thread(stitches(pp.ring(0.0018), pp.z, { ...MEDIUM, closed: true }), thread);
  return k.finish();
}

export const POCKET_BUILDERS: Record<string, Builder> = {
  patch_pocket: patchPocket,
  welt_pocket: weltPocket,
  cargo_pocket: cargoPocket,
  coin_pocket: coinPocket,
  slash_pocket: slashPocket,
  jeans_back_pocket: jeansBackPocket,
  flap: flapModule,
  kangaroo_pocket: kangarooPocket,
};

