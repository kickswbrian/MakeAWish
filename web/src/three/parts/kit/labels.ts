import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartMaterial } from "@wishit/shared";
import { LABEL_OPTIONS as LO } from "@wishit/shared/modules/labels.ts";
import { getMaterial } from "../materials.ts";
import { Acc, type Builder, M, type MatRef, type Params, type Piece, braidTube, clamp, luminance, rbox, v3 } from "./core.ts";
import { grommet } from "./fasteners.ts";
import {
  HEAVY, Kit, type P2, Poly, type ZFn, ccw, distToPoly, fillet, inside, offsetSharp, opt, panel, polyPanel, shade, smoothstep, stitches, threadMat, tonalMat,
} from "./pockets.ts";

/**
 * Detail module builders: labels, patches and graphics (catalog in shared/modules/labels.ts).
 * Woven text uses a 5x7 pixel font whose rows become weft floats (how woven labels really build
 * letters); embroidery lays real satin / fill stitches across each shape; prints are thin ink.
 */

// ---------- Pixel font ----------

const FONT: Record<string, string[]> = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  C: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"],
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
};

/** Horizontal pixel runs of a text line centered at (cx, cy): [x0, x1, y] in meters, px = pixel size. */
export function textRuns(text: string, px: number, cx: number, cy: number): [number, number, number][] {
  const adv = 6 * px;
  const width = text.length * adv - px;
  const x0 = cx - width / 2;
  const out: [number, number, number][] = [];
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    if (!g) return;
    g.forEach((row, r) => {
      const y = cy + (3 - r) * px;
      let start = -1;
      for (let c = 0; c <= 5; c++) {
        const on = c < 5 && row[c] === "#";
        if (on && start < 0) start = c;
        if (!on && start >= 0) {
          out.push([x0 + i * adv + start * px, x0 + i * adv + c * px, y]);
          start = -1;
        }
      }
    });
  });
  return out;
}

const textWidth = (text: string, px: number) => text.length * 6 * px - px;

// ---------- Small geometry helpers ----------

function mergeList(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
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

/** Thin flat ink / print slab over a polygon at height z. */
function inkSlab(pts: P2[], z: number, h: number, holes: P2[][] = []): THREE.BufferGeometry {
  const sh = new THREE.Shape(ccw(pts).map(([x, y]) => new THREE.Vector2(x, y)));
  for (const ho of holes) sh.holes.push(new THREE.Path([...ccw(ho)].reverse().map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, z);
  return g;
}

/**
 * Woven floats: each pixel row of text is two weft picks, flat-topped threads along X with square
 * ends, touching their neighbours, so letters read solid with a fine horizontal rib.
 */
function floats(runs: [number, number, number][], px: number, z: ZFn): THREE.BufferGeometry | null {
  const base = new THREE.CylinderGeometry(1, 1, 1, 8, 1).rotateZ(Math.PI / 2);
  const out: THREE.BufferGeometry[] = [];
  for (const [x0, x1, y] of runs) {
    const len = x1 - x0 - px * 0.06;
    const cx = (x0 + x1) / 2;
    for (const dy of [-px / 4, px / 4]) {
      const g = base.clone().scale(len, px * 0.27, px * 0.11);
      g.translate(cx, y + dy, z(cx, y) + px * 0.02);
      out.push(g);
    }
  }
  base.dispose();
  return mergeList(out);
}

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Text / ink that reads on a label or card: near-black on light, cream on dark. */
const inkOn = (m: PartMaterial, preset: PartMaterial["preset"] = "plastic_matte"): PartMaterial =>
  luminance(m.color) > 0.3 ? { preset, color: "#1D1D20" } : { preset, color: "#F0E7D3" };
const wovenText = (m: PartMaterial) => getMaterial(inkOn(m, "satin"));
const printInk = (m: PartMaterial) => getMaterial(inkOn(m));

// ---------- woven_label ----------

function wovenLabel(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const loop = opt(LO.fold, p.fold) === "loop";
  const t = 0.00032;
  const px = clamp(Math.min((H * (loop ? 0.6 : 0.42)) / 7, (W * 0.8) / textWidth("WISH IT", 1)), 0.00012, 0.0007);
  if (!loop) {
    // End-folded label: the folded ends are double thickness and stitched down.
    const fold = Math.min(0.004, W * 0.1);
    const pp = polyPanel({
      pts: [[-W / 2, H / 2], [-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2]], r: 0.0003, t, rim: 0.00022,
      lift: (x) => 0.00028 * smoothstep(W / 2 - fold, W / 2 - fold + 0.0005, Math.abs(x)),
      size: (x) => (Math.abs(Math.abs(x) - (W / 2 - fold)) < 0.0012 ? 0.0004 : 0.002), along: 0.002,
    });
    k.fabric(pp.geo, "main");
    for (const sx of [-1, 1]) k.thread(stitches([[sx * (W / 2 - fold * 0.55), H / 2 - 0.0008], [sx * (W / 2 - fold * 0.55), -H / 2 + 0.0008]], pp.z, { pitch: 0.0024, r: 0.00022, flat: 0.7 }), tonalMat);
    addWovenFace(k, W - 2 * fold, H, 0, px, pp.z);
  } else {
    // Loop label: folded in half, the fold at -H, both layers sewn into the seam at y = 0.
    const back = polyPanel({ pts: [[-W / 2, 0], [-W / 2, -H], [W / 2, -H], [W / 2, 0]], r: 0.0003, t, rim: 0.0002, size: () => 0.002, along: 0.002 });
    k.fabric(back.geo, "main");
    const zf = t + 0.00008;
    const front = polyPanel({ pts: [[-W / 2, 0], [-W / 2, -H + 0.0002], [W / 2, -H + 0.0002], [W / 2, 0]], r: 0.0003, t, rim: 0.0002, base: () => zf, size: () => 0.002, along: 0.002 });
    k.fabric(front.geo, "main");
    const fold = new THREE.CylinderGeometry(zf / 2 + t / 2, zf / 2 + t / 2, W - 0.0004, 16, 1, true).rotateZ(Math.PI / 2).translate(0, -H + 0.0002, (zf + t) / 2);
    k.fabric(fold, "main");
    addWovenFace(k, W, H, -H / 2, px, front.z);
  }
  return k.finish();
}

/** Woven face: a fine border stripe along the long edges and the woven wordmark. */
function addWovenFace(k: Kit, W: number, H: number, cy: number, px: number, z: ZFn) {
  const runs = textRuns("WISH IT", px, 0, cy + px * 1.2);
  const px2 = px * 0.42;
  runs.push(...textRuns("MADE WITH LOVE", px2, 0, cy - px * 4.6));
  // Border stripes: long floats just inside the long edges.
  for (const sy of [-1, 1]) runs.push([-W / 2 + 0.0012, W / 2 - 0.0012, cy + sy * (H / 2 - 0.0011)]);
  k.thread(floats(runs, px, z), wovenText);
}

// ---------- leather_patch ----------

function leatherPatch(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const k = new Kit(p.bend);
  const t = 0.0017;
  const rr = Math.min(0.002, Math.min(W, H) * 0.06);
  const outer: P2[] = fillet([[-W / 2, H / 2], [-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2]], rr, 6);
  // Debossed border groove: the leather around it and the field inside are separate panels over a
  // burnished floor.
  const g0 = Math.min(0.0062, Math.min(W, H) * 0.15), gw = 0.0009;
  const grooveOut: P2[] = fillet([[-W / 2 + g0, H / 2 - g0], [-W / 2 + g0, -H / 2 + g0], [W / 2 - g0, -H / 2 + g0], [W / 2 - g0, H / 2 - g0]], Math.max(0.0004, rr - g0 * 0.5), 6);
  const grooveIn: P2[] = fillet(offsetSharp([[-W / 2 + g0, H / 2 - g0], [-W / 2 + g0, -H / 2 + g0], [W / 2 - g0, -H / 2 + g0], [W / 2 - g0, H / 2 - g0]], gw), 0.0004, 6);
  const frame = panel({ outline: outer, holes: [grooveOut], holeRim: 0.00025, t, rim: 0.0008, size: () => 0.003, step: 0.0012 });
  k.fabric(frame.geo, "main");
  // Field with a debossed wordmark.
  const fieldW = W - 2 * (g0 + gw);
  const px = clamp(Math.min(((H - 2 * (g0 + gw)) * 0.5) / 9, (fieldW * 0.82) / textWidth("WISH IT", 1)), 0.0002, 0.0012);
  const runs = textRuns("WISH IT", px, 0, px * 1.4);
  const px2 = px * 0.5;
  runs.push(...textRuns("EST 2026", px2, 0, -px * 4.2));
  const field = panel({
    outline: grooveIn, t, rim: 0.0005, step: 0.0012, size: () => 0.003,
    lift: (x, y, d) => 0.00012 * smoothstep(0, 0.006, d),
  });
  k.fabric(field.geo, "main");
  // Pressed floor (darker, burnished) under the groove.
  const pressed = (m: PartMaterial) => getMaterial({ ...m, color: shade(m.color, 0.55), roughness: 0.45 });
  k.fabric(panel({ outline: grooveOut, t: 0.0001, rim: 0.00005, base: () => t - 0.00045, size: () => 0.004, rings: 1 }).geo, pressed);
  // Heat-debossed wordmark: burned (dark, smoother) bars pressed just into the surface.
  const burned = (m: PartMaterial) => getMaterial({ ...m, color: shade(m.color, 0.42), roughness: 0.4 });
  const nBig = textRuns("WISH IT", px, 0, px * 1.4).length;
  const bars = runs.map(([x0, x1, y], i) => {
    const q = i < nBig ? px : px2;
    const hp = q * 0.47, e = q * 0.03;
    return inkSlab([[x0 + e, y - hp], [x1 - e, y - hp], [x1 - e, y + hp], [x0 + e, y + hp]], field.z((x0 + x1) / 2, y) - 0.00006, 0.00008);
  });
  const bg = mergeList(bars);
  if (bg) k.fabric(bg, burned, 0.5);
  // Edge stitching.
  const z: ZFn = (x, y) => frame.z(x, y);
  const st = offsetSharp([[-W / 2, H / 2], [-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2]], 0.0024);
  k.thread(stitches(fillet(st, Math.max(0.0005, rr - 0.0024), 4), z, { ...HEAVY, pitch: 0.0034, closed: true }), threadMat(p.thread));
  return k.finish();
}

// ---------- Stitch fills (embroidery) ----------

type Seg = [number, number, number, number];

/** Parallel satin / fill stitches across a polygon (holes allowed) at `angle`; long spans split brick-wise. */
function fillSegs(poly: P2[], holes: P2[][], angle: number, gap: number, maxLen: number): Seg[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const loops = [poly, ...holes].map((l) => l.map(([x, y]): P2 => [x * c + y * s, -x * s + y * c]));
  let v0 = Infinity, v1 = -Infinity;
  for (const [, v] of loops[0]) { v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const out: Seg[] = [];
  let row = 0;
  for (let v = v0 + gap / 2; v < v1; v += gap, row++) {
    const xs: number[] = [];
    for (const l of loops) {
      for (let i = 0; i < l.length; i++) {
        const a = l[i], b = l[(i + 1) % l.length];
        if (a[1] <= v !== b[1] <= v) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u0 = xs[i], u1 = xs[i + 1];
      const L = u1 - u0;
      if (L < gap * 0.6) continue;
      const n = Math.ceil(L / maxLen);
      const seg = L / n;
      const cuts = [u0];
      const phase = n > 1 ? [0, 0.5, 0.25, 0.75][row % 4] : 0;
      for (let k = 1; k < n + (phase > 0 ? 1 : 0); k++) cuts.push(Math.min(u1, u0 + (k - phase) * seg));
      cuts.push(u1);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k], b = cuts[k + 1];
        if (b - a < gap * 0.8) continue;
        out.push([a * c - v * s, a * s + v * c, b * c - v * s, b * s + v * c]);
      }
    }
  }
  return out;
}

/** Satin column along a path: stitches across it, slightly slanted. */
function columnSegs(path: P2[], width: number | ((u: number) => number), gap: number, closed = false, slant = 0.25): Seg[] {
  const P = new Poly(path, closed);
  const n = Math.max(1, Math.floor(P.length / gap));
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * (P.length / n);
    const a = P.at(s);
    const w = typeof width === "number" ? width : width(s / P.length);
    const nx = -a.ty, ny = a.tx;
    const sl = slant * w * 0.5;
    out.push([a.x - nx * (w / 2) - a.tx * sl, a.y - ny * (w / 2) - a.ty * sl, a.x + nx * (w / 2) + a.tx * sl, a.y + ny * (w / 2) + a.ty * sl]);
  }
  return out;
}

/** Thread stitches over segments: pills that arc up over their span (padded satin). */
function satin(segs: Seg[], z0: number, r: number): THREE.BufferGeometry | null {
  const base = new THREE.SphereGeometry(1, 5, 5);
  const out: THREE.BufferGeometry[] = [];
  for (const [ax, ay, bx, by] of segs) {
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-5) continue;
    const g = base.clone().scale(r, L / 2 + r * 0.4, r * 0.62);
    const arc = clamp(0.00006 + L * 0.05, 0.00006, 0.0004);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getY(i) / (L / 2 + r * 0.4);
      pos.setZ(i, pos.getZ(i) + arc * (1 - u * u));
    }
    g.computeVertexNormals();
    g.rotateZ(Math.atan2(by - ay, bx - ax) - Math.PI / 2);
    g.translate((ax + bx) / 2, (ay + by) / 2, z0 + r * 0.3);
    out.push(g);
  }
  base.dispose();
  return mergeList(out);
}

/** French knots: little thread balls packed over a disc. */
function knots(cx: number, cy: number, R: number, r: number): THREE.BufferGeometry | null {
  const base = new THREE.SphereGeometry(1, 8, 6);
  const out: THREE.BufferGeometry[] = [];
  const step = r * 1.75;
  const rnd = rng(7);
  for (let y = -R; y <= R; y += step * 0.87) {
    const row = Math.round((y + R) / (step * 0.87));
    for (let x = -R + (row % 2 ? step / 2 : 0); x <= R; x += step) {
      if (Math.hypot(x, y) > R - r * 0.4) continue;
      const g = base.clone().scale(r, r, r * 0.8).rotateZ(rnd() * 3);
      g.translate(cx + x, cy + y, 0.0002 + r * 0.7 + rnd() * r * 0.15);
      out.push(g);
    }
  }
  base.dispose();
  return mergeList(out);
}

// ---------- Motif shapes (unit size, roughly within ±0.5) ----------

function heartShape(n = 96): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x / 33, (y + 2.5) / 33]);
  }
  return ccw(pts);
}

function starShape(ro = 0.5, ri = 0.21, rot = Math.PI / 2): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const r = i % 2 ? ri : ro;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function ellipse(cx: number, cy: number, a: number, b: number, rot = 0, n = 40): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * a, y = Math.sin(t) * b;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number, n = 40): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function bezier(p0: P2, p1: P2, p2: P2, p3: P2, n = 24): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Clip a polygon by a convex CCW window (Sutherland-Hodgman). */
function clipConvex(subject: P2[], clip: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (q: P2) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length];
      const sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  // Drop repeated points (a vertex on a clip edge comes out twice), which trip the triangulator.
  return out.filter((q, i) => {
    const r = out[(i + 1) % out.length];
    return out.length < 2 || Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-9;
  });
}

const halfPlane = (side: number, axis: "x" | "y" = "x"): P2[] => {
  const B = 10;
  if (axis === "x") return side < 0 ? [[-B, -B], [0, -B], [0, B], [-B, B]] : [[0, -B], [B, -B], [B, B], [0, B]];
  return side < 0 ? [[-B, -B], [B, -B], [B, 0], [-B, 0]] : [[-B, 0], [B, 0], [B, B], [-B, B]];
};

const mirrorPts = (pts: P2[]): P2[] => pts.map(([x, y]): P2 => [-x, y]).reverse();

interface Fill { kind: "fill"; poly: P2[]; holes?: P2[][]; angle: number; accent?: boolean; border?: number }
interface Column { kind: "column"; path: P2[]; width: number; closed?: boolean; accent?: boolean; z?: number }
interface Knots { kind: "knots"; c: P2; r: number; accent?: boolean }
type Elem = Fill | Column | Knots;

/** Each motif: its elements and the accent thread color used in "duo". */
function motif(name: string): { elems: Elem[]; accent?: string } {
  const deg = Math.PI / 180;
  switch (name) {
    case "star": {
      const st = starShape(0.5, 0.22);
      const elems: Elem[] = [];
      for (let i = 0; i < 5; i++) {
        const tip = st[i * 2], inL = st[(i * 2 + 9) % 10], inR = st[i * 2 + 1];
        const ax = Math.atan2(tip[1], tip[0]);
        elems.push({ kind: "fill", poly: [[0, 0], inL, tip], angle: ax + 58 * deg });
        elems.push({ kind: "fill", poly: [[0, 0], tip, inR], angle: ax - 58 * deg });
      }
      elems.push({ kind: "column", path: st, width: 0.045, closed: true, z: 0.00045 });
      return { elems };
    }
    case "flower": {
      const elems: Elem[] = [];
      for (let j = 0; j < 5; j++) {
        const a = Math.PI / 2 + (j * 2 * Math.PI) / 5;
        elems.push({ kind: "fill", poly: ellipse(Math.cos(a) * 0.285, Math.sin(a) * 0.285, 0.2, 0.125, a, 36), angle: a + Math.PI / 2, border: j });
      }
      elems.push({ kind: "knots", c: [0, 0], r: 0.13, accent: true });
      return { elems, accent: "#F2B632" };
    }
    case "cherry": {
      const elems: Elem[] = [
        { kind: "fill", poly: ellipse(-0.17, -0.27, 0.165, 0.16), angle: 40 * deg },
        { kind: "fill", poly: ellipse(0.16, -0.3, 0.165, 0.16), angle: 40 * deg },
        { kind: "column", path: bezier([-0.13, -0.13], [-0.1, 0.05], [-0.02, 0.22], [0.07, 0.33]), width: 0.036, accent: true },
        { kind: "column", path: bezier([0.17, -0.155], [0.17, 0.0], [0.12, 0.2], [0.07, 0.33]), width: 0.036, accent: true },
      ];
      // Leaf: a lens along its axis, herringbone (each half slanted toward the vein).
      const lp = (side: number): P2[] => {
        const pts: P2[] = [];
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const x = 0.07 + 0.34 * t, w = 0.085 * Math.sin(Math.PI * t) ** 0.8;
          pts.push([x, 0.33 + 0.12 * t + side * w]);
        }
        return side > 0 ? pts.reverse() : pts;
      };
      const vein: P2[] = [];
      for (let i = 0; i <= 20; i++) vein.push([0.07 + 0.34 * (i / 20), 0.33 + 0.12 * (i / 20)]);
      const ax = Math.atan2(0.12, 0.34);
      elems.push({ kind: "fill", poly: ccw([...lp(-1), ...[...vein].reverse()].reverse()), angle: ax - 50 * deg, accent: true });
      elems.push({ kind: "fill", poly: ccw([...vein, ...lp(1)]), angle: ax + 50 * deg, accent: true });
      return { elems, accent: "#3F7D3A" };
    }
    case "bow": {
      const loopL: P2[] = ccw(fillet([[-0.05, 0.035], [-0.47, 0.25], [-0.43, -0.19], [-0.05, -0.035]], [0.02, 0.09, 0.09, 0.02], 6));
      const tailL: P2[] = ccw([[-0.03, -0.06], [-0.25, -0.46], [-0.17, -0.41], [-0.12, -0.48], [0.0, -0.09]]);
      return {
        elems: [
          { kind: "fill", poly: loopL, angle: 80 * deg },
          { kind: "fill", poly: mirrorPts(loopL), angle: 100 * deg },
          { kind: "fill", poly: tailL, angle: Math.atan2(-0.4, -0.2) + Math.PI / 2 },
          { kind: "fill", poly: mirrorPts(tailL), angle: Math.atan2(-0.4, 0.2) + Math.PI / 2 },
          { kind: "fill", poly: ccw(fillet([[-0.075, 0.09], [-0.075, -0.09], [0.075, -0.09], [0.075, 0.09]], 0.03, 5)), angle: 0, accent: true },
        ],
        accent: undefined,
      };
    }
    case "smiley":
      return {
        elems: [
          { kind: "column", path: arcPath(0, 0, 0.45, 0, Math.PI * 2, 96).slice(0, -1), width: 0.085, closed: true },
          { kind: "fill", poly: ellipse(-0.15, 0.11, 0.05, 0.09), angle: Math.PI / 2, accent: true },
          { kind: "fill", poly: ellipse(0.15, 0.11, 0.05, 0.09), angle: Math.PI / 2, accent: true },
          { kind: "column", path: arcPath(0, 0.02, 0.25, 200 * deg, 340 * deg, 40), width: 0.075, accent: true },
        ],
        accent: "#2A2A2D",
      };
    case "sparkle": {
      const sp = (s: number, cx: number, cy: number): Elem[] => {
        const tips: P2[] = [[0, 0.5], [-0.4, 0], [0, -0.5], [0.4, 0]];
        const elems: Elem[] = [];
        for (let i = 0; i < 4; i++) {
          const a = tips[i], b = tips[(i + 1) % 4];
          // Concave side between two tips: quadratic through a point near the center.
          const curve: P2[] = [];
          for (let k = 0; k <= 10; k++) {
            const t = k / 10, u = 1 - t;
            curve.push([u * u * a[0] + 2 * u * t * 0.06 * Math.sign(a[0] + b[0]) + t * t * b[0], u * u * a[1] + 2 * u * t * 0.06 * Math.sign(a[1] + b[1]) + t * t * b[1]]);
          }
          const half1 = ccw([[0, 0], ...curve.slice(0, 6)].map(([x, y]): P2 => [cx + x * s, cy + y * s]));
          const half2 = ccw([[0, 0], ...curve.slice(5)].map(([x, y]): P2 => [cx + x * s, cy + y * s]));
          const axA = Math.atan2(a[1], a[0]), axB = Math.atan2(b[1], b[0]);
          elems.push({ kind: "fill", poly: half1, angle: axA + Math.PI / 2 + 0.5 * Math.sign(Math.sin(axB - axA)) });
          elems.push({ kind: "fill", poly: half2, angle: axB + Math.PI / 2 - 0.5 * Math.sign(Math.sin(axB - axA)) });
        }
        return elems;
      };
      return { elems: [...sp(0.82, -0.08, -0.06), ...sp(0.32, 0.3, 0.32)] };
    }
    case "butterfly": {
      const up: P2[] = ccw(fillet([[-0.035, 0.07], [-0.17, 0.4], [-0.47, 0.42], [-0.49, 0.12], [-0.27, -0.02], [-0.035, -0.01]], [0.02, 0.1, 0.14, 0.14, 0.08, 0.02], 8));
      const lo: P2[] = ccw(fillet([[-0.035, -0.03], [-0.31, -0.06], [-0.38, -0.31], [-0.19, -0.44], [-0.04, -0.2]], [0.02, 0.08, 0.12, 0.1, 0.03], 8));
      const wing = (poly: P2[], angle: number): Elem[] => [
        { kind: "fill", poly, angle },
        { kind: "column", path: poly, width: 0.032, closed: true, z: 0.00042 },
      ];
      return {
        elems: [
          ...wing(up, 40 * deg), ...wing(mirrorPts(up), 140 * deg), ...wing(lo, 125 * deg), ...wing(mirrorPts(lo), 55 * deg),
          { kind: "column", path: [[0, 0.17], [0, -0.33]], width: 0.075, accent: true, z: 0.0005 },
          { kind: "column", path: bezier([-0.01, 0.17], [-0.03, 0.3], [-0.08, 0.38], [-0.15, 0.45]), width: 0.022, accent: true },
          { kind: "column", path: bezier([0.01, 0.17], [0.03, 0.3], [0.08, 0.38], [0.15, 0.45]), width: 0.022, accent: true },
        ],
        accent: "#2A2A2D",
      };
    }
    default: {
      // heart: two halves with mirrored slants (a chevron down the middle) inside a raised border.
      const h = heartShape();
      return {
        elems: [
          { kind: "fill", poly: clipConvex(h, halfPlane(-1)), angle: 62 * deg },
          { kind: "fill", poly: clipConvex(h, halfPlane(1)), angle: 118 * deg },
          { kind: "column", path: h, width: 0.075, closed: true, z: 0.00045 },
        ],
      };
    }
  }
}

function embroidery(p: Params): Piece[] {
  const S = p.size;
  const k = new Kit(p.bend);
  const m = motif(opt(LO.embroidery, p.motif));
  const duo = opt(LO.colors, p.colors) === "duo";
  const accentMat: MatRef = duo && m.accent ? { preset: "satin", color: m.accent } : "main";
  const r = 0.00022, gap = 0.00044;
  const sc = (q: P2): P2 => [q[0] * S, q[1] * S];
  for (const e of m.elems) {
    const mat = e.accent ? accentMat : "main";
    if (e.kind === "fill") {
      const poly = ccw(e.poly.map(sc));
      // Underlay so no fabric shows between stitches, then the top stitches.
      k.fabric(panel({ outline: poly, t: 0.00018, rim: 0.00012, step: 0.0008, size: () => 0.003, rings: 2 }).geo, mat);
      k.thread(satin(fillSegs(poly, (e.holes ?? []).map((h) => h.map(sc)), e.angle, gap, 0.0065), 0.00016 + (e.border !== undefined ? 0.00003 * (e.border % 3) : 0), r), mat);
    } else if (e.kind === "column") {
      const path = e.path.map(sc);
      k.thread(satin(columnSegs(path, e.width * S, gap * 0.95, !!e.closed), e.z ?? 0.00012, r), mat);
    } else {
      k.thread(knots(e.c[0] * S, e.c[1] * S, e.r * S, clamp(S * 0.018, 0.00045, 0.0009)), mat);
    }
  }
  return k.finish();
}

// ---------- print_graphic ----------

interface Region { outer: P2[]; holes: P2[][] }

function printShapes(name: string): Region[] {
  switch (name) {
    case "star":
      return [{ outer: ccw(fillet(starShape(0.5, 0.235), 0.018, 4)), holes: [] }];
    case "flower": {
      const pts: P2[] = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const r = 0.5 * (0.5 + 0.5 * Math.abs(Math.cos(2.5 * (a - Math.PI / 2))) ** 0.7);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return [{ outer: ccw(pts), holes: [ellipse(0, 0, 0.14, 0.14, 0, 48)] }, { outer: ccw(ellipse(0, 0, 0.095, 0.095, 0, 40)), holes: [] }];
    }
    case "smiley": {
      const mouth: P2[] = [...arcPath(0, 0.04, 0.3, 205 * (Math.PI / 180), 335 * (Math.PI / 180), 30), ...arcPath(0, 0.1, 0.25, 330 * (Math.PI / 180), 210 * (Math.PI / 180), 30)];
      return [{ outer: ccw(ellipse(0, 0, 0.5, 0.5, 0, 96)), holes: [ellipse(-0.16, 0.13, 0.055, 0.1, 0, 28), ellipse(0.16, 0.13, 0.055, 0.1, 0, 28), mouth] }];
    }
    case "wave": {
      const circle = ccw(ellipse(0, 0, 0.5, 0.5, 0, 96));
      const out: Region[] = [];
      for (let b = 0; b < 4; b++) {
        const y0 = 0.36 - b * 0.24;
        const top: P2[] = [], bot: P2[] = [];
        for (let i = 0; i <= 48; i++) {
          const x = -0.6 + (1.2 * i) / 48;
          const w = 0.045 * Math.sin(x * 12 + b * 1.3);
          top.push([x, y0 + w]);
          bot.push([x, y0 + w - 0.13]);
        }
        const band = ccw([...bot, ...top.reverse()]);
        // Clip the band to the badge circle (convex window).
        const clipped = clipConvex(band, circle);
        if (clipped.length > 2) out.push({ outer: ccw(clipped), holes: [] });
      }
      return out;
    }
    case "checker": {
      const out: Region[] = [{ outer: ccw([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]), holes: [[[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]] }];
      const n = 5, c = 0.86 / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if ((i + j) % 2) continue;
          const x0 = -0.43 + i * c, y0 = -0.43 + j * c;
          out.push({ outer: [[x0, y0], [x0 + c, y0], [x0 + c, y0 + c], [x0, y0 + c]], holes: [] });
        }
      }
      return out;
    }
    case "bolt":
      return [{ outer: ccw(fillet([[0.1, 0.5], [-0.3, -0.04], [-0.02, -0.04], [-0.14, -0.5], [0.32, 0.1], [0.05, 0.1], [0.24, 0.5]], 0.012, 3)), holes: [] }];
    default:
      return [{ outer: heartShape(128), holes: [] }];
  }
}

function printGraphic(p: Params): Piece[] {
  const S = p.size;
  const k = new Kit(p.bend);
  const regions = printShapes(opt(LO.print, p.motif)).map((r) => ({ outer: r.outer.map(([x, y]): P2 => [x * S, y * S]), holes: r.holes.map((h) => h.map(([x, y]): P2 => [x * S, y * S])) }));
  const ink = 0.00019;
  if (opt(LO.finish, p.finish) === "solid") {
    for (const r of regions) k.fabric(panel({ outline: r.outer, holes: r.holes, t: ink, rim: 0.00012, step: 0.0009, size: () => 0.003, rings: 2 }).geo, "main", 0.9);
    return k.finish();
  }
  // Cracked: the ink film breaks into irregular (Voronoi) islands; fabric shows in the cracks and
  // where a few flakes came off. Interior islands are whole cells; cells on the artwork's edge are
  // clipped against its triangulation, which keeps holes (eyes, centers) exact.
  const cell = clamp(S * 0.032, 0.002, 0.005);
  const crack = clamp(cell * 0.06, 0.00012, 0.00028);
  const rnd = rng(1234);
  const half = S * 0.56;
  const n = Math.ceil((2 * half) / cell);
  const sites: P2[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) sites.push([-half + (i + 0.5 + (rnd() - 0.5) * 0.9) * cell, -half + (j + 0.5 + (rnd() - 0.5) * 0.9) * cell]);
  const grid = new Map<number, number[]>();
  sites.forEach(([x, y], i) => {
    const kk = Math.floor((x + half) / cell) * 4096 + Math.floor((y + half) / cell);
    const l = grid.get(kk);
    if (l) l.push(i);
    else grid.set(kk, [i]);
  });
  const prepared = regions.map((r) => {
    const tri = THREE.ShapeUtils.triangulateShape(r.outer.map(([x, y]) => new THREE.Vector2(x, y)), r.holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
    const pts = [...r.outer, ...r.holes.flat()];
    const tris = tri.map((t) => ccw([pts[t[0]], pts[t[1]], pts[t[2]]]));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of r.outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { ...r, tris, box: [x0, y0, x1, y1] };
  });
  const islands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sites.length; i++) {
    const [sx, sy] = sites[i];
    // Half the crack, so each bisector moves toward this site (cells come out shrunk and convex).
    const gapHalf = (crack / 2) * (0.6 + rnd() * 0.9);
    // Voronoi cell: a box around the site cut by the bisectors with nearby sites.
    let poly: P2[] = [[sx - 2 * cell, sy - 2 * cell], [sx + 2 * cell, sy - 2 * cell], [sx + 2 * cell, sy + 2 * cell], [sx - 2 * cell, sy + 2 * cell]];
    const gx = Math.floor((sx + half) / cell), gy = Math.floor((sy + half) / cell);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (const j of grid.get((gx + dx) * 4096 + gy + dy) ?? []) {
          if (j === i) continue;
          const [ox, oy] = sites[j];
          const dl = Math.hypot(ox - sx, oy - sy);
          const nx = ox - sx, ny = oy - sy;
          const mx = (sx + ox) / 2 - (nx / dl) * gapHalf, my = (sy + oy) / 2 - (ny / dl) * gapHalf;
          // The site's side of the bisector, as a big convex window (CCW).
          const tx = -ny * 50, ty = nx * 50, bx = -nx * 50, by = -ny * 50;
          poly = clipConvex(poly, [[mx - tx, my - ty], [mx + tx, my + ty], [mx + tx + bx, my + ty + by], [mx - tx + bx, my - ty + by]].map((q) => q as P2));
        }
      }
    }
    if (poly.length < 3 || rnd() < 0.025) continue;
    const win = ccw(poly);
    const h = ink * (0.8 + rnd() * 0.35);
    let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
    for (const [x, y] of win) { cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); }
    for (const r of prepared) {
      if (cx1 < r.box[0] || cx0 > r.box[2] || cy1 < r.box[1] || cy0 > r.box[3]) continue;
      const whole = win.every(([x, y]) => inside(r.outer, x, y) && !r.holes.some((ho) => inside(ho, x, y))) && [r.outer, ...r.holes].every((l) => distToPoly(l, sx, sy) > 2.2 * cell);
      if (whole) {
        islands.push(inkSlab(win, 0, h));
        continue;
      }
      for (const t of r.tris) {
        if (Math.max(t[0][0], t[1][0], t[2][0]) < cx0 || Math.min(t[0][0], t[1][0], t[2][0]) > cx1 || Math.max(t[0][1], t[1][1], t[2][1]) < cy0 || Math.min(t[0][1], t[1][1], t[2][1]) > cy1) continue;
        const piece = clipConvex(t, win);
        if (piece.length < 3 || Math.abs(polyArea(piece)) < 1e-10) continue;
        islands.push(inkSlab(piece, 0, h));
      }
    }
  }
  const g = mergeList(islands);
  if (g) k.fabric(g, "main", 0.6);
  return k.finish();
}

function polyArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a / 2;
}

// ---------- hang_tag ----------

let _eyelet: Piece[] | null = null;

function hangTag(p: Params): Piece[] {
  const S = p.size;
  const W = S * 0.52, H = S;
  const attach = opt(LO.attach, p.attach);
  const acc = new Acc();
  const drop = S * 0.32;
  const top = -drop;
  // Tag pose: hanging a little askew, resting on the garment.
  const tilt = -0.09, tz = 0.0016;
  const pose = (g: THREE.BufferGeometry) => g.rotateZ(tilt).translate(0, 0, tz);
  const holeY = top - W * 0.16;
  // Card: chamfered top corners, punched hole with a brass eyelet.
  const c = W * 0.2;
  const outline = fillet([[-W / 2, top - H], [W / 2, top - H], [W / 2, top - c], [W / 2 - c, top], [-W / 2 + c, top], [-W / 2, top - c]], [0.002, 0.002, 0.0008, 0.0008, 0.0008, 0.0008], 5);
  const hole = ellipse(0, holeY, 0.0021, 0.0021, 0, 28);
  const card = panel({ outline, holes: [hole], t: 0.0005, rim: 0.0002, size: () => 0.006, step: 0.002, rings: 2 });
  acc.add(pose(card.geo), "main", { crease: 0.9 });
  _eyelet ??= grommet();
  for (const pc of _eyelet) acc.add(pose(pc.geo.clone().scale(0.42, 0.42, 0.5).translate(0, holeY, 0.0003)), pc.mat === "main" ? M.brass : pc.mat, { crease: 0.7 });
  // Print: wordmark under the hole, a rule, and a barcode block near the bottom.
  const zi = 0.00051;
  const print: THREE.BufferGeometry[] = [];
  const px = Math.min((W * 0.7) / textWidth("WISH IT", 1), S * 0.012);
  for (const [x0, x1, y] of textRuns("WISH IT", px, 0, top - H * 0.3)) print.push(inkSlab([[x0, y - px / 2], [x1, y - px / 2], [x1, y + px / 2], [x0, y + px / 2]], zi, 0.00002));
  const px2 = px * 0.45;
  for (const [x0, x1, y] of textRuns("MADE WITH LOVE", px2, 0, top - H * 0.3 - px * 6)) print.push(inkSlab([[x0, y - px2 / 2], [x1, y - px2 / 2], [x1, y + px2 / 2], [x0, y + px2 / 2]], zi, 0.00002));
  const ry = top - H * 0.52;
  print.push(inkSlab([[-W * 0.3, ry - 0.00012], [W * 0.3, ry - 0.00012], [W * 0.3, ry + 0.00012], [-W * 0.3, ry + 0.00012]], zi, 0.00002));
  const rnd = rng(42);
  const bw = W * 0.66, by0 = top - H * 0.86, bh = H * 0.16;
  // White label block, bars, digits.
  let x = -bw / 2;
  const unit = bw / 95;
  while (x < bw / 2 - unit * 2) {
    const w = unit * (1 + Math.floor(rnd() * 3));
    if (x + w > bw / 2) break;
    print.push(inkSlab([[x, by0], [x + w, by0], [x + w, by0 + bh], [x, by0 + bh]], zi, 0.00002));
    x += w + unit * (1 + Math.floor(rnd() * 3));
  }
  const px3 = Math.min(bh * 0.07, (bw * 0.95) / textWidth("0 123456 789012", 1));
  for (const [x0, x1, y] of textRuns("0 123456 789012", px3, 0, by0 - px3 * 5)) print.push(inkSlab([[x0, y - px3 / 2], [x1, y - px3 / 2], [x1, y + px3 / 2], [x0, y + px3 / 2]], zi, 0.00002));
  const pg = mergeList(print);
  if (pg) acc.add(pose(pg), printInk, { crease: 0.5 });
  // Hole center after the pose (the cord meets it there).
  const hc = new THREE.Vector3(0, holeY, 0).applyAxisAngle(v3(0, 0, 1), tilt);
  const cordMat: PartMaterial = { preset: "cotton", color: "#1E1E21" };
  if (attach === "barb") {
    // Plastic tagging barb: a T-bar on the garment, a fine filament, a T-bar at the hole.
    const plastic: PartMaterial = { preset: "plastic_gloss", color: "#EFEDE6" };
    acc.add(new THREE.CapsuleGeometry(0.00045, 0.005, 3, 8).rotateZ(Math.PI / 2).translate(0, 0, 0.0005), plastic);
    const fil = new THREE.CatmullRomCurve3([v3(0, 0, 0.0006), v3(0.0006, -drop * 0.35, 0.0017), v3(hc.x * 0.6, hc.y * 0.75, 0.0024), v3(hc.x, hc.y, tz + 0.0007)]);
    acc.add(new THREE.TubeGeometry(fil, 40, 0.00018, 6, false), plastic);
    acc.add(new THREE.CapsuleGeometry(0.0004, 0.0042, 3, 8).rotateZ(Math.PI / 2 + tilt).translate(hc.x, hc.y, tz + 0.0009), plastic);
  } else {
    // Cord loop: both strands from the attachment point down to the hole, a seal bead where they meet.
    const zTop = attach === "pin" ? 0.0022 : 0.001;
    const bead = new THREE.Vector3(hc.x * 0.4, -drop * 0.42, 0.0032);
    for (const sx of [-1, 1]) {
      const cord = new THREE.CatmullRomCurve3([
        v3(sx * 0.0016, 0.0002, zTop), v3(sx * 0.0018, -drop * 0.15, 0.003), v3(bead.x + sx * 0.0006, bead.y + 0.002, bead.z), v3(bead.x + sx * 0.0004, bead.y, bead.z),
        v3(hc.x * 0.8 + sx * 0.0012, (bead.y + hc.y) / 2, tz + 0.0026), v3(hc.x + sx * 0.0008, hc.y + 0.0016, tz + 0.0012), v3(hc.x + sx * 0.0004, hc.y, tz + (sx > 0 ? -0.0004 : 0.0011)),
      ], false, "centripetal");
      acc.add(braidTube(cord, 90, 0.00042, 8, 2, 0.0022, 0.18), cordMat);
    }
    acc.add(new THREE.CylinderGeometry(0.0012, 0.0012, 0.0034, 16).translate(bead.x, bead.y, bead.z), M.blackGloss, { crease: 0.6 });
    if (attach === "string") acc.add(new THREE.TorusGeometry(0.0019, 0.00042, 8, 24).translate(0, 0.0004, zTop), cordMat);
    else addSafetyPin(acc, zTop);
  }
  return acc.finish();
}

/** A small brass safety pin lying across the origin, its point dipping through the fabric. */
function addSafetyPin(acc: Acc, zc: number) {
  const brass = M.brass;
  const L = 0.019, r = 0.00034;
  const xL = -L / 2 + 0.0015, xR = L / 2 - 0.0026;
  // Closed bar (the cord hangs from it), raised; the pin bar below it dives through the cloth.
  acc.add(new THREE.TubeGeometry(new THREE.LineCurve3(v3(xL, 0.0012, zc), v3(xR, 0.0012, zc)), 8, r, 8), brass);
  acc.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3(xL, -0.0012, zc - 0.0003), v3(xL + 0.004, -0.0012, 0.0001), v3(0, -0.0012, -0.0012), v3(xR - 0.004, -0.0012, 0.0001), v3(xR + 0.001, -0.0012, zc - 0.0002)]), 40, r * 0.9, 8), brass);
  // Coiled spring at the left end.
  const coil: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI / 2 + (i / 48) * Math.PI * 2.5;
    coil.push(v3(xL - 0.0011 - 0.0011 * Math.cos(a - Math.PI / 2) * 0 - (i / 48) * 0.0006, Math.sin(a) * 0.0012, zc - 0.00015 + Math.cos(a) * 0.0012 * 0.35));
  }
  acc.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 60, r, 8), brass);
  // Head: the folded clasp cap at the right end.
  acc.add(rbox(0.0034, 0.0034, 0.0016, 0.0006, 3).translate(L / 2 - 0.0019, 0, zc - 0.0001), brass);
}

export const LABEL_BUILDERS: Record<string, Builder> = {
  woven_label: wovenLabel,
  leather_patch: leatherPatch,
  embroidery,
  print_graphic: printGraphic,
  hang_tag: hangTag,
};
