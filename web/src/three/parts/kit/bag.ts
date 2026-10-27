import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import { boxProjectUVs } from "../uv.ts";
import {
  Acc, type Builder, type KitPath, type MatRef, type Params, type Piece, chaikin, circleHole, clamp, contrastThread, extrude,
  lathe, latheZ, luminance, polyShape, rbox, rrect, rrectHole, rrectPath, rrectProfile, smoothNormals, stitch2D, stitchRow, sweep, tube, v3,
} from "./core.ts";
import { screwHead } from "./fasteners.ts";

/**
 * Detail module builders: bag hardware and finishing (catalog entries in shared/modules/bag.ts).
 * Everything is modelled in millimetres-as-meters at real size; metal pieces are "main" (the part
 * IS the hardware), leather / silk modules make their dominant piece "main" and take secondary
 * finishes from enum params.
 */

type V = THREE.Vector3;
type V2 = [number, number];
const MM = 0.001;

// ---------- Finishes ----------

const isMetal = (m: PartMaterial) => m.preset === "metal_polished" || m.preset === "metal_brushed";
const shade = (hex: string, k: number) => "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();

/** Secondary metal finishes (enum "metal" params), in catalog option order. */
const METALS: PartMaterial[] = [
  { preset: "metal_polished", color: "#E3BA5F", roughness: 0.2 },
  { preset: "metal_polished", color: "#D3D6DB", roughness: 0.14 },
  { preset: "metal_polished", color: "#5A5C61", roughness: 0.26 },
  { preset: "metal_polished", color: "#E0A88C", roughness: 0.2 },
  { preset: "metal_polished", color: "#232427", roughness: 0.3 },
];
const metalOf = (i: number) => METALS[clamp(Math.round(i), 0, METALS.length - 1)];

/** Leather colors (enum "tab" / "ribbon" params), in catalog option order. */
const LEATHER_HEX = ["#17171A", "#8A4B25", "#B8875A", "#EAE0CC", "#9E1B2C", "#1E2A44", "#F2F0EB", "#5A1A26"];
const leatherOf = (i: number): PartMaterial => ({ preset: "leather", color: LEATHER_HEX[clamp(Math.round(i), 0, LEATHER_HEX.length - 1)] });

/** Fur / plush colors for charms. */
const FUR_HEX = ["#EFE4CF", "#F7F5F0", "#F2B9C8", "#C9B6E0", "#7A5236", "#1C1B1D", "#9B9CA1"];

/** Shadowed recess of a metal piece (screw drive, engraving): a dark brushed version of the metal. */
const recessOf = (m: PartMaterial) => getMaterial({ preset: "metal_brushed", color: shade(m.color, 0.42), roughness: 0.62 });
/** Engraving: a satin-cut line in a deeper tone of the metal, read against the mirror-polished face. */
const engraveOf = (m: PartMaterial) => getMaterial({ preset: "metal_brushed", color: shade(m.color, 0.55), roughness: 0.5 });
/** Lacquered edge paint: a gloss coat in a (slightly deepened) leather color. */
const edgeGloss = (hex: string, k = 0.82) => ({ preset: "patent_leather", color: shade(hex, k) }) as PartMaterial;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Geometry helpers ----------

/** Box-projected meter UVs, scaled finer: small leather trims are cut from finer-grain calf than a bag body. */
function fineGrain(g: THREE.BufferGeometry, k = 1.7): THREE.BufferGeometry {
  if (!g.attributes.normal) g.computeVertexNormals();
  boxProjectUVs(g);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  g.userData.meterUV = true;
  return g;
}

/** Indexed quad grid (rows along a path, columns around a profile) with smooth normals. */
function gridGeo(rows: V[][], closedRows: boolean, closedCols: boolean): THREE.BufferGeometry {
  const nr = rows.length, nc = rows[0].length;
  const pos = new Float32Array(nr * nc * 3);
  rows.forEach((row, i) => row.forEach((v, j) => pos.set([v.x, v.y, v.z], (i * nc + j) * 3)));
  const idx: number[] = [];
  const ri = closedRows ? nr : nr - 1, ci = closedCols ? nc : nc - 1;
  for (let i = 0; i < ri; i++) {
    for (let j = 0; j < ci; j++) {
      const i2 = (i + 1) % nr, j2 = (j + 1) % nc;
      const a = i * nc + j, b = i2 * nc + j, c = i2 * nc + j2, d = i * nc + j2;
      idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const s = smoothNormals(g);
  g.dispose();
  return s;
}

interface Frame {
  p: V;
  /** Tangent. */
  t: V;
  /** Surface normal (out of the surface). */
  n: V;
  /** W = N x T: into the garment / panel for template paths. */
  w: V;
}

/**
 * Sweep a closed CCW profile ([x along W, y along N]) through frames. `profile(i)` may vary per frame.
 * Open sweeps get flat caps.
 */
function sweepFrames(fr: Frame[], profile: (i: number) => V2[], closed = false, caps = !closed): THREE.BufferGeometry {
  const rows = fr.map((f, i) => profile(i).map(([x, y]) => f.p.clone().addScaledVector(f.w, x).addScaledVector(f.n, y)));
  const body = gridGeo(rows, closed, true);
  if (!caps) return body;
  const capVerts: number[] = [];
  const capFor = (ri: number, outward: V) => {
    const ring = rows[ri];
    const prof = profile(ri);
    const tris = THREE.ShapeUtils.triangulateShape(prof.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const tri of tris) {
      const [a, b, c] = [ring[tri[0]], ring[tri[1]], ring[tri[2]]];
      const nrm = b.clone().sub(a).cross(c.clone().sub(a));
      for (const v of nrm.dot(outward) < 0 ? [a, c, b] : [a, b, c]) capVerts.push(v.x, v.y, v.z);
    }
  };
  capFor(0, fr[0].t.clone().negate());
  capFor(fr.length - 1, fr[fr.length - 1].t.clone());
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(capVerts, 3));
  cap.computeVertexNormals();
  const flat = body.toNonIndexed();
  body.dispose();
  const out = new THREE.BufferGeometry();
  const a = flat.attributes.position.array as Float32Array, an = flat.attributes.normal.array as Float32Array;
  const b = cap.attributes.position.array as Float32Array, bn = cap.attributes.normal.array as Float32Array;
  const P = new Float32Array(a.length + b.length), N = new Float32Array(a.length + b.length);
  P.set(a); P.set(b, a.length); N.set(an); N.set(bn, an.length);
  out.setAttribute("position", new THREE.BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  flat.dispose();
  cap.dispose();
  return out;
}

/** Any unit vector perpendicular to t. */
function perp(t: V): V {
  const a = Math.abs(t.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
  return a.addScaledVector(t, -a.dot(t)).normalize();
}

/**
 * Arc-length frames along a kit path: a smooth centripetal spline through the points, surface
 * normals interpolated from path.normals (default +Z) and made perpendicular to the tangent.
 * A path whose last point equals its first is closed.
 */
class PathFrames {
  readonly L: number;
  readonly closed: boolean;
  private tab: Frame[] = [];
  private ds: number;

  constructor(path: KitPath | undefined) {
    const raw = path?.points?.length ? path.points : [[-0.1, 0, 0], [0.1, 0, 0]] as [number, number, number][];
    const P: V[] = [], Nn: V[] = [];
    raw.forEach((q, i) => {
      const p = v3(q[0], q[1], q[2]);
      const nq = path?.normals?.[i];
      const n = nq ? v3(nq[0], nq[1], nq[2]) : v3(0, 0, 1);
      if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
      if (!P.length || p.distanceTo(P[P.length - 1]) > 1e-7) {
        P.push(p);
        Nn.push(n.normalize());
      }
    });
    this.closed = P.length > 3 && P[0].distanceTo(P[P.length - 1]) < 1e-5;
    if (this.closed) {
      P.pop();
      Nn.pop();
    }
    if (P.length < 2) {
      P.push(P[0].clone().add(v3(0.01, 0, 0)));
      Nn.push(Nn[0].clone());
    }
    const curve = new THREE.CatmullRomCurve3(P, this.closed, "centripetal");
    curve.arcLengthDivisions = Math.max(200, P.length * 12);
    this.L = Math.max(1e-5, curve.getLength());
    const cum = [0];
    const segN = this.closed ? P.length : P.length - 1;
    for (let i = 0; i < segN; i++) cum.push(cum[i] + P[i].distanceTo(P[(i + 1) % P.length]));
    const polyL = cum[cum.length - 1] || 1;
    const count = clamp(Math.ceil(this.L / 0.0005), 64, 4000);
    this.ds = this.L / count;
    let k = 0;
    for (let i = 0; i <= count; i++) {
      const u = Math.min(1, i / count);
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u).normalize();
      const s = u * polyL;
      while (k < segN - 1 && cum[k + 1] < s) k++;
      const f = clamp((s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), 0, 1);
      const n = Nn[k].clone().lerp(Nn[(k + 1) % Nn.length], f);
      n.addScaledVector(t, -n.dot(t));
      if (n.lengthSq() < 1e-10) n.copy(perp(t));
      n.normalize();
      this.tab.push({ p, t, n, w: n.clone().cross(t).normalize() });
    }
  }

  /** Frame at arc length s (clamped on open paths, wrapped on closed ones). */
  at(s: number): Frame {
    s = this.closed ? ((s % this.L) + this.L) % this.L : clamp(s, 0, this.L);
    const x = s / this.ds;
    const i = Math.min(this.tab.length - 2, Math.floor(x));
    const f = x - i;
    const A = this.tab[i], B = this.tab[i + 1];
    const t = A.t.clone().lerp(B.t, f).normalize();
    const n = A.n.clone().lerp(B.n, f);
    n.addScaledVector(t, -n.dot(t));
    if (n.lengthSq() < 1e-10) n.copy(perp(t));
    n.normalize();
    return { p: A.p.clone().lerp(B.p, f), t, n, w: n.clone().cross(t).normalize() };
  }

  /** Evenly spaced frames from s0 to s1 (whole loop, without the duplicate end, when closed). */
  sample(step: number, s0 = 0, s1 = this.L, loop = false): Frame[] {
    const span = s1 - s0;
    const n = Math.max(loop ? 8 : 2, Math.ceil(span / step) + (loop ? 0 : 1));
    const out: Frame[] = [];
    for (let i = 0; i < n; i++) out.push(this.at(s0 + (span * i) / (loop ? n : n - 1)));
    return out;
  }
}

/** Tube through points (smooth spline). */
function tubeThrough(pts: V[], r: number, radial = 6, closed = false, segsPerPt = 1): THREE.BufferGeometry {
  const c = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  return tube(c, Math.max(4, Math.round(pts.length * segsPerPt)), r, radial, closed);
}

/** Basis matrix mapping local x, y, z to the given axes, placed at p. */
function basis(x: V, y: V, z: V, p: V): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}

/** Phillips screw with its head in `mat` and the drive recess shaded, crown facing +Z at (x, y, z). */
function addScrew(acc: Acc, mat: MatRef, s: number, x: number, y: number, z: number, spin = 0.5) {
  const [head, floor] = screwHead(s);
  acc.add(head.rotateZ(spin).translate(x, y, z), mat, { crease: 0.7 });
  acc.add(floor.rotateZ(spin).translate(x, y, z), recessOf, { crease: 0.5 });
}

/** Raised fine bead line following a closed 2D path at height z (engraved-border look on plates). */
function beadLine(path: THREE.Path, z: number, r: number, n = 120): THREE.BufferGeometry {
  const pts = path.getSpacedPoints(n).slice(0, -1).map((q) => v3(q.x, q.y, z));
  return tubeThrough(pts, r, 6, true, 1.5);
}

// ---------- Stroke lettering ----------

type Stroke = V2[];
function arcS(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): Stroke {
  const out: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
const PI = Math.PI;

/** A small single-stroke capital font on a 1-high em (generic engraving, not any brand's letterforms). */
const GLYPHS: Record<string, { w: number; s: Stroke[] }> = {
  A: { w: 0.62, s: [[[0, 0], [0.31, 1], [0.62, 0]], [[0.12, 0.36], [0.5, 0.36]]] },
  B: { w: 0.54, s: [[[0, 0.52], [0, 1], [0.27, 1], ...arcS(0.27, 0.76, 0.22, 0.24, PI / 2, -PI / 2, 8), [0, 0.52], [0.29, 0.52], ...arcS(0.29, 0.26, 0.25, 0.26, PI / 2, -PI / 2, 8), [0, 0], [0, 0.52]]] },
  C: { w: 0.62, s: [arcS(0.34, 0.5, 0.33, 0.5, 0.75, 2 * PI - 0.75, 16)] },
  D: { w: 0.6, s: [[[0, 0], [0, 1], [0.24, 1], ...arcS(0.24, 0.5, 0.36, 0.5, PI / 2, -PI / 2, 14), [0, 0]]] },
  E: { w: 0.5, s: [[[0.5, 1], [0, 1], [0, 0], [0.5, 0]], [[0, 0.52], [0.42, 0.52]]] },
  G: { w: 0.66, s: [[...arcS(0.34, 0.5, 0.33, 0.5, 0.75, 2 * PI, 18), [0.4, 0.5]]] },
  H: { w: 0.58, s: [[[0, 0], [0, 1]], [[0.58, 0], [0.58, 1]], [[0, 0.52], [0.58, 0.52]]] },
  I: { w: 0, s: [[[0, 0], [0, 1]]] },
  K: { w: 0.56, s: [[[0, 0], [0, 1]], [[0.56, 1], [0, 0.4]], [[0.17, 0.6], [0.58, 0]]] },
  L: { w: 0.48, s: [[[0, 1], [0, 0], [0.48, 0]]] },
  M: { w: 0.72, s: [[[0, 0], [0, 1], [0.36, 0.28], [0.72, 1], [0.72, 0]]] },
  N: { w: 0.58, s: [[[0, 0], [0, 1], [0.58, 0], [0.58, 1]]] },
  O: { w: 0.7, s: [arcS(0.35, 0.5, 0.35, 0.5, 0, 2 * PI, 24)] },
  P: { w: 0.54, s: [[[0, 0], [0, 1], [0.29, 1], ...arcS(0.29, 0.74, 0.25, 0.26, PI / 2, -PI / 2, 10), [0, 0.48]]] },
  R: { w: 0.56, s: [[[0, 0], [0, 1], [0.29, 1], ...arcS(0.29, 0.74, 0.25, 0.26, PI / 2, -PI / 2, 10), [0, 0.48]], [[0.27, 0.48], [0.56, 0]]] },
  S: { w: 0.56, s: [[...arcS(0.28, 0.75, 0.26, 0.25, 0.4, 1.5 * PI, 12), ...arcS(0.28, 0.25, 0.28, 0.25, PI / 2, -PI + 0.4, 12).slice(1)]] },
  T: { w: 0.6, s: [[[0, 1], [0.6, 1]], [[0.3, 1], [0.3, 0]]] },
  U: { w: 0.58, s: [[[0, 1], [0, 0.32], ...arcS(0.29, 0.32, 0.29, 0.32, PI, 2 * PI, 12), [0.58, 1]]] },
  V: { w: 0.6, s: [[[0, 1], [0.3, 0], [0.6, 1]]] },
  W: { w: 0.86, s: [[[0, 1], [0.2, 0], [0.43, 0.72], [0.66, 0], [0.86, 1]]] },
  Y: { w: 0.6, s: [[[0, 1], [0.3, 0.5], [0.6, 1]], [[0.3, 0.5], [0.3, 0]]] },
};

/** Lay out a line of text: strokes in em units, centered on x = 0, baseline y = 0. */
function layoutText(text: string, tracking = 0.3): { strokes: Stroke[]; width: number } {
  const strokes: Stroke[] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === " ") {
      x += 0.42;
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) continue;
    for (const s of g.s) strokes.push(s.map(([a, b]) => [a + x, b] as V2));
    x += g.w + tracking;
  }
  const width = Math.max(0, x - tracking);
  for (const s of strokes) for (const p of s) p[0] -= width / 2;
  return { strokes, width };
}

/**
 * Flat engraved strokes (quads + round joints) on the plane z, scaled by `h` (cap height) and
 * offset by (ox, oy). Drawn as a thin dark inlay just above the polished face.
 */
function engraveStrokes(strokes: Stroke[], h: number, sw: number, ox: number, oy: number, z: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (a: V2, b: V2) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * sw / 2, ny = (dx / l) * sw / 2;
    const A: V2 = [a[0] + nx, a[1] + ny], B: V2 = [b[0] + nx, b[1] + ny], C: V2 = [b[0] - nx, b[1] - ny], D: V2 = [a[0] - nx, a[1] - ny];
    for (const p of [A, D, C, A, C, B]) pos.push(p[0], p[1], z);
  };
  const dot = (c: V2) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * PI, a1 = ((i + 1) / n) * 2 * PI;
      pos.push(c[0], c[1], z, c[0] + Math.cos(a0) * sw / 2, c[1] + Math.sin(a0) * sw / 2, z, c[0] + Math.cos(a1) * sw / 2, c[1] + Math.sin(a1) * sw / 2, z);
    }
  };
  for (const s of strokes) {
    const pts = s.map(([x, y]) => [ox + x * h, oy + y * h] as V2);
    for (let i = 0; i + 1 < pts.length; i++) quad(pts[i], pts[i + 1]);
    for (const p of pts) dot(p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return g;
}

// ---------- Turn lock ----------

function turnLock(p: Params): Piece[] {
  const k = p.size / 0.032;
  const mm = MM * k;
  const acc = new Acc();
  const style = Math.round(p.style);
  const crease = { crease: 0.75 };
  const screw = (x: number, y: number, z: number, spin: number) => addScrew(acc, "main", 0.42 * k, x * mm, y * mm, z * mm, spin);
  /** Post + rosette under a knob, standing on z0 (mm). */
  const post = (r: number, z0: number, z1: number) =>
    acc.add(latheZ([[0, z0 * mm], [r * mm, z0 * mm], [r * mm, (z1 - 0.3) * mm], [(r - 0.3) * mm, z1 * mm], [0, z1 * mm]], 40), "main", crease);

  if (style === 0) {
    // Twist: oval eyelet plate, the post through its slot, a T-bar knob turned to "locked".
    const outline = new THREE.Shape();
    outline.absellipse(0, 0, 16 * mm, 8.2 * mm, 0, 2 * PI, false, 0);
    outline.holes.push(rrectHole(12.5 * mm, 6.6 * mm, 3.3 * mm));
    acc.add(extrude(outline, 1.6 * mm, 0.6 * mm, { curveSegs: 40, bevelSegs: 4 }), "main", crease);
    const bead = new THREE.Path();
    bead.absellipse(0, 0, 14.6 * mm, 6.9 * mm, 0, 2 * PI, false, 0);
    acc.add(beadLine(bead, 1.6 * mm, 0.17 * mm), "main");
    // Slot liner: the rolled inner lip of the eyelet.
    const lip = rrectPath(new THREE.Path(), 12.5 * mm, 6.6 * mm, 3.3 * mm, 0, 0, false);
    acc.add(beadLine(lip, 1.35 * mm, 0.32 * mm, 80), "main");
    post(2.5, 0, 3.4);
    // T-bar: a pill with domed ends, standing vertical (locked), plus a center boss.
    acc.add(rbox(4.4 * mm, 14 * mm, 2.4 * mm, 1.1 * mm, 5).translate(0, 0, 4.4 * mm), "main", crease);
    acc.add(latheZ([[0, 5.5 * mm], [1.9 * mm, 5.5 * mm], [1.6 * mm, 6.0 * mm], [0, 6.15 * mm]], 32), "main", crease);
    for (const sx of [-1, 1]) screw(sx * 12.6, 0, 1.6, 0.4 + sx);
  } else if (style === 1) {
    // Push lock: rectangular housing, raised frame, push bar; the flap tongue enters the top.
    acc.add(rbox(28 * mm, 18 * mm, 4.2 * mm, 1.5 * mm, 4).translate(0, 0, 2.1 * mm), "main", crease);
    const frame = rrect(25 * mm, 15 * mm, 1.6 * mm);
    frame.holes.push(rrectHole(21.5 * mm, 11.5 * mm, 1.0 * mm));
    acc.add(extrude(frame, 0.6 * mm, 0.22 * mm, { z0: 4.05 * mm, curveSegs: 8, bevelSegs: 3 }), "main", crease);
    acc.add(rbox(12 * mm, 3.6 * mm, 2.2 * mm, 1.0 * mm, 4).translate(0, -3.4 * mm, 4.6 * mm), "main", crease);
    // Shadow line around the button well.
    const well = rrectPath(new THREE.Path(), 13.4 * mm, 5 * mm, 1.6 * mm, 0, -3.4 * mm, false);
    acc.add(beadLine(well, 4.2 * mm, 0.22 * mm, 60), recessOf);
    // Tongue: the flap's metal tab sliding into the housing from above.
    const tongue = rrect(12 * mm, 15 * mm, 2.5 * mm, 0, 15 * mm);
    acc.add(extrude(tongue, 1.4 * mm, 0.5 * mm, { z0: 1.6 * mm, curveSegs: 10, bevelSegs: 3 }), "main", crease);
    for (const sx of [-1, 1]) acc.add(latheZ([[0, 2.9 * mm], [1.1 * mm, 2.9 * mm], [1.05 * mm, 3.3 * mm], [0.6 * mm, 3.55 * mm], [0, 3.6 * mm]], 24).translate(sx * 3.4 * mm, 18.6 * mm, 0), "main", crease);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(sx * 11.3, sy * 6.2, 4.2, sx * sy);
  } else if (style === 2) {
    // Classic turn: rectangular window frame, four screws, rosette and a turn key across the window.
    const plate = rrect(34 * mm, 24 * mm, 3 * mm);
    plate.holes.push(rrectHole(21 * mm, 11 * mm, 2 * mm));
    acc.add(extrude(plate, 1.6 * mm, 0.55 * mm, { curveSegs: 12, bevelSegs: 4 }), "main", crease);
    acc.add(beadLine(rrectPath(new THREE.Path(), 31.6 * mm, 21.6 * mm, 2.1 * mm, 0, 0, false), 1.6 * mm, 0.16 * mm, 160), "main");
    acc.add(beadLine(rrectPath(new THREE.Path(), 23 * mm, 13 * mm, 2.6 * mm, 0, 0, false), 1.6 * mm, 0.16 * mm, 120), "main");
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(sx * 13.8, sy * 8.8, 1.6, 0.3 + sx * sy);
    // Rosette: stepped disc on the bag surface inside the window.
    acc.add(latheZ([[0, 0], [4.9 * mm, 0], [4.9 * mm, 1.0 * mm], [4.4 * mm, 1.5 * mm], [3.6 * mm, 1.6 * mm], [3.2 * mm, 2.4 * mm], [0, 2.5 * mm]], 48), "main", crease);
    // Key: flat bar with bevelled, slightly flared ends, standing vertical.
    const key = polyShape(chaikin([[-2.2, -9], [2.2, -9], [2.7, -7.6], [1.9, -3], [1.9, 3], [2.7, 7.6], [2.2, 9], [-2.2, 9], [-2.7, 7.6], [-1.9, 3], [-1.9, -3], [-2.7, -7.6]].map(([x, y]) => [x * mm, y * mm] as V2), 2));
    acc.add(extrude(key, 1.9 * mm, 0.6 * mm, { z0: 2.4 * mm, curveSegs: 6, bevelSegs: 4 }), "main", crease);
    acc.add(latheZ([[0, 4.2 * mm], [1.5 * mm, 4.2 * mm], [1.25 * mm, 4.65 * mm], [0, 4.8 * mm]], 32), "main", crease);
  } else {
    // Tongue: receiver plate on the body, metal tongue from the flap over it, knob through its slot.
    const plate = rrect(24 * mm, 15 * mm, 4 * mm, 0, -1 * mm);
    acc.add(extrude(plate, 1.4 * mm, 0.5 * mm, { curveSegs: 12, bevelSegs: 4 }), "main", crease);
    for (const sx of [-1, 1]) screw(sx * 9.4, -2.2, 1.4, sx * 0.7);
    const T: V2[] = [...arcS(0, -1.2, 7, 7, PI, 2 * PI, 28), ...arcS(5, 16, 2, 2, 0, PI / 2, 6), ...arcS(-5, 16, 2, 2, PI / 2, PI, 6)];
    const tongue = polyShape(T.map(([x, y]) => [x * mm, y * mm] as V2));
    tongue.holes.push(rrectHole(9 * mm, 4.6 * mm, 2.3 * mm, 0, 0));
    acc.add(extrude(tongue, 1.4 * mm, 0.5 * mm, { z0: 1.7 * mm, curveSegs: 10, bevelSegs: 4 }), "main", crease);
    const tb: V2[] = [...arcS(0, -1.2, 5.8, 5.8, PI, 2 * PI, 28), ...arcS(4.6, 15.6, 1.2, 1.2, 0, PI / 2, 5), ...arcS(-4.6, 15.6, 1.2, 1.2, PI / 2, PI, 5)];
    const tbPath = new THREE.Path(tb.map(([x, y]) => new THREE.Vector2(x * mm, y * mm)));
    tbPath.closePath();
    acc.add(beadLine(tbPath, 3.1 * mm, 0.15 * mm, 140), "main");
    for (const sx of [-1, 1]) acc.add(latheZ([[0, 3.0 * mm], [1.0 * mm, 3.0 * mm], [0.95 * mm, 3.35 * mm], [0.5 * mm, 3.6 * mm], [0, 3.65 * mm]], 24).translate(sx * 3.6 * mm, 14 * mm, 0), "main", crease);
    post(1.9, 0, 3.6);
    acc.add(rbox(3.4 * mm, 10 * mm, 1.9 * mm, 0.85 * mm, 5).translate(0, 0, 4.4 * mm), "main", crease);
  }
  return acc.finish();
}

// ---------- Bag foot ----------

function footStud(p: Params): Piece[] {
  const R = p.radius;
  const s = R / 0.0065;
  const acc = new Acc();
  // Stamped prong washer: a thin disc with a pressed step, slightly wider than the foot.
  const Rw = R * 1.28;
  acc.add(latheZ([[0, 0], [Rw - 0.0002 * s, 0], [Rw, 0.0002 * s], [Rw - 0.0001 * s, 0.00042 * s], [Rw * 0.9, 0.00045 * s], [Rw * 0.86, 0.0006 * s], [0, 0.0006 * s]], 64), "main", { crease: 0.5 });
  // Prong slots: two dark slits in the washer where the prongs fold under.
  for (const a of [0, PI]) {
    const slot = new THREE.ShapeGeometry(rrect(0.0007 * s, 0.0024 * s, 0.00035 * s, Math.cos(a) * R * 1.13, Math.sin(a) * R * 1.13), 6);
    acc.add(slot.translate(0, 0, 0.00046 * s), recessOf);
  }
  // Foot crown: lathe profile (bottom -> outside -> top), sits on the washer.
  const z0 = 0.0006 * s;
  const H = 0.0043 * s;
  const shape = Math.round(p.shape);
  let prof: V2[];
  if (shape === 1) {
    prof = [[0, z0], [R * 0.96, z0], [R, z0 + 0.0003 * s], [R, z0 + H * 0.66], [R * 0.95, z0 + H * 0.82], [R * 0.84, z0 + H * 0.9], [0, z0 + H * 0.9]];
  } else if (shape === 2) {
    prof = [[0, z0], [R * 0.96, z0], [R, z0 + 0.0003 * s], [R, z0 + H * 0.28], [R * 0.86, z0 + H * 0.36], [R * 0.2, z0 + H * 0.96], [0, z0 + H]];
  } else {
    prof = [[0, z0], [R * 0.96, z0], [R, z0 + 0.0003 * s], [R, z0 + H * 0.24], [R * 0.985, z0 + H * 0.3]];
    // Low crown: a flattened spherical cap, not a hemisphere.
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * (PI / 2);
      prof.push([R * 0.985 * Math.sin(PI / 2 - a), z0 + H * 0.3 + H * 0.7 * Math.sin(a) ** 0.85]);
    }
  }
  acc.add(latheZ(prof, 64), "main", { crease: 0.5 });
  // Hairline where the crown meets its skirt.
  acc.add(new THREE.TorusGeometry(R * 1.0, 0.00011 * s, 6, 64).translate(0, 0, z0 + H * (shape === 0 ? 0.24 : 0.3)), recessOf);
  return acc.finish();
}

// ---------- Chain strap ----------

/** One link centerline in its local frame (x along the chain, y across, z out of the surface). */
function linkGeo(style: number, Lk: number, segs: number, profN: number): { geo: THREE.BufferGeometry; pitch: number; half: number } {
  const box = style === 2;
  const woven = style === 1;
  const r = Lk * (box ? 0.1 : woven ? 0.095 : 0.11);
  const a = Lk / 2 - r, b = Lk * (box ? 0.5 : woven ? 0.4 : 0.36) - r;
  const ne = box ? 6 : 2.5;
  const tw = box ? 0 : r * 1.05;
  const sp = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / ne);
  const pts: V[] = [];
  for (let i = 0; i < segs; i++) {
    const f = (i / segs) * 2 * PI;
    pts.push(v3(a * sp(Math.cos(f)), b * sp(Math.sin(f)), tw * Math.sin(2 * f)));
  }
  // Flattened diamond-cut wire: flat facets on top and bottom catch the light.
  const prof: V2[] = [];
  for (let i = 0; i < profN; i++) {
    const f = (i / profN) * 2 * PI + PI / profN;
    prof.push([Math.cos(f) * r * (box ? 0.85 : 0.72), Math.sin(f) * r]);
  }
  const geo = sweep(pts, prof, v3(0, 0, 1), { closed: true });
  return { geo, pitch: 2 * a - 2.3 * r, half: (box ? 0.85 : 0.72) * r + tw };
}

function chainStrap(p: Params, path?: KitPath): Piece[] {
  const pf = new PathFrames(path);
  const acc = new Acc();
  const style = Math.round(p.style);
  const Lk = p.link;
  // Probe the pitch, then size the per-link mesh to keep the strap under ~40k triangles.
  const probe = linkGeo(style, Lk, 8, 4);
  probe.geo.dispose();
  const d0 = probe.pitch;
  const count = Math.max(2, Math.round((pf.closed ? pf.L : pf.L - Lk) / d0) + (pf.closed ? 0 : 1));
  const ribbonTris = style === 1 ? count * 5 * 12 : 0;
  const per = (38000 - ribbonTris) / count;
  const profN = per >= 380 ? 8 : per >= 180 ? 6 : 5;
  const segs = clamp(Math.floor(per / (2 * profN)), 8, 32);
  const { geo: base, pitch: d1, half } = linkGeo(style, Lk, segs, profN);
  const d = pf.closed ? pf.L / count : count > 1 ? (pf.L - Lk + 2 * 0.11 * Lk) / Math.max(1, count - 1) : d1;
  const s0 = pf.closed ? 0 : Lk / 2 - 0.11 * Lk;
  // Upright box links touch the surface; flat links ride at the chain's axis like a real chain.
  const lift = style === 1 ? half + 0.0009 : style === 2 ? Lk * 0.5 + 0.0002 : half + 0.0002;
  const centers: number[] = [];
  for (let i = 0; i < count; i++) centers.push(s0 + i * d);
  for (let i = 0; i < count; i++) {
    const s = centers[i];
    const f = pf.at(s);
    // Orient by the chord across the link so tight curves don't skew it.
    const ahead = pf.at(s + Lk * 0.35).p, behind = pf.at(s - Lk * 0.35).p;
    const T = ahead.sub(behind);
    if (T.lengthSq() < 1e-12) T.copy(f.t);
    T.normalize();
    const N = f.n.clone().addScaledVector(T, -f.n.dot(T)).normalize();
    const W = N.clone().cross(T).normalize();
    const P = f.p.clone().addScaledVector(N, lift);
    const g = base.clone();
    if (style === 2 && i % 2 === 1) g.applyMatrix4(basis(T, N, W.clone().negate(), P));
    else g.applyMatrix4(basis(T, W, N, P));
    acc.add(g, "main");
  }
  base.dispose();
  if (style === 1) {
    // Leather ribbon threaded through the links: over one crossing, under the next.
    const r = Lk * 0.095;
    const rw = 2 * (Lk * 0.4 - 2 * r) * 0.82;
    const rt = Math.max(0.0007, Lk * 0.09);
    const A = 0.72 * r + rt / 2 + 0.00015;
    const s1 = pf.closed ? pf.L : pf.L;
    const fr = pf.sample(d / 5, 0, s1, pf.closed);
    const o0 = s0 + d / 2;
    const L = pf.L;
    const zOf = (i: number) => {
      const s = pf.closed ? (L * i) / fr.length : (L * i) / (fr.length - 1);
      return A * Math.cos((PI * (s - o0)) / d);
    };
    const prof = rrectProfile(rw, rt, rt * 0.45, 1);
    const ribbon = fineGrain(sweepFrames(fr, (i) => prof.map(([x, y]) => [x, y + lift + zOf(i)] as V2), pf.closed));
    acc.add(ribbon, leatherOf(p.ribbon));
  }
  return acc.finish();
}

// ---------- Twilly handle wrap ----------

function handleWrap(p: Params, path?: KitPath): Piece[] {
  const pf = new PathFrames(path);
  const acc = new Acc();
  const L = pf.L;
  const w = Math.min(p.width, L * 0.5);
  const pitch = p.pitch;
  const R0 = p.handle + 0.0002;
  const t = 0.00055;
  const print = Math.round(p.print);
  const accent = (m: PartMaterial) => getMaterial({ preset: "satin", color: luminance(m.color) > 0.42 ? "#1F2B4A" : "#F1E7D3" });
  const hemMat: MatRef = print === 3 ? "main" : accent;
  const atStart = Math.round(p.tie) === 0;
  const knotted = p.tails > 0.005 && L > 0.06;
  const sk = atStart ? Math.min(0.016, L * 0.1) : L - Math.min(0.016, L * 0.1);
  const u0 = knotted && atStart ? sk + 0.004 : 0.004;
  const u1 = knotted && !atStart ? sk - 0.004 : L - 0.004;
  // Overlapping turns shingle: the trailing edge rides up over the previous turn.
  const over = pitch < w;
  const L0 = over ? (1.15 * t * w) / pitch : 0;
  const lift = (v: number) => L0 * (1 - v / (w / 2)) * 0.5;
  // Band cross-section (v along the handle, h radial): a soft pillowed strip.
  const NV = 7;
  const prof: V2[] = [];
  for (let j = 0; j <= NV; j++) {
    const x = -1 + (2 * j) / NV;
    prof.push([x * (w / 2), t * (0.55 + 0.45 * (1 - x * x))]);
  }
  prof.push([w / 2, 0.00005], [-w / 2, 0.00005]);
  const bandPt = (u: number, v: number, h: number, theta: number) => {
    const f = pf.at(u + v);
    const rad = f.n.clone().multiplyScalar(Math.cos(theta)).addScaledVector(f.w, Math.sin(theta));
    return f.p.clone().addScaledVector(rad, R0 + lift(v) + h);
  };
  const th = (u: number) => (2 * PI * (u - u0)) / pitch;
  const du = Math.min(pitch / 28, 0.0012);
  const nu = Math.max(2, Math.ceil((u1 - u0) / du));
  const us: number[] = [];
  for (let i = 0; i <= nu; i++) us.push(u0 + ((u1 - u0) * i) / nu);
  const topH = (v: number) => {
    const x = v / (w / 2);
    return t * (0.55 + 0.45 * (1 - x * x));
  };
  const rows: V[][] = [];
  for (let i = 0; i <= nu; i++) rows.push(prof.map(([v, h]) => bandPt(us[i], v, h, th(us[i]))));
  acc.add(gridGeo(rows, false, true), "main");
  // Stripes: two pinstripes printed along the band, so they spiral round the handle.
  if (print === 1) {
    for (const c of [-0.22, 0.22]) {
      const v0 = (c - 0.07) * w, v1 = (c + 0.07) * w;
      const strip: V[][] = [];
      for (let i = 0; i <= nu; i++) {
        const row: V[] = [];
        for (let j = 0; j <= 3; j++) {
          const v = v0 + ((v1 - v0) * j) / 3;
          row.push(bandPt(us[i], v, topH(v) + 0.00003, th(us[i])));
        }
        strip.push(row);
      }
      acc.add(gridGeo(strip, false, false), accent);
    }
  }
  // Rolled hems along both band edges.
  if (print !== 3) {
    for (const sv of [-1, 1]) {
      const v = sv * (w / 2 - 0.0002);
      const pts: V[] = [];
      for (let i = 0; i <= nu; i += 2) pts.push(bandPt(us[i], v, t * 0.45, th(us[i])));
      acc.add(tubeThrough(pts, 0.00034, 5, false, 1), hemMat);
    }
  }
  // Dots: small satin discs printed on the top face, staggered.
  if (print === 2) {
    const ds = w / 2.6;
    const dr = w * 0.075;
    const disc = new THREE.CircleGeometry(dr, 10);
    for (let u = u0 + ds / 2, row = 0; u < u1 - ds / 2; u += ds / 2, row++) {
      const v = (row % 2 === 0 ? -1 : 1) * w * 0.22;
      const x = v / (w / 2);
      const h = t * (0.55 + 0.45 * (1 - x * x)) + 0.00004;
      const P = bandPt(u, v, h, th(u));
      const f = pf.at(u + v);
      const rad = P.clone().sub(f.p).normalize();
      const a = f.t.clone().addScaledVector(rad, -f.t.dot(rad)).normalize();
      acc.add(disc.clone().applyMatrix4(basis(a, rad.clone().cross(a), rad, P)), accent);
    }
    disc.dispose();
  }
  if (knotted) {
    const f = pf.at(sk);
    const G = v3(0, -1, 0);
    // Knot side: under a level handle (and a little to the front); in front of a rising one.
    const D = G.clone().addScaledVector(f.t, -G.dot(f.t));
    if (D.length() > 0.55) D.normalize().addScaledVector(f.n, 0.6);
    else D.copy(f.n);
    D.addScaledVector(f.t, -D.dot(f.t)).normalize();
    const E = f.t.clone().cross(D).normalize();
    // Tails fall with gravity, spread along the handle, and stand a little proud of the bag.
    const S = f.t.clone().addScaledVector(G, -f.t.dot(G));
    if (S.length() < 0.25) S.copy(f.w).addScaledVector(G, -f.w.dot(G));
    S.normalize();
    const out = D.clone().addScaledVector(G, -D.dot(G));
    if (out.length() < 0.25) out.copy(f.n).addScaledVector(G, -f.n.dot(G));
    if (out.lengthSq() < 1e-6) out.copy(perp(G));
    out.normalize();
    // Collar: two thick turns bunched under the knot.
    const cw = 0.012, NA = 40, NB = 12;
    const rows: V[][] = [];
    for (let i = 0; i <= NB; i++) {
      const v = -cw / 2 + (cw * i) / NB;
      const row: V[] = [];
      const g = pf.at(sk + v);
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * 2 * PI;
        const x = (2 * v) / cw;
        const rr = R0 + 0.0004 + 0.0022 * Math.sqrt(Math.max(0, 1 - x * x)) + 0.0003 * Math.sin(5 * a + v * 900);
        row.push(g.p.clone().addScaledVector(g.n, Math.cos(a) * rr).addScaledVector(g.w, -Math.sin(a) * rr));
      }
      rows.push(row);
    }
    acc.add(gridGeo(rows, false, true), "main");
    // Knot: a folded lump on the down side.
    const knot = new THREE.SphereGeometry(1, 20, 14);
    const kp = knot.attributes.position;
    for (let i = 0; i < kp.count; i++) {
      const x = kp.getX(i), y = kp.getY(i), z = kp.getZ(i);
      const wr = 1 + 0.09 * Math.sin(7 * Math.atan2(y, x) + z * 3) + 0.05 * Math.sin(11 * z);
      kp.setXYZ(i, x * 0.0078 * wr, y * 0.0058 * wr, z * 0.0064 * wr);
    }
    knot.deleteAttribute("normal");
    const kc = f.p.clone().addScaledVector(D, R0 + 0.0042);
    const kg = smoothNormals(knot);
    knot.dispose();
    acc.add(kg.applyMatrix4(basis(f.t, D, E, kc)), "main");
    // Tails: two pointed silk ends falling from the knot, twisting a little as they hang.
    for (const side of [-1, 1]) {
      const len = p.tails * (side < 0 ? 1 : 0.84);
      const P0 = kc.clone().addScaledVector(D, 0.0035).addScaledVector(S, side * 0.003);
      const ctrl = [
        P0,
        P0.clone().addScaledVector(G, len * 0.28).addScaledVector(S, side * len * 0.09).addScaledVector(out, len * 0.08),
        P0.clone().addScaledVector(G, len * 0.64).addScaledVector(S, side * len * 0.15).addScaledVector(out, len * 0.11),
        P0.clone().addScaledVector(G, len).addScaledVector(S, side * len * 0.2).addScaledVector(out, len * 0.15),
      ];
      const cur = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
      const NS = 36;
      const fr: Frame[] = [];
      for (let i = 0; i <= NS; i++) {
        const u = i / NS;
        const pt = cur.getPointAt(u), tg = cur.getTangentAt(u).normalize();
        const w0 = S.clone().addScaledVector(tg, -S.dot(tg)).normalize();
        const W = w0.applyAxisAngle(tg, side * 0.9 * u).normalize();
        fr.push({ p: pt, t: tg, n: tg.clone().cross(W).normalize(), w: W });
      }
      const width = (u: number) => {
        const body = u < 0.15 ? 0.5 + (0.45 * u) / 0.15 : 0.95 + 0.04 * Math.sin(u * 9);
        return w * (u > 0.8 ? body * Math.max(0.06, 1 - (u - 0.8) / 0.2) : body);
      };
      const lens: V2[] = [[0.5, 0], [0.3, 0.5], [-0.3, 0.5], [-0.5, 0], [-0.3, -0.5], [0.3, -0.5]];
      acc.add(sweepFrames(fr, (i) => lens.map(([x, y]) => [x * width(i / NS), y * 0.00045] as V2)), "main");
      if (print !== 3) {
        for (const sv of [-1, 1]) {
          const pts = fr.map((q, i) => q.p.clone().addScaledVector(q.w, sv * width(i / NS) * 0.49));
          acc.add(tubeThrough(pts, 0.0003, 4, false, 1.5), hemMat);
        }
      }
    }
  }
  return acc.finish();
}

// ---------- Edge paint ----------

function edgePaint(p: Params, path?: KitPath): Piece[] {
  const pf = new PathFrames(path);
  const acc = new Acc();
  const th = p.thickness, bulge = p.bead;
  const top = 0.00026, wrap = 0.0006;
  const step = Math.max(0.0012, pf.L / 1400);
  const fr = pf.sample(step, 0, pf.L, pf.closed);
  const L = pf.L;
  // Hand-applied: the bead swells and thins a little along the edge.
  const wob = (i: number) => {
    const s = (L * i) / fr.length;
    return 1 + 0.08 * Math.sin((s * 2 * PI) / 0.031 + 1.3) + 0.04 * Math.sin((s * 2 * PI) / 0.0083);
  };
  const profile = (i: number): V2[] => {
    const b = bulge * wob(i);
    const out: V2[] = [];
    const mid = (top - th) / 2, hh = (top + th) / 2;
    // Outside (-W): a rounded bead from the bottom of the edge up to the face.
    for (let k = 0; k <= 10; k++) {
      const a = -PI / 2 + (PI * k) / 10;
      out.push([-b * Math.cos(a) ** 0.8, mid + hh * Math.sin(a)]);
    }
    // Over the arris and a feathered skin onto the face (+W).
    out.push([wrap * 0.45, top * 0.75], [wrap, 0.00004], [wrap * 0.2, -0.0002], [0.00012, -th * 0.6]);
    return out.reverse();
  };
  acc.add(sweepFrames(fr, profile, pf.closed), (m: PartMaterial) => getMaterial(edgeGloss(m.color, 1)));
  return acc.finish();
}

// ---------- Swivel snap hook ----------

/** Trigger snap hook lying in XY (z from 0 to ~3.7 mm): eye at +Y, hook body at -Y, gate on +X. */
function addSnapHook(acc: Acc, mat: MatRef, width: number, xfm: THREE.Matrix4) {
  const kb = clamp(0.6 + 0.4 * (width / 0.02), 0.6, 1.4);
  const mm = MM * kb;
  const zc = 2.5 * mm;
  const put = (g: THREE.BufferGeometry, m: MatRef = mat, crease?: number) => acc.add(g.applyMatrix4(xfm), m, crease === undefined ? {} : { crease });
  // Eye: rounded-rectangle wire loop the strap folds through.
  const wr = 1.45 * MM * Math.max(0.8, kb);
  const ew = width + 2 * wr, eh = 4 * MM + 2 * wr;
  const eyeY = 10.2 * mm + eh / 2;
  const eye = rrectPath(new THREE.Path(), ew, eh, Math.min(eh / 2 - 1e-5, 2.6 * MM), 0, eyeY, false);
  const eyePts = eye.getSpacedPoints(90).slice(0, -1).map((q) => v3(q.x, q.y, zc));
  put(tube(new THREE.CatmullRomCurve3(eyePts, true, "centripetal"), 160, wr, 10, true));
  // Swivel: flared neck, collar, joint groove and barrel down to the body.
  const sw = lathe([
    [0, 4.6 * mm], [2.3 * mm, 4.6 * mm], [2.6 * mm, 5.0 * mm], [2.6 * mm, 6.4 * mm], [2.2 * mm, 6.7 * mm], [2.2 * mm, 7.1 * mm],
    [2.75 * mm, 7.4 * mm], [2.75 * mm, 9.0 * mm], [2.2 * mm, 9.5 * mm], [1.5 * mm, 10.3 * mm], [1.3 * mm, eyeY - eh / 2 + wr * 0.5], [0, eyeY - eh / 2 + wr * 0.5],
  ], 32);
  put(sw.translate(0, 0, zc), mat, 0.6);
  // Body: one swept bar from the gate hinge round the back and bottom up to the nose.
  const body: V2[] = [
    [4.3, 1.0], [2.2, 3.5], [-1.6, 3.9], [-5.0, 2.0], [-6.9, -2.6], [-7.5, -9], [-7.3, -16], [-5.9, -21.6], [-3.0, -25.1], [0.8, -26.1],
    [4.4, -24.7], [6.8, -21], [7.5, -16.4], [7.1, -13.0], [5.9, -11.3],
  ];
  const bp = new THREE.CatmullRomCurve3(body.map(([x, y]) => v3(x * mm, y * mm, zc)), false, "centripetal").getSpacedPoints(120);
  // Cast body: slightly thicker at the back of the hook, tapering into the nose.
  put(sweep(bp, rrectProfile(3.7 * mm, 4.2 * mm, 1.5 * mm, 3), v3(0, 0, 1), { scale: (u) => [1, (1 + 0.1 * Math.sin(u * PI)) * (u > 0.88 ? 1 - (u - 0.88) * 2.6 : 1)] }));
  put(new THREE.SphereGeometry(1.75 * mm, 18, 12).scale(1, 0.9, 1.05).translate(5.9 * mm, -11.3 * mm, zc));
  // Spring gate: a thinner flat bar from the hinge down into the nose, set back from the faces.
  const gate = [v3(4.9 * mm, 0.4 * mm, zc), v3(5.9 * mm, -3.6 * mm, zc), v3(6.0 * mm, -7.0 * mm, zc), v3(5.3 * mm, -10.0 * mm, zc)];
  const gp = new THREE.CatmullRomCurve3(gate, false, "centripetal").getSpacedPoints(40);
  put(sweep(gp, rrectProfile(2.4 * mm, 2.0 * mm, 0.75 * mm, 3), v3(0, 0, 1)));
  // Shadow gap where the gate meets the nose.
  put(new THREE.TorusGeometry(1.25 * mm, 0.16 * mm, 6, 20).rotateX(PI / 2).rotateZ(-0.25).translate(5.45 * mm, -10.1 * mm, zc), recessOf);
  // Thumb trigger: ribbed paddle off the hinge.
  const trig = polyShape(chaikin([[3.6, -0.2], [7.6, 1.2], [8.8, 3.4], [8.0, 4.6], [4.4, 3.2]].map(([x, y]) => [x * mm, y * mm] as V2), 2));
  put(extrude(trig, 2.4 * mm, 0.65 * mm, { z0: zc - 1.2 * mm, curveSegs: 4, bevelSegs: 3 }), mat, 0.8);
  for (let i = 0; i < 3; i++) put(rbox(0.45 * mm, 2.4 * mm, 0.35 * mm, 0.15 * mm, 1).rotateZ(-0.9).translate((6.2 + i * 0.75) * mm, (2.0 + i * 0.55) * mm, zc + 1.17 * mm), recessOf);
  // Hinge rivet heads on both faces.
  for (const sz of [1, -1]) put(latheZ([[0, 0], [1.3 * mm, 0], [1.15 * mm, 0.35 * mm], [0, 0.45 * mm]], 24).scale(1, 1, sz).translate(4.4 * mm, 0.9 * mm, zc + sz * 1.82 * mm), mat, 0.6);
}

function swivelHook(p: Params): Piece[] {
  const acc = new Acc();
  addSnapHook(acc, "main", p.width, new THREE.Matrix4());
  return acc.finish();
}

// ---------- O-ring with leather tab ----------

/**
 * Leather tab folded around a horizontal bar at (y = barY, z = barZ) of wire radius wr: bottom
 * layer sewn to the surface up to y = topY, top layer folded back over it.
 */
function addFoldedTab(acc: Acc, leather: PartMaterial, opts: { width: number; t: number; barY: number; barZ: number; wr: number; topY: number }) {
  const { width, t, barY, barZ, wr, topY } = opts;
  const z1 = t / 2 + 0.00005;
  const z2 = z1 + t;
  const rr = wr + t / 2 + 0.00008;
  const pts: V[] = [v3(0, topY, z1), v3(0, (topY + barY) / 2 + 0.002, z1), v3(0, barY + rr + 0.0012, z1 + 0.0001)];
  for (let i = 0; i <= 10; i++) {
    const a = -PI / 2 - (PI * i) / 10;
    pts.push(v3(0, barY + Math.cos(a) * rr, barZ + Math.sin(a) * rr));
  }
  pts.push(v3(0, barY + rr + 0.0018, Math.max(z2, barZ + rr * 0.6)), v3(0, barY + rr + 0.006, z2 + 0.0001), v3(0, topY - 0.0012, z2));
  const path = new THREE.CatmullRomCurve3(pts, false, "centripetal").getSpacedPoints(110);
  acc.add(fineGrain(sweep(path, rrectProfile(width, t, t * 0.42, 3), v3(1, 0, 0))), leather);
  // Lacquered edges along both sides of the tab.
  for (const sx of [-1, 1]) acc.add(tubeThrough(path.filter((_, i) => i % 2 === 0).map((q) => q.clone().setX(sx * (width / 2 - t * 0.12))), t * 0.5, 6, false, 1), edgeGloss(leather.color));
  // Box stitch through both layers.
  const thread = contrastThread(leather, "cotton");
  const sx = width / 2 - 0.0019, y0 = barY + rr + 0.0062, y1 = topY - 0.0028;
  const box = rrectPath(new THREE.Path(), 2 * sx, y1 - y0, 0.0006, 0, (y0 + y1) / 2, false);
  const st = stitch2D(box, z2 + t / 2 + 0.00002, { pitch: 0.0027, stitch: 0.002, radius: 0.00027, flatten: 0.55 });
  if (st) acc.add(st, thread);
}

function oRing(p: Params): Piece[] {
  const acc = new Acc();
  const R = p.radius, wr = clamp(R * 0.18, 0.0011, 0.003);
  const cz = wr + 0.0015 + 0.0002;
  const topBar = -0.0045;
  const cy = topBar - R;
  acc.add(new THREE.TorusGeometry(R, wr, 18, 96).translate(0, cy, cz), "main");
  addFoldedTab(acc, leatherOf(p.tab), { width: clamp(R * 1.25, 0.008, 0.026), t: 0.0013, barY: topBar, barZ: cz, wr, topY: 0.019 });
  return acc.finish();
}

// ---------- Magnetic snap ----------

function magneticSnap(p: Params): Piece[] {
  const acc = new Acc();
  const k = p.size / 0.018;
  const mm = MM * k;
  const lz = (pts: V2[], x = 0) => latheZ(pts.map(([r, z]) => [r * mm, z * mm] as V2), 64).translate(x * mm, 0, 0);
  const ring = (r: number, z: number, x = 0) => acc.add(new THREE.TorusGeometry(r * mm, 0.09 * mm, 6, 72).translate(x * mm, 0, z * mm), recessOf);
  const crease = { crease: 0.6 };
  const female = (x: number, socket: boolean) => {
    const prof: V2[] = [[0, 0], [8.7, 0], [9, 0.3], [9, 0.75], [8.7, 1.05], [5.2, 1.15]];
    if (socket) prof.push([4.6, 1.2], [4.3, 2.4], [4.0, 2.75], [3.3, 2.8], [2.85, 2.55], [2.75, 1.6], [0, 1.6]);
    else prof.push([0, 1.15]);
    acc.add(lz(prof, x), "main", crease);
    ring(7.1, 1.11, x);
    if (socket) acc.add(new THREE.CircleGeometry(2.74 * mm, 32).translate(x * mm, 0, 1.62 * mm), recessOf);
  };
  if (Math.round(p.state) === 0) {
    female(0, false);
    // Male half seated on top: a slimmer disc with a prong washer and folded prongs.
    // Male half seated on top: a domed cover cap with a rolled rim and a stamped ring.
    const cap: V2[] = [[0, 1.15], [4.4, 1.15], [4.4, 1.85], [7.0, 1.9], [7.3, 2.15], [7.3, 2.6], [7.0, 2.85]];
    for (let i = 1; i <= 10; i++) {
      const u = i / 10;
      cap.push([6.6 * (1 - u), 2.85 + 0.75 * Math.sin((u * PI) / 2)]);
    }
    acc.add(lz(cap), "main", crease);
    ring(6.85, 2.86);
    ring(3.4, 3.42);
  } else {
    female(-11, true);
    acc.add(lz([[0, 0], [6.7, 0], [7, 0.3], [7, 0.75], [6.7, 1.05], [2.7, 1.1], [2.45, 1.3], [2.45, 2.9], [2.1, 3.35], [1.4, 3.55], [0, 3.6]], 11), "main", crease);
    ring(5.2, 1.08, 11);
  }
  return acc.finish();
}

// ---------- Logo plate ----------

const PLATE_TEXT: string[][] = [["MAISON", "PARIS"], ["MADE IN ITALY"], ["GENUINE LEATHER"], []];

function logoPlate(p: Params): Piece[] {
  const acc = new Acc();
  const shape = Math.round(p.shape);
  const W = p.width;
  const H = W * (shape === 0 ? 0.36 : shape === 1 ? 0.56 : 0.17);
  const t = Math.max(0.0011, Math.min(0.0018, W * 0.045));
  const outline = (w: number, h: number, hole = false): THREE.Shape | THREE.Path => {
    if (shape === 1) {
      const s = hole ? new THREE.Path() : new THREE.Shape();
      s.absellipse(0, 0, w / 2, h / 2, 0, 2 * PI, hole, 0);
      return s;
    }
    const r = shape === 2 ? h / 2 - 1e-6 : h * 0.16;
    return hole ? rrectPath(new THREE.Path(), w, h, r, 0, 0, true) : rrect(w, h, r);
  };
  acc.add(extrude(outline(W, H) as THREE.Shape, t, Math.min(0.0005, t * 0.4), { curveSegs: 36, bevelSegs: 4 }), "main", { crease: 0.7 });
  const z = t + 0.000012;
  // Engraved border groove.
  const ins = Math.max(0.0007, H * 0.11);
  const sw = Math.max(0.00014, H * 0.022);
  const band = outline(W - 2 * ins, H - 2 * ins) as THREE.Shape;
  band.holes.push(outline(W - 2 * ins - 2 * sw, H - 2 * ins - 2 * sw, true) as THREE.Path);
  const bg = new THREE.ShapeGeometry(band, 48).translate(0, 0, z);
  acc.add(bg, engraveOf);
  // Engraved lettering, fitted inside the border.
  const lines = PLATE_TEXT[clamp(Math.round(p.text), 0, PLATE_TEXT.length - 1)].slice(0, shape === 2 ? 1 : 2);
  if (lines.length) {
    const innerW = (W - 2 * ins) * (shape === 1 ? 0.72 : 0.84);
    const capH = (H - 2 * ins) * (lines.length > 1 ? 0.36 : 0.42);
    const main = layoutText(lines[0], 0.32);
    const h1 = Math.min(capH, innerW / Math.max(0.5, main.width));
    const sub = lines[1] ? layoutText(lines[1], 0.5) : null;
    const h2 = sub ? Math.min(h1 * 0.42, innerW / Math.max(0.5, sub.width)) : 0;
    const gap = h1 * 0.38;
    const total = h1 + (sub ? gap + h2 : 0);
    const y1 = total / 2 - h1;
    acc.add(engraveStrokes(main.strokes, h1, Math.max(0.00011, h1 * 0.085), 0, y1, z), engraveOf);
    if (sub) acc.add(engraveStrokes(sub.strokes, h2, Math.max(0.0001, h2 * 0.11), 0, y1 - gap - h2, z), engraveOf);
  }
  return acc.finish();
}

// ---------- Tassel ----------

function tassel(p: Params): Piece[] {
  const acc = new Acc();
  const leather = Math.round(p.material) === 0;
  const len = p.length;
  const metalIdx = Math.round(p.metal);
  const capMat: MatRef = metalIdx >= METALS.length ? "main" : metalOf(metalIdx);
  const rnd = rng(leather ? 7 : 11);
  const spread = leather ? 0.0068 : 0.0062;
  const zc = spread + 0.0016;
  const yCapTop = -0.0075;
  const capH = leather ? 0.011 : 0.01;
  const yCap0 = yCapTop - capH;
  // Hanging loop: a doubled cord from the origin to the cap.
  const loopMat: MatRef = "main";
  for (const sx of [-1, 1]) {
    const pts = [v3(sx * 0.0006, 0.0006, 0.0019), v3(sx * 0.0013, -0.002, zc * 0.5), v3(sx * 0.0011, yCapTop + 0.0012, zc)];
    acc.add(tubeThrough(pts, leather ? 0.0007 : 0.0005, 6, false, 8), loopMat);
  }
  acc.add(new THREE.TorusGeometry(0.0012, leather ? 0.0007 : 0.0005, 8, 20).rotateY(PI / 2).translate(0, 0.0005, 0.002), loopMat);
  // Cap: a bell with a bead rim and a fine groove (or the tassel's own material, wrapped).
  const rTop = 0.0021, rBot = leather ? 0.0052 : 0.0047;
  const capProf: V2[] = [[rBot - 0.0006, yCap0], [rBot + 0.0003, yCap0 + 0.0001], [rBot + 0.0004, yCap0 + 0.0009], [rBot - 0.0001, yCap0 + 0.0015]];
  for (let i = 1; i <= 10; i++) {
    const u = i / 10;
    capProf.push([lerpN(rBot - 0.0001, rTop, Math.pow(u, 0.8)) + 0.0009 * Math.sin(u * PI) * (1 - u), yCap0 + 0.0015 + (capH - 0.0022) * u]);
  }
  capProf.push([rTop * 0.85, yCapTop - 0.0002], [rTop * 0.6, yCapTop], [0, yCapTop + 0.0002]);
  acc.add(lathe(capProf, 48).translate(0, 0, zc), capMat, { crease: 0.6 });
  // Fine groove just above the bead rim.
  acc.add(new THREE.TorusGeometry(rBot - 0.0001, 0.00012, 6, 48).rotateX(PI / 2).translate(0, yCap0 + 0.0016, zc), capMat === "main" ? "main" : recessOf);
  if (!leather) {
    // Thread binding wraps below the cap.
    for (let i = 0; i < 4; i++) acc.add(new THREE.TorusGeometry(rBot * 0.86, 0.00028, 6, 40).rotateX(PI / 2).translate(0, yCap0 - 0.0004 - i * 0.00058, zc), "main");
  }
  const yS = yCap0 + 0.0012;
  if (leather) {
    // Leather strips: an outer and an inner ring fanning out slightly as they hang.
    const rings: [number, number, number][] = [[22, 0.0042, 0.0026], [13, 0.0024, 0.0024]];
    for (const [n, r0, sw] of rings) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * PI + (r0 < 0.003 ? 0.12 : 0) + (rnd() - 0.5) * 0.08;
        const ca = Math.cos(a), sa = Math.sin(a);
        const r1 = r0 + 0.0022 + rnd() * 0.0012;
        const l = len * (0.96 + rnd() * 0.06);
        const pts: V[] = [];
        for (let j = 0; j <= 7; j++) {
          const u = j / 7;
          const r = r0 + (r1 - r0) * Math.sin((u * PI) / 2) + 0.0004 * Math.sin(u * 5 + i);
          pts.push(v3(ca * r, yS - l * u, zc + sa * r));
        }
        const tang = v3(-sa, 0, ca);
        acc.add(fineGrain(sweep(pts, rrectProfile(sw, 0.00085, 0.00028, 1), tang)), "main", { crease: 0.9 });
      }
    }
  } else {
    // Fine threads: a dense bundle, slightly uneven at the ends.
    const n = 150;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 2 * PI;
      const r0 = 0.0039 * Math.sqrt(rnd());
      const r1 = r0 * 1.45 + 0.0012 * rnd();
      const l = len * (0.95 + rnd() * 0.07);
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [0, 0.33, 0.66, 1].map((u) => {
        const r = r0 + (r1 - r0) * Math.sin((u * PI) / 2) + (rnd() - 0.5) * 0.0005;
        return v3(ca * r, yS - l * u, zc + sa * r);
      });
      acc.add(tubeThrough(pts, 0.0003, 4, false, 2), "main");
    }
  }
  return acc.finish();
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- Bag charm ----------

/** Short cable chain from a to b: links alternate 90 degrees around the chain axis. */
function addCable(acc: Acc, mat: MatRef, a: V, b: V, Lk: number) {
  const r = Lk * 0.11;
  const inner = Lk - 2 * r;
  const pitch = inner * 0.98;
  const L = a.distanceTo(b);
  const n = Math.max(1, Math.round((L - Lk) / pitch) + 1);
  const T = b.clone().sub(a).normalize();
  const N = perp(T);
  const W = N.clone().cross(T).normalize();
  const base = new THREE.TorusGeometry(1, 1, 8, 28);
  // Torus centered on the origin in XY: stretch into an oval link along X.
  const pos = base.attributes.position;
  const R = Lk / 2 - r, Rb = Lk * 0.34 - r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(y, x);
    const dr = Math.hypot(x, y) - 1;
    const cx = Math.cos(ang) * R, cy = Math.sin(ang) * Rb;
    pos.setXYZ(i, cx + Math.cos(ang) * dr * r, cy + Math.sin(ang) * dr * r, z * r);
  }
  base.deleteAttribute("normal");
  const link = smoothNormals(base);
  base.dispose();
  for (let i = 0; i < n; i++) {
    const c = a.clone().addScaledVector(T, Lk / 2 + i * pitch);
    const g = link.clone();
    g.applyMatrix4(i % 2 ? basis(T, N, W.clone().negate(), c) : basis(T, W, N, c));
    acc.add(g, mat);
  }
  link.dispose();
}

function heartShape(s: number): THREE.Shape {
  const h = new THREE.Shape();
  h.moveTo(0, -0.95 * s);
  h.bezierCurveTo(-0.3 * s, -0.62 * s, -1.0 * s, -0.25 * s, -1.0 * s, 0.25 * s);
  h.bezierCurveTo(-1.0 * s, 0.72 * s, -0.55 * s, 0.98 * s, -0.25 * s, 0.92 * s);
  h.bezierCurveTo(-0.08 * s, 0.88 * s, 0, 0.75 * s, 0, 0.62 * s);
  h.bezierCurveTo(0, 0.75 * s, 0.08 * s, 0.88 * s, 0.25 * s, 0.92 * s);
  h.bezierCurveTo(0.55 * s, 0.98 * s, 1.0 * s, 0.72 * s, 1.0 * s, 0.25 * s);
  h.bezierCurveTo(1.0 * s, -0.25 * s, 0.3 * s, -0.62 * s, 0, -0.95 * s);
  return h;
}

const CHARM_LETTERS = ["A", "B", "C", "D", "E", "G", "H", "K", "L", "M", "N", "O", "P", "R", "S", "T", "U", "V", "W", "Y"];

function bagCharm(p: Params): Piece[] {
  const acc = new Acc();
  const kind = Math.round(p.charm);
  const furHex = FUR_HEX[clamp(Math.round(p.fur), 0, FUR_HEX.length - 1)];
  const fur: PartMaterial = { preset: "sherpa", color: furHex };
  // Charm half-depth decides how far out of the surface the dangling part hangs.
  const depth = kind === 0 ? 0.0205 : kind === 4 ? 0.0085 : kind === 3 ? 0.0024 : 0.0032;
  const zc = depth + 0.0006;
  // Clip: a small snap hook flipped so its hook catches a ring above; eye at the bottom.
  const hookW = 0.007;
  const kb = clamp(0.6 + 0.4 * (hookW / 0.02), 0.6, 1.4);
  const hookTop = 24.8 * MM * kb;
  const flip = new THREE.Matrix4().makeRotationZ(PI).setPosition(0, -hookTop + 0.0006, 0);
  addSnapHook(acc, "main", hookW, flip);
  const eyeBottom = -hookTop + 0.0006 - (10.2 * MM * kb + 4 * MM + 2 * 1.45 * MM * Math.max(0.8, kb));
  // Chain from the clip's eye to the charm's jump ring.
  const chainTop = v3(0, eyeBottom + 0.0012, 0.0019);
  const charmTop = v3(0, eyeBottom - 0.026, zc);
  addCable(acc, "main", chainTop, charmTop, 0.0058);
  const ringC = charmTop.clone().add(v3(0, -0.0018, 0));
  acc.add(new THREE.TorusGeometry(0.0024, 0.0005, 8, 28).rotateY(PI / 2).translate(ringC.x, ringC.y, ringC.z), "main");
  const top = ringC.y - 0.0022;
  if (kind === 0) {
    // Pompom: a fur ball with a halo of fine fibres.
    const R = 0.018;
    const cy = top - R + 0.0015;
    // Cloudy base: a dense sphere with soft multi-scale lumps (fur clumps).
    const ball = new THREE.IcosahedronGeometry(R * 0.9, 14);
    const bp = ball.attributes.position;
    const rnd = rng(5);
    for (let i = 0; i < bp.count; i++) {
      const v = v3(bp.getX(i), bp.getY(i), bp.getZ(i));
      const n = v.clone().normalize();
      const d = 1 + 0.05 * Math.sin(n.x * 9 + 1.3) * Math.sin(n.y * 8 + 0.4) * Math.sin(n.z * 7 + 2.1)
        + 0.03 * Math.sin(n.x * 23 + n.y * 17) * Math.sin(n.z * 21 - n.x * 13);
      bp.setXYZ(i, v.x * d, v.y * d, v.z * d);
    }
    ball.deleteAttribute("normal");
    acc.add(smoothNormals(ball).translate(0, cy, zc), fur);
    ball.dispose();
    // Guard hairs: very fine, lying down over the ball (fur, not spines), only breaking the outline.
    const fib = new THREE.ConeGeometry(0.00028, 1, 3, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 1200; i++) {
      const u = rnd() * 2 - 1, a = rnd() * 2 * PI;
      const dir = v3(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
      const tan = perp(dir).applyAxisAngle(dir, rnd() * 2 * PI);
      const lean = dir.clone().multiplyScalar(0.55).addScaledVector(tan, 0.85).add(v3(0, -0.25, 0)).normalize();
      const l = R * (0.18 + rnd() * 0.2);
      const g = fib.clone().scale(1, l, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), lean)).translate(dir.x * R * 0.88, cy + dir.y * R * 0.88, zc + dir.z * R * 0.88);
      acc.add(g, fur, { crease: 1.2 });
    }
    fib.dispose();
  } else if (kind === 1 || kind === 2) {
    const s = kind === 1 ? 0.0125 : 0.0115;
    let sh: THREE.Shape;
    if (kind === 1) sh = heartShape(s);
    else {
      const pts: V2[] = [];
      for (let i = 0; i < 10; i++) {
        const a = PI / 2 + (i * PI) / 5;
        const r = i % 2 === 0 ? s : s * 0.45;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      sh = polyShape(chaikin(pts, 1));
    }
    const d = 2 * depth;
    const g = extrude(sh, d, d * 0.48, { curveSegs: 24, bevelSegs: 7 });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    acc.add(g.translate(0, top - bb.max.y + 0.0006, zc - d / 2), "main", { crease: 0.9 });
  } else if (kind === 3) {
    // Bubble initial: round tubes along the letter strokes with ball joints.
    const ch = CHARM_LETTERS[clamp(Math.round(p.letter), 0, CHARM_LETTERS.length - 1)];
    const lay = layoutText(ch, 0);
    const h = 0.016, r = 0.0021;
    const oy = top - h - r + 0.0004;
    for (const s of lay.strokes) {
      const pts = s.map(([x, y]) => v3(x * h, oy + y * h, zc));
      const clean: V[] = [];
      for (const q of pts) if (!clean.length || q.distanceTo(clean[clean.length - 1]) > 1e-5) clean.push(q);
      for (let i = 0; i + 1 < clean.length; i++) {
        const c = new THREE.LineCurve3(clean[i], clean[i + 1]);
        acc.add(tube(c, 2, r, 16, false), "main");
      }
      for (const q of clean) acc.add(new THREE.SphereGeometry(r, 16, 10).translate(q.x, q.y, q.z), "main");
    }
  } else {
    // Plush bear: body, head, ears, muzzle, limbs; stitched-on eyes and nose.
    const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => acc.add(new THREE.SphereGeometry(1, 24, 16).scale(rx, ry, rz).translate(x, y, z), fur);
    const hy = top - 0.0072;
    ell(0.0072, 0.0068, 0.0064, 0, hy, zc);
    for (const sx of [-1, 1]) ell(0.0026, 0.0026, 0.0016, sx * 0.0058, hy + 0.0052, zc);
    for (const sx of [-1, 1]) acc.add(new THREE.SphereGeometry(1, 16, 10).scale(0.0015, 0.0015, 0.0008).translate(sx * 0.0058, hy + 0.0052, zc + 0.0012), { preset: "sherpa", color: shade(furHex, 0.8) });
    acc.add(new THREE.SphereGeometry(1, 20, 14).scale(0.0032, 0.0025, 0.0024).translate(0, hy - 0.0024, zc + 0.0053), { preset: "sherpa", color: shade(furHex, 1.08) });
    acc.add(new THREE.SphereGeometry(1, 14, 10).scale(0.0011, 0.0008, 0.0007).translate(0, hy - 0.0012, zc + 0.0076), { preset: "plastic_gloss", color: "#1A1314" });
    for (const sx of [-1, 1]) acc.add(new THREE.SphereGeometry(0.00075, 12, 8).translate(sx * 0.0027, hy + 0.0013, zc + 0.0058), { preset: "plastic_gloss", color: "#0E0C0D" });
    const by = hy - 0.0128;
    ell(0.0074, 0.0084, 0.0068, 0, by, zc);
    for (const sx of [-1, 1]) {
      acc.add(new THREE.SphereGeometry(1, 16, 12).scale(0.0026, 0.0048, 0.0028).rotateZ(sx * 0.7).translate(sx * 0.0074, by + 0.0028, zc + 0.0014), fur);
      acc.add(new THREE.SphereGeometry(1, 16, 12).scale(0.003, 0.0042, 0.0032).translate(sx * 0.0044, by - 0.0074, zc + 0.0016), fur);
    }
  }
  return acc.finish();
}

// ---------- Strap keeper ----------

function strapKeeper(p: Params): Piece[] {
  const acc = new Acc();
  const w = p.width, st = p.strap, h = p.height;
  const t = 0.0013, gap = 0.0003;
  const ow = w + 2 * (gap + t), oh = st + 2 * (gap + t);
  // Loop cross-section in (x, -z): shape y = -z_world, centered on the strap's mid-thickness.
  const ring = rrect(ow, oh, Math.min(t * 1.6, oh / 2 - 1e-5), 0, st / 2);
  ring.holes.push(rrectHole(w + 2 * gap, st + 2 * gap, Math.min(0.0006, st / 2), 0, st / 2));
  const g = fineGrain(extrude(ring, h, 0.00045, { curveSegs: 8, bevelSegs: 3 }).rotateX(-PI / 2).translate(0, -h / 2, 0));
  acc.add(g, "main", { crease: 0.7 });
  // Lacquered edges along the top and bottom of the loop's front face.
  const frontZ = gap + t;
  for (const sy of [-1, 1]) {
    const a = v3(-ow / 2 + t * 1.2, sy * (h / 2 - 0.0002), frontZ - 0.00035), b = v3(ow / 2 - t * 1.2, sy * (h / 2 - 0.0002), frontZ - 0.00035);
    acc.add(tube(new THREE.LineCurve3(a, b), 2, 0.00042, 8, false), (m: PartMaterial) => getMaterial(edgeGloss(m.color)));
  }
  // Stitch rows across the front, one near each edge.
  const thread = (m: PartMaterial) => getMaterial(contrastThread(m, "cotton"));
  const n = v3(0, 0, 1);
  for (const sy of [-1, 1]) {
    const y = sy * (h / 2 - Math.min(0.0022, h * 0.2));
    const x0 = -ow / 2 + t * 1.6, x1 = ow / 2 - t * 1.6;
    const st2 = stitchRow((u) => ({ p: v3(x0 + (x1 - x0) * u, y, frontZ + 0.00004), t: v3(1, 0, 0), n }), x1 - x0, { pitch: 0.0027, stitch: 0.0023, radius: 0.00027, flatten: 0.55, twist: 0.5 });
    if (st2) acc.add(st2, thread);
  }
  return acc.finish();
}

// ---------- Leather zip puller ----------

function zipPuller(p: Params): Piece[] {
  const acc = new Acc();
  const metal = metalOf(p.metal);
  const L = p.length, W = 0.0105, t = 0.0024;
  const Rr = 0.0034, wr = 0.00072;
  const z0 = Rr + wr - t / 2 + 0.0002;
  const holeY = -2 * Rr + wr * 0.4;
  const yTop = holeY + 0.0034;
  const yBot = yTop - L;
  const end = Math.round(p.end);
  // Tab outline: square shoulders at the top, chosen tip at the bottom.
  const pts: V2[] = [[-W / 2, yTop], [W / 2, yTop]];
  if (end === 0) {
    pts.push([W / 2, yBot + W / 2]);
    for (let i = 1; i < 12; i++) {
      const a = -(i / 12) * PI;
      pts.push([(Math.cos(a) * W) / 2, yBot + W / 2 + (Math.sin(a) * W) / 2]);
    }
    pts.push([-W / 2, yBot + W / 2]);
  } else if (end === 1) pts.push([W / 2, yBot + W * 0.7], [0, yBot], [-W / 2, yBot + W * 0.7]);
  else pts.push([W / 2, yBot], [-W / 2, yBot]);
  const outlinePts = chaikin(pts, end === 2 ? 1 : 2);
  const shape = polyShape(outlinePts);
  shape.holes.push(circleHole(0.0016, 0, holeY, 24));
  acc.add(fineGrain(extrude(shape, t, t * 0.38, { z0, curveSegs: 8, bevelSegs: 3 })), "main", { crease: 0.8 });
  // Edge paint around the perimeter at mid-thickness.
  const edgePts = outlinePts.map(([x, y]) => v3(x, y, z0 + t / 2));
  acc.add(tubeThrough(edgePts, t * 0.47, 8, true, 2), (m: PartMaterial) => getMaterial(edgeGloss(m.color)));
  // Stitching inset around the tab, below the eyelet.
  const inset = chaikin(pts.map(([x, y]) => [x * 0.66, y] as V2).map(([x, y]) => [x, y > yTop - 0.001 ? yTop - 0.0072 : y + (end === 1 ? 0.0024 : 0.0018)] as V2), 2);
  const sp = new THREE.Path(inset.map(([x, y]) => new THREE.Vector2(x, y)));
  sp.closePath();
  const st = stitch2D(sp, z0 + t + 0.00003, { pitch: 0.0025, stitch: 0.0019, radius: 0.00026, flatten: 0.55 });
  if (st) acc.add(st, (m: PartMaterial) => getMaterial(contrastThread(m, "cotton")));
  // Eyelet through the tab, ring through the eyelet up to the origin.
  acc.add(latheZ([[0.0016, z0 - 0.0002], [0.0026, z0 - 0.0002], [0.0028, z0 + 0.0001], [0.0019, z0 + t * 0.5], [0.0028, z0 + t - 0.0001], [0.0026, z0 + t + 0.00025], [0.0016, z0 + t + 0.00025]], 40).translate(0, holeY, 0), metal, { crease: 0.6 });
  acc.add(new THREE.TorusGeometry(Rr, wr, 12, 48).rotateY(PI / 2).translate(0, holeY + Rr - wr * 0.4, z0 + t / 2), metal);
  return acc.finish();
}

// ---------- Quilting stitch ----------

function quiltingStitch(p: Params, path?: KitPath): Piece[] {
  const pf = new PathFrames(path);
  const acc = new Acc();
  const pitch = p.pitch;
  const st = stitchRow((u) => {
    const f = pf.at(u * pf.L);
    return { p: f.p.clone().addScaledVector(f.n, 0.00018), t: f.t, n: f.n };
  }, pf.L, { pitch, stitch: pitch * 0.68, radius: 0.00046, flatten: 0.55, closed: pf.closed });
  if (st) acc.add(st, "main");
  return acc.finish();
}

export const BAG_BUILDERS: Record<string, Builder> = {
  turn_lock: turnLock,
  foot_stud: footStud,
  chain_strap: chainStrap,
  handle_wrap: handleWrap,
  edge_paint: edgePaint,
  swivel_hook: swivelHook,
  o_ring: oRing,
  magnetic_snap: magneticSnap,
  logo_plate: logoPlate,
  tassel,
  bag_charm: bagCharm,
  strap_keeper: strapKeeper,
  zip_puller: zipPuller,
  quilting_stitch: quiltingStitch,
};

