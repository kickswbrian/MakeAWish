import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getMaterial } from "../materials.ts";
import { Acc, type Builder, type KitPath, braidTube, clamp, lerp, rrectProfile, sweep, v3 } from "./core.ts";

/**
 * Detail module builders: trims (catalog entries in shared/modules/trims.ts).
 *
 * Path trims are built in a moving frame along the path: T = tangent, N = surface normal, W = N x T
 * (points into the garment). Bands are grids of rows (along T) by profile columns (in the W/N
 * plane); closed paths wrap seamlessly, and repeating details (ribs, scallops, folds) snap to a
 * whole number of repeats so the join is invisible.
 */

type V = THREE.Vector3;

/** Lift off the surface so trims never z-fight with the garment. */
const OFF = 0.0005;

// ---------- Small utilities ----------

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

const hash = (i: number, seed: number) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (x: number) => x * x * (3 - 2 * x);
const smoothstep = (a: number, b: number, x: number) => smooth(clamp((x - a) / (b - a), 0, 1));

/** 1D value noise in [-1, 1]; `period` (in lattice cells) makes it wrap for closed paths. */
function noise1(x: number, seed: number, period = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = period > 0 ? ((i % period) + period) % period : i;
  const b = period > 0 ? (((i + 1) % period) + period) % period : i + 1;
  return lerp(hash(a, seed), hash(b, seed), smooth(f)) * 2 - 1;
}

/** Thread matching the fabric, a shade darker so stitches read. */
const tone = (k: number, preset: PartMaterial["preset"] = "cotton") => (m: PartMaterial) => {
  const c = new THREE.Color(m.color).multiplyScalar(k);
  return getMaterial({ preset, color: `#${c.getHexString()}` });
};

/** Align enum index (inside, center, outside) -> [w0, w1]: the free edge is w0, the attached edge w1. */
function span(align: number, h: number): [number, number] {
  if (align === 1) return [-h / 2, h / 2];
  if (align === 2) return [-h, 0];
  return [0, h];
}

// ---------- Path frames ----------

interface Frame {
  p: V;
  t: V;
  n: V;
  w: V;
}

/** Arc-length parameterized path with interpolated surface normals. */
class Track {
  readonly closed: boolean;
  readonly length: number;
  private curve: THREE.CatmullRomCurve3;
  private nrm: V[];

  constructor(path?: KitPath) {
    let pts = (path?.points ?? []).map((q) => v3(q[0], q[1], q[2]));
    let nrm = pts.map((_, i) => {
      const q = path?.normals?.[i];
      return q ? v3(q[0], q[1], q[2]).normalize() : v3(0, 0, 1);
    });
    if (pts.length < 2) {
      pts = [v3(-0.1, 0, 0), v3(0.1, 0, 0)];
      nrm = [v3(0, 0, 1), v3(0, 0, 1)];
    }
    const closed = pts.length > 3 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-5;
    if (closed) {
      pts = pts.slice(0, -1);
      nrm = nrm.slice(0, -1);
    }
    // Drop duplicate consecutive points (they break tangents).
    const P: V[] = [], Nn: V[] = [];
    pts.forEach((p, i) => {
      if (P.length && P[P.length - 1].distanceTo(p) < 1e-7) return;
      P.push(p);
      Nn.push(nrm[i].lengthSq() > 0.5 ? nrm[i] : v3(0, 0, 1));
    });
    if (P.length < 2) {
      P.push(P[0].clone().add(v3(0.01, 0, 0)));
      Nn.push(Nn[0].clone());
    }
    this.closed = closed && P.length > 2;
    this.curve = new THREE.CatmullRomCurve3(P, this.closed, "centripetal");
    this.curve.arcLengthDivisions = Math.max(200, P.length * 12);
    this.length = this.curve.getLength();
    this.nrm = Nn;
  }

  /** Frame at arc length s (wraps on closed paths, clamps on open ones). */
  frame(s: number): Frame {
    const L = this.length;
    let u = s / L;
    u = this.closed ? ((u % 1) + 1) % 1 : clamp(u, 0, 1);
    const t = this.curve.getUtoTmapping(u, 0);
    const p = this.curve.getPoint(t);
    const tan = this.curve.getTangent(t).normalize();
    const n = this.nrm.length;
    const x = t * (this.closed ? n : n - 1);
    const i0 = Math.min(Math.floor(x), this.closed ? n - 1 : n - 2);
    const f = x - i0;
    const a = this.nrm[i0 % n], b = this.nrm[(i0 + 1) % n];
    const N = a.clone().lerp(b, f);
    N.addScaledVector(tan, -N.dot(tan));
    if (N.lengthSq() < 1e-10) N.copy(Math.abs(tan.z) < 0.9 ? v3(0, 0, 1) : v3(0, 1, 0)).addScaledVector(tan, -tan.z);
    N.normalize();
    const W = new THREE.Vector3().crossVectors(N, tan).normalize();
    return { p, t: tan, n: N, w: W };
  }

  /** Arc-length stations: closed -> count (no duplicate end), open -> count + 1 (both ends). */
  stations(count: number): number[] {
    const out: number[] = [];
    const m = this.closed ? count : count + 1;
    for (let i = 0; i < m; i++) out.push((i / count) * this.length);
    return out;
  }

  /** A whole number of repeats near `pitch` along the path (at least `min`). */
  repeats(pitch: number, min = 1): number {
    return Math.max(min, Math.round(this.length / pitch));
  }
}

const place = (f: Frame, w: number, n: number, t = 0, out = new THREE.Vector3()) =>
  out.copy(f.p).addScaledVector(f.w, w).addScaledVector(f.n, n).addScaledVector(f.t, t);

// ---------- Grid surfaces ----------

/**
 * A rows x cols quad grid with smooth normals and meter UVs (u along rows, v along columns, measured
 * on the surface). Closed directions wrap: the seam vertices are duplicated for UVs and their
 * normals averaged so the join is invisible. Profiles are CCW in the (W, N) plane so faces point out.
 */
function gridGeo(
  R: number,
  C: number,
  closedR: boolean,
  closedC: boolean,
  at: (i: number, j: number, out: V) => void,
  opts: { flip?: boolean; uvRotate?: number; uvMap?: (i: number, j: number, u: number, v: number) => [number, number] } = {},
): THREE.BufferGeometry {
  const rows = closedR ? R + 1 : R, cols = closedC ? C + 1 : C;
  const pos = new Float32Array(rows * cols * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      at(i % R, j % C, tmp);
      pos.set([tmp.x, tmp.y, tmp.z], (i * cols + j) * 3);
    }
  }
  const d = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const uv = new Float32Array(rows * cols * 2);
  for (let j = 0; j < cols; j++) for (let i = 1; i < rows; i++) uv[(i * cols + j) * 2] = uv[((i - 1) * cols + j) * 2] + d(i * cols + j, (i - 1) * cols + j);
  for (let i = 0; i < rows; i++) for (let j = 1; j < cols; j++) uv[(i * cols + j) * 2 + 1] = uv[(i * cols + j - 1) * 2 + 1] + d(i * cols + j, i * cols + j - 1);
  if (opts.uvMap) {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = (i * cols + j) * 2;
      const [u, v] = opts.uvMap(i, j, uv[k], uv[k + 1]);
      uv[k] = u;
      uv[k + 1] = v;
    }
  }
  if (opts.uvRotate) {
    const c = Math.cos(opts.uvRotate), s = Math.sin(opts.uvRotate);
    for (let k = 0; k < rows * cols; k++) {
      const u = uv[k * 2], v = uv[k * 2 + 1];
      uv[k * 2] = c * u - s * v;
      uv[k * 2 + 1] = s * u + c * v;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j, c = (i + 1) * cols + j + 1, e = i * cols + j + 1;
      if (opts.flip) idx.push(a, b, e, b, c, e);
      else idx.push(a, e, b, e, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const avg = (k0: number, k1: number) => {
    const x = nor.getX(k0) + nor.getX(k1), y = nor.getY(k0) + nor.getY(k1), z = nor.getZ(k0) + nor.getZ(k1);
    const l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(k0, x / l, y / l, z / l);
    nor.setXYZ(k1, x / l, y / l, z / l);
  };
  if (closedR) for (let j = 0; j < cols; j++) avg(j, R * cols + j);
  if (closedC) for (let i = 0; i < rows; i++) avg(i * cols, i * cols + C);
  g.userData.meterUV = true;
  return g;
}

/** Flat cap closing a profile ring (open paths): triangulated in the frame's W/N plane, facing `outward`. */
function capGeo(ring: V[], f: Frame, outward: V): THREE.BufferGeometry {
  const flat = ring.map((q) => new THREE.Vector2(q.clone().sub(f.p).dot(f.w), q.clone().sub(f.p).dot(f.n)));
  const tris = THREE.ShapeUtils.triangulateShape(flat, []);
  const out: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.subVectors(ring[b], ring[a]);
    e2.subVectors(ring[c], ring[a]);
    const order = e1.cross(e2).dot(outward) < 0 ? [a, c, b] : [a, b, c];
    for (const k of order) out.push(ring[k].x, ring[k].y, ring[k].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A closed-profile band swept along stations: `prof(i, j)` gives [w, n, t] in frame i. Adds the
 * end caps on open paths.
 */
function bandSweep(
  acc: Acc,
  track: Track,
  frames: Frame[],
  C: number,
  prof: (i: number, j: number) => [number, number, number],
  mat: Parameters<Acc["add"]>[1],
  opts: Parameters<typeof gridGeo>[5] = {},
) {
  const R = frames.length;
  acc.add(
    gridGeo(R, C, track.closed, true, (i, j, out) => {
      const [w, n, t] = prof(i, j);
      place(frames[i], w, n, t, out);
    }, opts),
    mat,
  );
  if (!track.closed) {
    for (const [i, sgn] of [[0, -1], [R - 1, 1]] as const) {
      const ring: V[] = [];
      for (let j = 0; j < C; j++) {
        const [w, n, t] = prof(i, j);
        ring.push(place(frames[i], w, n, t));
      }
      acc.add(capGeo(ring, frames[i], frames[i].t.clone().multiplyScalar(sgn)), mat);
    }
  }
}

/**
 * Stitches riding on a polyline (world points with surface normals). Long trims carry hundreds of
 * stitches, so each is a 6x4 ellipsoid (36 triangles) written straight into one buffer.
 */
function stitchesAlong(pts: V[], nrm: V[], closed: boolean, pitch: number, radius: number): THREE.BufferGeometry | null {
  const P = closed ? [...pts, pts[0]] : pts;
  const Nn = closed ? [...nrm, nrm[0]] : nrm;
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const L = cum[cum.length - 1];
  if (L < pitch) return null;
  const count = Math.max(1, Math.floor(L / pitch));
  const step = closed ? L / count : pitch;
  const start = closed ? 0 : (L - (count - 1) * pitch) / 2;
  const unit = new THREE.SphereGeometry(1, 6, 4).toNonIndexed();
  const up = unit.attributes.position, un = unit.attributes.normal;
  const nv = up.count;
  const pos = new Float32Array(count * nv * 3), nor = new Float32Array(count * nv * 3);
  const len = Math.min(pitch * 0.74, pitch * 0.95) / 2;
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), q = new THREE.Vector3(), m = new THREE.Vector3();
  let k = 0;
  for (let c = 0; c < count; c++) {
    const s = start + c * step;
    while (k < P.length - 2 && cum[k + 1] < s) k++;
    const f = clamp((s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), 0, 1);
    const p = P[k].clone().lerp(P[k + 1], f);
    Z.copy(Nn[k]).lerp(Nn[k + 1], f).normalize();
    Y.subVectors(P[k + 1], P[k]).normalize().applyAxisAngle(Z, 0.1);
    Y.addScaledVector(Z, -Y.dot(Z)).normalize();
    X.crossVectors(Y, Z);
    for (let i = 0; i < nv; i++) {
      const ux = up.getX(i) * radius, uy = up.getY(i) * len, uz = up.getZ(i) * radius * 0.65;
      q.copy(p).addScaledVector(X, ux).addScaledVector(Y, uy).addScaledVector(Z, uz);
      m.copy(X).multiplyScalar(un.getX(i) / radius).addScaledVector(Y, un.getY(i) / len).addScaledVector(Z, un.getZ(i) / (radius * 0.65)).normalize();
      const o = (c * nv + i) * 3;
      pos[o] = q.x; pos[o + 1] = q.y; pos[o + 2] = q.z;
      nor[o] = m.x; nor[o + 1] = m.y; nor[o + 2] = m.z;
    }
  }
  unit.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Row count for a band so it stays near a triangle budget. */
const rowsFor = (track: Track, step: number, cols: number, budget: number) =>
  Math.max(track.closed ? 12 : 8, Math.min(Math.ceil(track.length / step), Math.floor(budget / (2 * cols))));

// ---------- Rib band ----------

/**
 * Rib height in [-1, 1] across one repeat (phase 0..1, valley centered at 0.5): rounded knit
 * columns with a narrow recessed purl valley; 2x2 adds a shallow groove splitting the knit wale.
 */
function ribShape(ph: number, twoByTwo: boolean): number {
  const d = Math.abs(ph - 0.5); // 0 at the valley center, 0.5 at the knit center
  const vw = twoByTwo ? 0.15 : 0.2; // half-width of the valley
  if (d < vw) return -1 + 0.9 * smooth(d / vw) ** 1.4;
  const x = (d - vw) / (0.5 - vw); // 0 at the valley wall, 1 at the knit center
  let h = -0.1 + 1.1 * Math.sin((Math.PI / 2) * Math.min(1, x * 1.6)) ** 0.7;
  if (twoByTwo) h -= 0.38 * Math.exp(-((((1 - x) * (0.5 - vw)) / 0.05) ** 2));
  return h;
}

/** The rib_knit preset paints one dark rib valley every 6 mm (12 per 72 mm tile) at 0.877 of a repeat. */
const RIB_TEX_PERIOD = 0.006;
const RIB_TEX_VALLEY = 0.877;

const ribBand: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height, T = p.thickness, pitch = p.pitch;
  const two = p.rib === 0;
  const [w0, w1] = span(p.align, H);
  const periods = track.repeats(pitch, 3);
  // Profile (CCW in W/N): inner face, sewn edge, outer face, rolled fold at the free edge w0.
  type PP = { w: number; n: number; ow: number; on: number; k: number };
  const prof: PP[] = [];
  const rf = T / 2, cw = w0 + rf, cn = OFF + rf;
  prof.push({ w: cw, n: OFF, ow: 0, on: -1, k: -0.45 });
  prof.push({ w: lerp(cw, w1, 0.5), n: OFF, ow: 0, on: -1, k: -0.3 });
  prof.push({ w: w1 - T * 0.25, n: OFF, ow: 0.3, on: -1, k: 0 });
  prof.push({ w: w1, n: OFF + T * 0.3, ow: 1, on: 0.2, k: 0.15 });
  prof.push({ w: w1 - T * 0.35, n: OFF + T * 0.62, ow: 0.4, on: 1, k: 0.35 });
  const faceN = 6;
  for (let a = 1; a <= faceN; a++) {
    const f = a / (faceN + 1); // from the sewn edge toward the fold
    const w = lerp(w1 - T * 0.35, cw, f);
    const bulge = Math.sin(Math.PI * f) * T * 0.16;
    prof.push({ w, n: OFF + lerp(T * 0.62, T, smoothstep(0, 0.35, f)) + bulge, ow: 0, on: 1, k: lerp(0.45, 1, smoothstep(0, 0.4, f)) });
  }
  for (let a = 0; a <= 6; a++) {
    const ang = Math.PI / 2 + (a / 6) * Math.PI; // top -> left -> bottom
    prof.push({ w: cw + Math.cos(ang) * rf, n: cn + Math.sin(ang) * rf, ow: Math.cos(ang), on: Math.sin(ang), k: lerp(1, -0.45, a / 6) });
  }
  prof.pop(); // the last roll point duplicates the first inner-face point
  const C = prof.length;
  const per = clamp(Math.floor(26000 / (2 * C * periods)), two ? 8 : 6, 12);
  const frames = track.stations(periods * per).map((s) => track.frame(s));
  const amp = Math.min(pitch * 0.15, T * 0.3);
  const acc = new Acc();
  bandSweep(acc, track, frames, C, (i, j) => {
    const q = prof[j];
    const ph = ((i % per) + 0.5) / per;
    // Ribs relax slightly toward the fold and compress into the seam.
    const d = amp * q.k * ribShape(ph, two);
    return [q.w + q.ow * d, q.n + q.on * d, 0];
  }, "main", {
    // One painted rib per geometric rib, its dark valley in the geometric valley (phase 0.5).
    uvMap: (i, _j, _u, v) => [(i / per + 0.5 / per - 0.5 + RIB_TEX_VALLEY) * RIB_TEX_PERIOD, v],
  });
  return acc.finish();
};

// ---------- Ruffle ----------

/** Irregular fold phase along a path: a whole number of folds, each with its own width and depth. */
function foldField(track: Track, wave: number, seed: number) {
  const K = track.repeats(wave, 2);
  const r = rng(seed);
  const wts = Array.from({ length: K }, () => 0.7 + 0.6 * r());
  const amps = Array.from({ length: K }, () => 0.7 + 0.55 * r());
  const total = wts.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const w of wts) cum.push(cum[cum.length - 1] + (w / total) * track.length);
  return (s: number) => {
    const L = track.length;
    const x = track.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    let k = 0;
    while (k < K - 1 && cum[k + 1] <= x) k++;
    const f = (x - cum[k]) / (cum[k + 1] - cum[k]);
    const a0 = amps[k], a1 = amps[(k + 1) % K];
    return { phase: (k + f) * Math.PI * 2, amp: lerp(a0, a1, smooth(f)) };
  };
}

/** A thin fabric sheet: thickens a center surface into a closed solid (front + back + edges). */
function sheet(acc: Acc, R: number, closedR: boolean, nv: number, center: (i: number, j: number) => V, th: number, mat: Parameters<Acc["add"]>[1]) {
  // Center grid for normals.
  const C: V[][] = [];
  for (let i = 0; i < R; i++) {
    const row: V[] = [];
    for (let j = 0; j < nv; j++) row.push(center(i, j));
    C.push(row);
  }
  const nrm = (i: number, j: number) => {
    const ip = closedR ? (i + 1) % R : Math.min(R - 1, i + 1), im = closedR ? (i - 1 + R) % R : Math.max(0, i - 1);
    const jp = Math.min(nv - 1, j + 1), jm = Math.max(0, j - 1);
    const du = C[ip][j].clone().sub(C[im][j]);
    const dv = C[i][jp].clone().sub(C[i][jm]);
    const n = dv.cross(du);
    return n.lengthSq() > 1e-18 ? n.normalize() : v3(0, 0, 1);
  };
  const N = C.map((row, i) => row.map((_, j) => nrm(i, j)));
  // Closed profile: front face j = 0..nv-1, then back face j = nv-1..0; the edge taper keeps it sealed.
  const cols = nv * 2;
  acc.add(
    gridGeo(R, cols, closedR, true, (i, j, out) => {
      const front = j < nv;
      const jj = front ? j : cols - 1 - j;
      const edge = jj === 0 || jj === nv - 1 ? 0.55 : 1;
      out.copy(C[i][jj]).addScaledVector(N[i][jj], (front ? 1 : -1) * th * 0.5 * edge);
    }),
    mat,
  );
  return { C, N };
}

const ruffle: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height, full = p.fullness;
  const layers = Math.round(clamp(p.layers, 1, 2));
  const [, w1] = span(p.align, H);
  const acc = new Acc();
  const th = 0.0005;
  const head = Math.min(0.0045, H * 0.14);
  const thread = tone(0.72);
  for (let layer = 0; layer < layers; layer++) {
    const h = layer === 0 ? H : H * 0.66;
    const lift = layer * (th * 2 + 0.0016);
    const wave = clamp(h * 0.62, 0.008, 0.05);
    const A = (wave / (2 * Math.PI)) * Math.sqrt(full * full - 1) * 1.3;
    const fold = foldField(track, wave, 11 + layer * 7);
    const fineK = track.repeats(0.0075, 4);
    const nv = 13;
    const R = rowsFor(track, 0.0011, nv * 2, layers === 2 ? 9000 : 16000);
    const frames = track.stations(R).map((s) => track.frame(s));
    const Rn = frames.length;
    const ss = track.stations(R);
    // v runs from the self-heading above the stitch line (-head) down to the hem (h).
    const vs = Array.from({ length: nv }, (_, j) => (j === 0 ? -head : (j === 1 ? 0 : ((j - 1) / (nv - 2)) ** 1.15 * h)));
    const fz = (i: number, j: number) => {
      const s = ss[i], v = vs[j];
      const fr = fold(s);
      const e = clamp(v / h, 0, 1);
      // Hem length varies a little so the edge is not ruler-straight.
      const hemJit = 1 + 0.035 * noise1((s / track.length) * 23, 5 + layer, track.closed ? 23 : 0);
      const vv = v * (v > 0 ? hemJit : 1);
      const big = A * fr.amp * e ** 0.75;
      const shaped = Math.cos(fr.phase);
      const fine = 0.00055 * Math.sin((s / track.length) * fineK * Math.PI * 2 + 1.7 * noise1(s * 300, 3)) * (1 - e) ** 2;
      const flare = 0.0011 + 0.22 * Math.max(0, vv) * e ** 0.4;
      return {
        w: w1 - vv,
        n: OFF + lift + flare + big * (0.5 + 0.5 * shaped) + fine * (v < 0 ? 1.2 : 1),
        t: big * 0.5 * Math.sin(fr.phase),
      };
    };
    const { C, N } = sheet(acc, Rn, track.closed, nv, (i, j) => {
      const q = fz(i, j);
      return place(frames[i], q.w, q.n, q.t);
    }, th, "main");
    // Rolled baby hem along the free edge.
    const hemPts: V[] = [];
    for (let i = 0; i < Rn; i++) hemPts.push(C[i][nv - 1].clone());
    const hemCurve = new THREE.CatmullRomCurve3(hemPts, track.closed, "centripetal");
    acc.add(new THREE.TubeGeometry(hemCurve, Math.min(700, Rn), th * 0.95, 5, track.closed), "main");
    // Gathering stitch line along the heading.
    const sp: V[] = [], sn: V[] = [];
    for (let i = 0; i < Rn; i++) {
      sp.push(C[i][1].clone().addScaledVector(N[i][1], th * 0.5 + 0.00012));
      sn.push(N[i][1]);
    }
    const st = stitchesAlong(sp, sn, track.closed, 0.0028, 0.00042);
    if (st) acc.add(st, thread);
  }
  return acc.finish();
};

// ---------- Lace ----------

interface Hole {
  x: number;
  y: number;
  r: number;
  pts: [number, number][];
}

/** One lace repeat in local 2D (x along the path in [0, P], y from the attached edge toward the free edge). */
function laceMotif(P: number, H: number, eyelet: boolean): THREE.Shape {
  const yHead = -0.0012; // overlaps the garment edge where it is sewn
  const cuspY = H * 0.7;
  // Outline: straight heading on top (subdivided so it bends with the path), scalloped picot edge below.
  const outline: [number, number][] = [];
  const nTop = Math.max(4, Math.ceil(P / 0.002));
  for (let i = 0; i <= nTop; i++) outline.push([P - (i / nTop) * P, yHead]);
  // Left side down to the cusp.
  outline.push([0, cuspY * 0.5]);
  // Scallop arc from the left cusp to the right cusp through (P/2, H), with picots.
  const depth = H - cuspY;
  const R = (P * P / 4 + depth * depth) / (2 * depth);
  const cy = H - R;
  const b0 = Math.asin(clamp(P / 2 / R, 0, 1));
  const picots = Math.max(5, Math.round((R * 2 * b0) / 0.0021));
  const segs = picots * 4;
  const pr = Math.min(0.0007, P * 0.05);
  for (let i = 0; i <= segs; i++) {
    const b = lerp(-b0, b0, i / segs);
    const bump = pr * Math.max(0, Math.sin(((i / segs) * picots % 1) * Math.PI)) ** 0.6;
    outline.push([clamp(P / 2 + (R + bump) * Math.sin(b), 0, P), cy + (R + bump) * Math.cos(b)]);
  }
  outline.push([P, cuspY * 0.5]);
  const shape = new THREE.Shape();
  outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();

  // Openwork: accept holes greedily if they clear each other and the outline.
  const u = Math.min(P, H * 0.62);
  const holes: Hole[] = [];
  const edgeDist = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % outline.length];
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / Math.max(1e-12, dx * dx + dy * dy), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return best;
  };
  const gap = Math.max(0.00045, u * 0.035);
  const inside = (poly: [number, number][], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const tryHole = (x: number, y: number, pts: [number, number][]) => {
    const r = Math.max(...pts.map(([px, py]) => Math.hypot(px - x, py - y)));
    if (x - r < gap || x + r > P - gap || y - r < gap) return;
    if (edgeDist(x, y) < r + gap) return;
    for (const h of holes) {
      if (Math.hypot(h.x - x, h.y - y) > h.r + r + gap) continue;
      // Close bounding circles: compare the actual outlines (elongated petals pack tightly).
      if (inside(h.pts, x, y) || inside(pts, h.x, h.y)) return;
      for (const [ax, ay] of pts) for (const [bx, by] of h.pts) if (Math.hypot(ax - bx, ay - by) < gap) return;
    }
    holes.push({ x, y, r, pts });
  };
  const ellipse = (x: number, y: number, a: number, b: number, rot: number, n = 10): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = -(i / n) * Math.PI * 2; // clockwise for holes
      const ex = Math.cos(t) * a, ey = Math.sin(t) * b;
      out.push([x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    return out;
  };
  if (eyelet) {
    // Broderie anglaise (placed first so the flower stays whole): petal holes, teardrops, small eyelets.
    const fx = P / 2, fy = H * 0.47;
    const pd = u * 0.19;
    tryHole(fx, fy, ellipse(fx, fy, u * 0.045, u * 0.045, 0, 10));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 2;
      tryHole(fx + Math.cos(a) * pd, fy + Math.sin(a) * pd, ellipse(fx + Math.cos(a) * pd, fy + Math.sin(a) * pd, u * 0.11, u * 0.052, a, 12));
    }
    for (const sx of [0.11, 0.89]) {
      const x = P * sx, y = H * 0.4;
      tryHole(x, y, ellipse(x, y, u * 0.06, u * 0.11, sx < 0.5 ? -0.45 : 0.45, 10));
    }
    for (const sx of [0.27, 0.73]) tryHole(P * sx, H * 0.25, ellipse(P * sx, H * 0.25, u * 0.042, u * 0.042, 0, 8));
  }
  // Eyelets following the scallop just inside the edge (both styles).
  const ring = R - Math.max(u * 0.13, 0.0012);
  for (let k = 1; k < 8; k++) {
    const b = lerp(-b0, b0, k / 8);
    const x = P / 2 + Math.sin(b) * ring, y = cy + Math.cos(b) * ring;
    tryHole(x, y, ellipse(x, y, u * 0.036, u * 0.036, 0, 8));
  }
  // Beading: a ladder of small holes along the heading (ribbon can be threaded through).
  const hy = H * 0.13;
  const nb = Math.max(1, Math.round(P / (u * 0.22)));
  for (let k = 0; k < nb; k++) {
    const x = ((k + 0.5) / nb) * P;
    tryHole(x, hy, ellipse(x, hy, u * 0.055, u * 0.034, 0, 8));
  }
  // Holes wind opposite to the outline (ExtrudeGeometry only normalizes them when it flips the outline).
  const cw = THREE.ShapeUtils.isClockWise(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) {
    const hcw = THREE.ShapeUtils.isClockWise(h.pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (hcw === cw) h.pts.reverse();
    const path = new THREE.Path();
    h.pts.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

const laceTrim: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height;
  const [, w1] = span(p.align, H);
  const K = track.repeats(p.scallop, 1);
  const P = track.length / K;
  const th = 0.0006;
  const base = new THREE.ExtrudeGeometry(laceMotif(P, H, p.style === 1), { depth: th, bevelEnabled: false, curveSegments: 4 });
  // Drop the walls where neighbouring repeats meet (they would show as seams through the net).
  {
    const pos = base.attributes.position;
    const keep: number[] = [];
    const eps = 1e-7;
    for (let t = 0; t < pos.count; t += 3) {
      const xs = [pos.getX(t), pos.getX(t + 1), pos.getX(t + 2)];
      if (xs.every((x) => x < eps) || xs.every((x) => x > P - eps)) continue;
      for (let k = 0; k < 3; k++) keep.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
    }
    base.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
    base.deleteAttribute("uv");
    base.deleteAttribute("normal");
    base.clearGroups();
  }
  const acc = new Acc();
  // Warp each repeat onto the path: x -> arc length, y -> -W (away from the garment), z -> N.
  for (let k = 0; k < K; k++) {
    const g = base.clone();
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      uv[i * 2] = k * P + x; // meter UVs continuous along the whole trim
      uv[i * 2 + 1] = -y;
      const f = track.frame(k * P + x);
      // z is flipped so (T, -W, -N) stays right-handed and faces keep pointing out.
      const q = place(f, w1 - y, OFF + (th - z) + 0.00015 * Math.sin((x / P) * Math.PI * 2) * Math.max(0, y / H));
      pos.setXYZ(i, q.x, q.y, q.z);
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    acc.add(g, "main", { crease: 0.6, keepUV: true });
  }
  base.dispose();
  // Straight stitch holding the heading.
  const R = Math.max(16, Math.ceil(track.length / 0.002));
  const sp: V[] = [], sn: V[] = [];
  for (const s of track.stations(R)) {
    const f = track.frame(s);
    sp.push(place(f, w1 - H * 0.045, OFF + th + 0.0001));
    sn.push(f.n);
  }
  const st = stitchesAlong(sp, sn, track.closed, 0.0026, 0.00034);
  if (st) acc.add(st, tone(0.78));
  return acc.finish();
};

// ---------- Bow ----------

/** A ribbon swept along a parametric centerline: thin closed profile with soft folds across its width. */
function ribbon(
  acc: Acc,
  rows: number,
  closed: boolean,
  center: (t: number, u: number) => V,
  axis: (t: number) => V,
  half: (t: number) => number,
  th: (t: number) => number,
  fold: (t: number, u: number) => number,
  cols = 9,
) {
  // Profile CCW in (axis, normal): front face +1 -> -1, edge, back face -1 -> +1, edge.
  const P: [number, number][] = [];
  for (let k = 0; k <= cols; k++) P.push([1 - (2 * k) / cols, 1]);
  P.push([-1.02, 0]);
  for (let k = 0; k <= cols; k++) P.push([-1 + (2 * k) / cols, -1]);
  P.push([1.02, 0]);
  const C = P.length;
  const R = closed ? rows : rows + 1;
  const tmp = new THREE.Vector3();
  acc.add(
    gridGeo(R, C, closed, true, (i, j, out) => {
      const t = i / rows;
      const [u, side] = P[j];
      const uc = clamp(u, -1, 1);
      const e = 1e-3;
      const c0 = center(t, uc);
      const c1 = center(closed ? (t + e) % 1 : Math.min(1, t + e), uc);
      const cm = center(closed ? (t - e + 1) % 1 : Math.max(0, t - e), uc);
      const T = c1.sub(cm).normalize();
      const A = axis(t).clone();
      A.addScaledVector(T, -A.dot(T)).normalize();
      const Nn = tmp.crossVectors(T, A).normalize();
      const hw = half(t);
      const thick = th(t) * side * 0.5 * (1 - 0.7 * uc ** 8);
      out.copy(c0).addScaledVector(A, u * hw).addScaledVector(Nn, fold(t, uc) + thick);
    }),
    "main",
  );
}

const bow: Builder = (p) => {
  const W = p.width;
  const style = Math.round(p.style);
  // [ribbon width, thickness, loop depth, tail length, fold amount, tilt] relative to the bow width.
  const S = [
    { rw: 0.3, th: 0.0006, depth: 0.32, tail: 0.78, folds: 1, tilt: 0.2, notch: 1 },
    { rw: 0.32, th: 0.0016, depth: 0.4, tail: 0.62, folds: 0.6, tilt: 0.16, notch: 0 },
    { rw: 0.12, th: 0.0005, depth: 0.36, tail: 1.15, folds: 0.25, tilt: 0.3, notch: 1 },
    { rw: 0.36, th: 0.0009, depth: 0.42, tail: 0.95, folds: 1.3, tilt: 0.12, notch: 1 },
  ][clamp(style, 0, 3)];
  const scale = W / 0.08;
  const rw = W * S.rw;
  const th = Math.max(S.th * Math.min(1.6, Math.max(0.6, scale)), 0.0003);
  const knotW = rw * 0.42;
  const Lx = W / 2 - knotW * 0.25;
  const Dz = Lx * S.depth;
  const z0 = Dz * 0.55 + th + 0.001;
  const acc = new Acc();
  // Loops: closed teardrops from the knot out to ±X (front layer in front, back layer behind).
  for (const sgn of [1, -1]) {
    const ct = Math.cos(S.tilt), st = Math.sin(S.tilt);
    const ph = sgn > 0 ? 0.4 : 1.9;
    ribbon(
      acc,
      72,
      true,
      (t) => {
        const a = t * Math.PI * 2;
        const out = (1 - Math.cos(a)) / 2; // 0 at the knot, 1 at the tip
        const x = knotW * 0.3 + (Lx - knotW * 0.3) * out;
        const fat = 0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, out * 0.85 + 0.15)) ** 0.5;
        // Blend front (sin a > 0) and back layers smoothly: any jump breaks the sweep frame at the tip.
        const fw = smoothstep(-0.35, 0.35, Math.sin(a));
        const z = Dz * Math.sin(a) * fat * lerp(0.65, 1, fw);
        // Front layer droops a little at the tip; the whole loop tilts up.
        const droop = -Dz * 0.25 * out ** 2 * lerp(0.5, 1, fw);
        return v3(sgn * x * ct, x * st + droop, z0 + z);
      },
      () => v3(-st * sgn, ct, 0),
      (t) => {
        const out = (1 - Math.cos(t * Math.PI * 2)) / 2;
        return (rw / 2) * (0.36 + 0.64 * smooth(Math.min(1, out * 1.25)) ** 0.8);
      },
      () => th,
      (t, u) => {
        const out = (1 - Math.cos(t * Math.PI * 2)) / 2;
        // Gathers radiate from the knot: strongest just outside it, relaxed at the pinch itself.
        const near = (1 - out) ** 1.6 * smoothstep(0, 0.12, out);
        // Radiating folds near the knot, a soft cup across the width at the tip.
        return S.folds * (rw * 0.07 * near * Math.sin(u * Math.PI * 2.5 + ph) + rw * 0.05 * out * (1 - u * u) * Math.sin(t * Math.PI * 2));
      },
    );
  }
  // Tails: hang from behind the knot, flare out, a lazy S, notched (dovetail) or angled ends.
  for (const sgn of [1, -1]) {
    const Lt = W * S.tail;
    const spread = 0.32 * sgn;
    const notch = S.notch ? rw * 0.45 : rw * 0.35;
    ribbon(
      acc,
      44,
      false,
      (t, u) => {
        // Each column ends at its own length: dovetail (center shorter) or angled cut.
        const cut = S.notch ? notch * (1 - Math.abs(u)) : notch * (0.5 + 0.5 * u * sgn);
        const s = t * (Lt - cut);
        const x = sgn * knotW * 0.15 + Math.sin(spread) * s + sgn * Lt * 0.06 * Math.sin((s / Lt) * Math.PI * 1.6);
        const y = -knotW * 0.35 - Math.cos(spread) * s;
        const z = z0 - Dz * 0.35 - 0.0005 + Lt * 0.05 * Math.sin((s / Lt) * Math.PI) - Lt * 0.03 * (s / Lt) ** 2;
        return v3(x, y, z);
      },
      (t) => {
        const tw = sgn * 0.55 * Math.sin(Math.PI * t * 0.9);
        return v3(Math.cos(spread) * Math.cos(tw), Math.sin(spread) * Math.cos(tw), Math.sin(tw));
      },
      (t) => (rw / 2) * (0.4 + 0.6 * smooth(Math.min(1, t * 3.5))),
      (t) => th * (t > 0.995 ? 0.2 : 1),
      (t, u) => S.folds * rw * 0.05 * (1 - t) ** 2 * Math.sin(u * Math.PI * 2 + sgn),
    );
  }
  // Knot: a short puffy band wrapped around the gathered loops.
  const ky = rw * 0.24, kz = Math.max(Dz * 0.42, th * 3);
  ribbon(
    acc,
    48,
    true,
    (t) => {
      const a = t * Math.PI * 2;
      const front = lerp(0.7, 1, smoothstep(-0.35, 0.35, Math.cos(a)));
      return v3(0, Math.sin(a) * ky, z0 + Math.cos(a) * kz * front + kz * 0.08);
    },
    () => v3(1, 0, 0),
    (t) => (knotW / 2) * (1 + 0.12 * Math.cos(t * Math.PI * 2)),
    () => th * 1.1,
    (t, u) => rw * 0.035 * Math.cos(t * Math.PI * 2) * (1 - u * u) + rw * 0.015 * Math.sin(u * Math.PI * 3) * Math.max(0, Math.cos(t * Math.PI * 2)),
  );
  return acc.finish();
};

// ---------- Piping ----------

const piping: Builder = (p, path) => {
  const track = new Track(path);
  const r = p.radius;
  const edge = p.align === 1;
  const wc = edge ? -r * 0.55 : 0;
  const nc = OFF + r * 0.9;
  // Profile CCW: foot on +W, up a fillet, around the cord, down to the -W foot (or tucked under on edges).
  const prof: [number, number][] = [];
  prof.push([wc + r * 1.5, OFF]);
  prof.push([wc + r * 1.05, OFF + r * 0.12]);
  const aStart = -0.25 * Math.PI, aEnd = edge ? 1.35 * Math.PI : 1.25 * Math.PI;
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = lerp(aStart, aEnd, i / n);
    prof.push([wc + Math.cos(a) * r, nc + Math.sin(a) * r]);
  }
  if (!edge) {
    prof.push([wc - r * 1.05, OFF + r * 0.12]);
    prof.push([wc - r * 1.5, OFF]);
  } else prof.push([wc + Math.cos(aEnd) * r * 0.6, OFF]);
  const C = prof.length;
  const R = rowsFor(track, 0.0012, C, 16000);
  const frames = track.stations(R).map((s) => track.frame(s));
  const acc = new Acc();
  // Bias-cut fabric: rotate the weave 45 degrees.
  bandSweep(acc, track, frames, C, (_, j) => [prof[j][0], prof[j][1], 0], "main", { uvRotate: Math.PI / 4 });
  return acc.finish();
};

// ---------- Ruching ----------

const ruching: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height;
  const [w0, w1] = span(p.align, H);
  const wc = (w0 + w1) / 2, hv = H / 2;
  const L = track.length;
  const spacing = 0.01 / p.density;
  // Dense alternating folds (irregular widths and depths), warped into chevrons that sweep away
  // from the gathered center line, with a second finer family that forks between them.
  const main = foldField(track, spacing, 31);
  const fine = foldField(track, spacing * 0.55, 37);
  const A = Math.min(0.006, spacing * 0.42 + 0.0006);
  const per = track.closed ? Math.round(L / spacing) : 0;
  const field = (s: number, v: number) => {
    const av = Math.abs(v) / hv;
    const lean = 0.22 + 0.12 * noise1(s / spacing / 3, 41, per ? Math.max(1, Math.round(per / 3)) : 0);
    const f1 = main(s - Math.abs(v) * lean - v * av * 0.08);
    const f2 = fine(s - Math.abs(v) * lean * 1.4 + 0.3 * v);
    const c1 = Math.cos(f1.phase), c2 = Math.cos(f2.phase);
    const soft = (c: number) => Math.sign(c) * Math.abs(c) ** 0.75;
    const env = (1 - av ** 2.2) ** 0.8;
    const fork = 0.5 + 0.5 * noise1(s / spacing / 2 + v * 40, 43);
    const channel = 1 - 0.65 * Math.exp(-((v / Math.max(0.0015, hv * 0.07)) ** 2));
    return A * channel * (env * (f1.amp * soft(c1) * 0.75 + 0.35 * fork * soft(c2) * (0.4 + 0.6 * av)) + 0.45 * (1 - av * av));
  };
  // Profile CCW: flat back, +W edge, displaced front from +W to -W, -W edge.
  const nf = clamp(Math.round(H / 0.0012), 14, 40);
  const base = 0.0009;
  type PP = { w: number; n: number; disp: boolean };
  const prof: PP[] = [{ w: w0 + 0.0008, n: OFF, disp: false }, { w: w1 - 0.0008, n: OFF, disp: false }, { w: w1, n: OFF + base * 0.5, disp: false }];
  for (let j = 0; j <= nf; j++) {
    const f = j / nf;
    const w = lerp(w1 - 0.0005, w0 + 0.0005, f);
    prof.push({ w, n: OFF + base + A * 0.3, disp: true });
  }
  prof.push({ w: w0, n: OFF + base * 0.5, disp: false });
  const C = prof.length;
  const R = rowsFor(track, 0.0008, C, 24000);
  const ss = track.stations(R);
  const frames = ss.map((s) => track.frame(s));
  const acc = new Acc();
  bandSweep(acc, track, frames, C, (i, j) => {
    const q = prof[j];
    if (!q.disp) return [q.w, q.n, 0];
    const v = q.w - wc;
    const edgeFade = smoothstep(0, 0.14, (hv - Math.abs(v)) / hv);
    return [q.w, OFF + base * 0.6 + (q.n - OFF - base * 0.6 + field(ss[i], v)) * edgeFade, 0];
  }, "main");
  return acc.finish();
};

// ---------- Fringe ----------

const fringe: Builder = (p, path) => {
  const track = new Track(path);
  const Ls = p.length;
  const yarn = p.style === 1;
  const [, w1] = span(p.align, Ls);
  const acc = new Acc();
  const hb = yarn ? 0.007 : 0.01;
  const ht = yarn ? 0.0016 : 0.0012;
  // Heading strip (on the garment just above where the strands start).
  const hp: [number, number][] = rrectProfile(hb + 0.0015, ht, ht * 0.45, 3).map(([x, y]) => [w1 + (hb - 0.0015) / 2 + x, OFF + ht / 2 + y]);
  const C = hp.length;
  const R = rowsFor(track, 0.002, C, 5000);
  const frames = track.stations(R).map((s) => track.frame(s));
  bandSweep(acc, track, frames, C, (_, j) => [hp[j][0], hp[j][1], 0], "main");
  // Topstitch on the heading.
  const sp: V[] = [], sn: V[] = [];
  for (const f of frames) {
    sp.push(place(f, w1 + hb * 0.55, OFF + ht + 0.00012));
    sn.push(f.n);
  }
  const st = stitchesAlong(sp, sn, track.closed, 0.003, 0.0004);
  if (st) acc.add(st, tone(0.7));
  // Strands: suede = flat cut strips side by side; yarn = bundles of twisted plies tied at the heading.
  const r = rng(7);
  const bundle = yarn ? 2 : 1;
  const per = yarn ? (10 * 4 * 2 + 12) * bundle + 80 : 7 * 8 * 2 + 12;
  const groups = Math.max(1, Math.min(Math.round((track.length * 100 * p.density) / bundle), Math.floor((yarn ? 24000 : 16000) / per)));
  const pitch = track.length / groups;
  for (let k = 0; k < groups; k++) {
    const s = (k + 0.5) * pitch;
    const f = track.frame(s);
    const top = w1 + 0.0035;
    if (yarn) {
      // Knot: a small lumpy wrap where the bundle is looped over the heading.
      const kr = 0.0013;
      const knot = new THREE.IcosahedronGeometry(kr, 1).scale(1.15, 1, 0.8);
      const kp = place(f, top - 0.001, OFF + ht + kr * 0.6);
      knot.applyMatrix4(new THREE.Matrix4().makeBasis(f.t, f.w, f.n).setPosition(kp));
      acc.add(knot, "main", { crease: 1.2 });
    }
    for (let b = 0; b < bundle; b++) {
      const len = Ls * (0.94 + 0.1 * r()) + 0.002;
      const sway = (r() - 0.5) * (yarn ? 0.16 : 0.1) * Ls;
      const out = (0.2 + r()) * 0.03 * Ls;
      const ph = r() * 6;
      const splay = yarn ? (b - (bundle - 1) / 2) * 0.0011 : 0;
      const nSeg = yarn ? 8 : 7;
      const pts: V[] = [];
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        const start = yarn ? top - 0.001 : top;
        pts.push(place(f, start - t * len, OFF + ht * 0.5 + out * t ** 1.5 + (yarn ? ht + 0.0008 : 0.0006) * (1 - t * 0.5), splay * (0.3 + t) + sway * t ** 2 + 0.0008 * Math.sin(ph + t * 5) * t));
      }
      if (yarn) {
        const curve = new THREE.CatmullRomCurve3(pts);
        acc.add(braidTube(curve, 10, 0.00068, 4, 3, 0.0032, 0.26), "main");
        // Frayed tip: the plies open into a little flare that also closes the tube end.
        const tip = curve.getPoint(1), dir = curve.getTangent(1);
        const tuft = new THREE.ConeGeometry(0.00105, 0.0024, 6, 1, false);
        tuft.applyMatrix4(new THREE.Matrix4().makeBasis(f.t, dir.clone().negate(), f.n).setPosition(tip));
        acc.add(tuft, "main", { crease: 1.2 });
      } else {
        const sw = Math.min(pitch * 0.82, 0.004);
        acc.add(sweep(pts, rrectProfile(sw, 0.0009, 0.0003, 1), f.t.clone().addScaledVector(f.n, 0.15 * (r() - 0.5)).normalize()), "main", { crease: 0.9 });
      }
    }
  }
  return acc.finish();
};

// ---------- Scalloped edge ----------

const scallopEdge: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height;
  const [, w1] = span(p.align, H);
  const K = track.repeats(p.scallop, 1);
  const sw = track.length / K;
  const depth = Math.min(sw * 0.4, H * 0.6);
  const Rc = (sw * sw / 4 + depth * depth) / (2 * depth);
  const cw = w1 - H + Rc; // circle center (in w) of every scallop
  const per = 16;
  // Rows: uniform in angle on each scallop circle so the steep cusp flanks get enough rows.
  const a0 = Math.asin(clamp(sw / 2 / Rc, 0, 1));
  const ss: number[] = [];
  for (let k = 0; k < K; k++) for (let i = 0; i < per; i++) ss.push(k * sw + sw / 2 + Rc * Math.sin(-a0 + (2 * a0 * i) / per));
  if (!track.closed) ss.push(track.length);
  const frames = ss.map((s) => track.frame(s));
  const freeW = (s: number) => {
    const x = ((((s % sw) + sw) % sw) - sw / 2);
    return cw - Math.sqrt(Math.max(0, Rc * Rc - x * x));
  };
  const T = 0.0016;
  // Profile CCW in (fraction from free edge -> attached, n): back, attached edge, front, rolled free edge.
  type PP = { f: number; n: number; dw: number };
  const prof: PP[] = [{ f: 0.02, n: OFF, dw: 0 }, { f: 1, n: OFF, dw: 0 }, { f: 1, n: OFF + T * 0.55, dw: 0.0004 }];
  for (let j = 1; j <= 5; j++) {
    const f = 1 - j / 6;
    prof.push({ f, n: OFF + T * (0.8 + 0.2 * Math.sin(Math.PI * f)), dw: 0 });
  }
  for (let j = 0; j <= 4; j++) {
    const a = Math.PI / 2 + (j / 4) * Math.PI * 0.85;
    prof.push({ f: 0, n: OFF + T / 2 + Math.sin(a) * T / 2, dw: (Math.cos(a) * T) / 2 });
  }
  const C = prof.length;
  const acc = new Acc();
  // Woven fabric: planar UVs (along the path, across in W) so checks and stripes stay straight.
  const sAt = (i: number) => (i < ss.length ? ss[i] : track.length);
  bandSweep(acc, track, frames, C, (i, j) => {
    const q = prof[j];
    const fw = freeW(ss[i]) + T / 2;
    return [lerp(fw, w1, q.f) + q.dw, q.n, 0];
  }, "main", { uvMap: (i, j) => [sAt(i), lerp(freeW(sAt(i)) + T / 2, w1, prof[j % C].f) + prof[j % C].dw] });
  // Topstitch following each scallop (pivoting at the cusps).
  const inset = Math.min(0.003, depth * 0.45, H * 0.3);
  const sp: V[] = [], sn: V[] = [];
  const steps = Math.max(24, K * 28);
  for (let i = 0; i < (track.closed ? steps : steps + 1); i++) {
    const s = (i / steps) * track.length;
    const x = ((((s % sw) + sw) % sw) - sw / 2);
    const ri = Rc - inset;
    const w = cw - Math.sqrt(Math.max(0, ri * ri - x * x));
    const lim = cw - Math.sqrt(Math.max(0, ri * ri - (sw / 2) ** 2));
    const f = track.frame(s);
    sp.push(place(f, Math.min(w, lim), OFF + T * 1.02));
    sn.push(f.n);
  }
  const st = stitchesAlong(sp, sn, track.closed, 0.0027, 0.00036);
  if (st) acc.add(st, tone(0.72));
  return acc.finish();
};

// ---------- Pompom ----------

const pompom: Builder = (p) => {
  const Rb = p.radius;
  const acc = new Acc();
  const cz = Rb * 0.9;
  const r = rng(3);
  // Tufts of cut yarn ends: a fine sphere pushed out by a soft union of rounded tufts (jittered
  // fibonacci centers), deep creases between them.
  const nT = 800;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const tufts: { d: V; ar: number; h: number }[] = [];
  const ar0 = 1.5 * Math.sqrt(4 / nT);
  for (let i = 0; i < nT; i++) {
    const y = 1 - (2 * (i + 0.5)) / nT;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    const d = v3(Math.cos(th) * rad, y, Math.sin(th) * rad).add(v3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.09)).normalize();
    tufts.push({ d, ar: ar0 * (0.6 + 0.8 * r()), h: 0.55 + 0.45 * r() });
  }
  const ball = mergeVertices(new THREE.IcosahedronGeometry(1, 30).deleteAttribute("normal").deleteAttribute("uv"), 1e-6);
  const bp = ball.attributes.position;
  const k = 3;
  const u = new THREE.Vector3();
  // UVs: each vertex is mapped in the tangent plane of its nearest tuft (meters), so the yarn texture
  // sits on every tuft instead of smearing across the ball.
  const uvs = new Float32Array(bp.count * 2);
  const ta = new THREE.Vector3(), tb = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) {
    u.set(bp.getX(i), bp.getY(i), bp.getZ(i)).normalize();
    let sum = 0;
    let best = -2, bt = tufts[0];
    for (const t of tufts) {
      const c = u.dot(t.d);
      if (c > best) {
        best = c;
        bt = t;
      }
      if (c < 0.9) continue;
      const ang = Math.acos(Math.min(1, c)) / t.ar;
      if (ang < 1) sum += Math.exp(k * t.h * (1 - ang * ang) ** 2) - 1;
    }
    const f = Math.log(1 + sum) / k;
    const squash = u.z < -0.3 ? 0.9 : 1; // flattened where it is sewn to the garment
    const rr = Rb * (0.86 + 0.14 * f + 0.012 * Math.sin(u.x * 61 + u.y * 47) * Math.sin(u.z * 53 - u.x * 29)) * squash;
    bp.setXYZ(i, u.x * rr, u.y * rr, u.z * rr + cz);
    ta.set(0, 1, 0).cross(bt.d);
    if (ta.lengthSq() < 1e-6) ta.set(1, 0, 0);
    ta.normalize();
    tb.crossVectors(bt.d, ta);
    uvs[i * 2] = u.dot(ta) * Rb + bt.d.x * 0.05;
    uvs[i * 2 + 1] = u.dot(tb) * Rb + bt.d.y * 0.05;
  }
  ball.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  ball.computeVertexNormals();
  acc.add(ball, "main", { keepUV: true });
  // A few stray yarn ends breaking the silhouette.
  for (let i = 0; i < 45; i++) {
    const d = v3(r() - 0.5, r() - 0.5, r() * 0.8 - 0.2).normalize();
    const side = v3(r() - 0.5, r() - 0.5, r() - 0.5).cross(d).normalize();
    const a0 = d.clone().multiplyScalar(Rb * 0.85).add(v3(0, 0, cz));
    const a1 = d.clone().multiplyScalar(Rb * (1.0 + 0.06 * r())).addScaledVector(side, Rb * 0.06).add(v3(0, 0, cz));
    const curve = new THREE.QuadraticBezierCurve3(a0, a0.clone().lerp(a1, 0.6).addScaledVector(side, Rb * 0.04), a1);
    acc.add(new THREE.TubeGeometry(curve, 4, Rb * 0.028, 4, false), "main");
  }
  return acc.finish();
};

// ---------- Sherpa ----------

const sherpaBand: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height, pile = p.pile;
  const [w0, w1] = span(p.align, H);
  const L = track.length;
  // Clumped curls: jittered cells in (s, w), each a soft dome; the max of overlapping domes reads as
  // tufts. Two octaves (big clumps + small curls on top).
  const cell = clamp(pile * 0.7, 0.003, 0.007);
  const octave = (c: number, seed: number) => {
    const nu = Math.max(3, Math.round(L / c));
    const cu = L / nu;
    const nvv = Math.max(2, Math.ceil((H + 2 * pile) / c));
    const cv = (H + 2 * pile) / nvv;
    const r = rng(seed);
    const pts: { s: number; w: number; r: number; h: number }[][] = [];
    for (let i = 0; i < nu; i++) {
      const row: { s: number; w: number; r: number; h: number }[] = [];
      for (let j = 0; j < nvv; j++) row.push({ s: (i + 0.35 + 0.3 * r() + (j % 2) * 0.5) * cu, w: w0 - pile + (j + 0.35 + 0.3 * r()) * cv, r: c * (0.68 + 0.18 * r()), h: 0.8 + 0.2 * r() });
      pts.push(row);
    }
    return (s: number, w: number) => {
      const iu = Math.floor(s / cu), jv = Math.floor((w - (w0 - pile)) / cv);
      // Soft union of rounded domes: clumps merge with creases between them, never flat cells.
      const k = 4.5;
      let sum = 0;
      for (let di = -1; di <= 1; di++) {
        let ii = iu + di;
        let off = 0;
        if (track.closed) {
          if (ii < 0) { ii += nu; off = -L; }
          if (ii >= nu) { ii -= nu; off = L; }
        } else if (ii < 0 || ii >= nu) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = jv + dj;
          if (jj < 0 || jj >= nvv) continue;
          const q = pts[ii][jj];
          const d = Math.hypot(s - (q.s + off), w - q.w) / q.r;
          if (d < 1) sum += Math.exp(k * q.h * Math.sqrt(1 - d * d) * (1 - 0.18 * Math.exp(-((d / 0.3) ** 2)))) - 1;
        }
      }
      return Math.log(1 + sum) / k;
    };
  };
  const big = octave(cell, 17), small = octave(cell * 0.5, 23);
  const fluff = (s: number, w: number) => 0.85 * big(s, w) + 0.1 * small(s, w) + 0.05;
  // Profile CCW: flat back, rounded attached edge, pile face, rolled fluffy free edge at w0.
  const step = 0.0011;
  const nf = clamp(Math.round(H / step), 10, 70);
  const ht = 0.0012;
  type PP = { w: number; n: number; ow: number; on: number };
  const prof: PP[] = [{ w: w0 + pile * 0.5, n: OFF, ow: 0, on: -1 }, { w: w1 - 0.001, n: OFF, ow: 0, on: -1 }];
  for (let k = 0; k <= 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI * 0.5;
    prof.push({ w: w1 - 0.001 + Math.cos(a) * 0.001, n: OFF + 0.001 + Math.sin(a) * 0.001, ow: Math.cos(a), on: Math.sin(a) });
  }
  for (let j = 0; j <= nf; j++) {
    const f = j / nf;
    prof.push({ w: lerp(w1 - 0.0012, w0 + pile * 0.5, f), n: OFF + ht + pile * 0.45, ow: 0, on: 1 });
  }
  const rr = (ht + pile * 0.45) / 2;
  for (let k = 1; k < 7; k++) {
    const a = Math.PI / 2 + (k / 7) * Math.PI;
    prof.push({ w: w0 + pile * 0.5 + Math.cos(a) * rr * 1.1, n: OFF + rr + Math.sin(a) * rr, ow: Math.cos(a), on: Math.sin(a) });
  }
  const C = prof.length;
  const R = rowsFor(track, 0.0011, C, 26000);
  const ss = track.stations(R);
  const frames = ss.map((s) => track.frame(s));
  const acc = new Acc();
  bandSweep(acc, track, frames, C, (i, j) => {
    const q = prof[j];
    if (q.on < -0.5) return [q.w, q.n, 0];
    const d = pile * 0.6 * fluff(ss[i], q.w) * (q.on > 0.9 ? 1 : 0.85);
    return [q.w + q.ow * d, q.n + q.on * d, 0];
  }, "main");
  return acc.finish();
};

// ---------- Shirred (smocked) band ----------

const puffBand: Builder = (p, path) => {
  const track = new Track(path);
  const H = p.height;
  const [w0, w1] = span(p.align, H);
  const nRows = Math.max(2, Math.round(H / p.spacing));
  const gap = H / nRows;
  const L = track.length;
  const puff = Math.min(gap * 0.32, 0.0024);
  const perRow = 5;
  // Profile CCW: flat back, +W edge, puffed front from w1 down to w0, -W edge.
  type PP = { w: number; n: number; f: number; row: number };
  const prof: PP[] = [{ w: w0 + 0.0006, n: OFF, f: -1, row: 0 }, { w: w1 - 0.0006, n: OFF, f: -1, row: 0 }];
  for (let rI = 0; rI < nRows; rI++) {
    for (let k = 0; k < perRow; k++) {
      const f = k / perRow;
      prof.push({ w: w1 - (rI + f) * gap, n: OFF + 0.0007, f, row: rI });
    }
  }
  prof.push({ w: w0, n: OFF + 0.0007, f: 0, row: nRows });
  const C = prof.length;
  const R = rowsFor(track, 0.0009, C, 18000);
  const ss = track.stations(R);
  // Crinkles at least ~4.5 rows long so they stay soft puckers, not sawtooth.
  const crinkK = track.repeats(Math.max(0.004, (4.5 * L) / R), 6);
  const frames = ss.map((s) => track.frame(s));
  const acc = new Acc();
  bandSweep(acc, track, frames, C, (i, j) => {
    const q = prof[j];
    if (q.f < 0) return [q.w, q.n, 0];
    const s = ss[i];
    // Fabric puffs between elastic rows; crinkles shift phase row to row so they look gathered by hand.
    const bell = Math.sin(Math.PI * q.f) ** 0.8;
    const ph = (s / L) * crinkK * Math.PI * 2 + q.row * 2.1 + 1.3 * noise1((s / L) * crinkK * 0.5, q.row + 3, Math.round(crinkK * 0.5));
    const cr = Math.sin(ph);
    const shaped = Math.sign(cr) * Math.abs(cr) ** 0.7;
    const edgeRow = q.row === 0 || q.row === nRows - 1 ? 0.85 : 1;
    return [q.w, q.n + puff * bell * edgeRow * (0.55 + 0.45 * shaped) + 0.00035 * bell * noise1(s * 900, q.row), 0];
  }, "main", { uvMap: (i, _j, _u, v) => [i < ss.length ? ss[i] : L, v] });
  // Elastic shirring thread sunk in each valley (a continuous thread: the stitches are tiny and buried).
  const thread = tone(0.66);
  for (let rI = 1; rI < nRows; rI++) {
    const pts = frames.map((f) => place(f, w1 - rI * gap, OFF + 0.0008));
    const curve = new THREE.CatmullRomCurve3(pts, track.closed, "centripetal");
    acc.add(new THREE.TubeGeometry(curve, Math.min(500, Math.ceil(track.length / 0.002)), 0.00032, 3, track.closed), thread);
  }
  return acc.finish();
};

export const TRIM_BUILDERS: Record<string, Builder> = {
  rib_band: ribBand,
  ruffle,
  lace_trim: laceTrim,
  bow,
  piping,
  ruching,
  fringe,
  scallop_edge: scallopEdge,
  pompom,
  sherpa_band: sherpaBand,
  puff_band: puffBand,
};

