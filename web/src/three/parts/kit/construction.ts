import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import { Acc, type Builder, type KitPath, type Piece, M, clamp, contrastThread, lathe, v3 } from "./core.ts";

/**
 * Detail module builders: construction (catalog entries in shared/modules/construction.ts).
 *
 * Also the path toolkit the closure modules share: PathFrames (arc-length frames that follow the
 * surface normals of a kit path), a lean stitch template written straight into flat arrays (seams
 * carry thousands of stitches), and bandSweep for raised fabric ridges that hug the surface.
 */

// ---------- Path frames ----------

/** A point on a kit path: tangent T, surface normal N, and W = N x T (into the garment). */
export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  w: THREE.Vector3;
}

/**
 * Arc-length parameterized frames along a kit path. Sparse template paths are smoothed with a
 * centripetal Catmull-Rom (round, no overshoot) and resampled every ~0.6 mm; normals are
 * interpolated per segment and kept perpendicular to the tangent.
 */
export class PathFrames {
  readonly closed: boolean;
  readonly length: number;
  private readonly P: THREE.Vector3[];
  private readonly N: THREE.Vector3[];
  private readonly T: THREE.Vector3[];
  private readonly cum: number[];

  /** Dense samples; a closed path lists each point once (the wrap is added here). */
  constructor(points: THREE.Vector3[], normals: THREE.Vector3[], closed: boolean) {
    this.closed = closed;
    const P = points.map((q) => q.clone());
    const N = normals.map((q) => q.clone());
    if (closed) {
      P.push(P[0].clone());
      N.push(N[0].clone());
    }
    const n = P.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
    const T: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? P[i - 1] : closed ? P[n - 2] : P[0];
      const next = i < n - 1 ? P[i + 1] : closed ? P[1] : P[n - 1];
      const t = next.clone().sub(prev);
      T.push(t.lengthSq() > 1e-18 ? t.normalize() : v3(1, 0, 0));
    }
    this.P = P;
    this.N = N;
    this.T = T;
    this.cum = cum;
    this.length = Math.max(1e-6, cum[n - 1]);
  }

  /** Frames for a kit path (a straight line along X when the path is missing). */
  static from(path: KitPath | undefined, fallback = 0.3): PathFrames {
    const raw = path?.points ?? [];
    let pts = raw.map((q) => v3(q[0], q[1], q[2]));
    let nrm = path?.normals && path.normals.length === raw.length ? path.normals.map((q) => v3(q[0], q[1], q[2])) : null;
    if (pts.length < 2) {
      pts = [v3(-fallback / 2, 0, 0), v3(fallback / 2, 0, 0)];
      nrm = null;
    }
    let closed = pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-5;
    if (closed) {
      pts.pop();
      nrm?.pop();
    }
    const P: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
    pts.forEach((q, i) => {
      if (P.length && q.distanceTo(P[P.length - 1]) < 1e-6) return;
      P.push(q);
      N.push(nrm ? nrm[i].clone().normalize() : v3(0, 0, 1));
    });
    if (closed && P.length > 1 && P[0].distanceTo(P[P.length - 1]) < 1e-6) {
      P.pop();
      N.pop();
    }
    if (P.length < 3) closed = false;
    if (P.length < 2) {
      P.splice(0, P.length, v3(-fallback / 2, 0, 0), v3(fallback / 2, 0, 0));
      N.splice(0, N.length, v3(0, 0, 1), v3(0, 0, 1));
    }
    const segs = closed ? P.length : P.length - 1;
    let rough = 0;
    for (let i = 0; i < segs; i++) rough += P[i].distanceTo(P[(i + 1) % P.length]);
    const steps = clamp(Math.ceil(rough / 0.0006), 16, 4000);
    const curve = P.length > 2 ? new THREE.CatmullRomCurve3(P, closed, "centripetal") : null;
    const DP: THREE.Vector3[] = [], DN: THREE.Vector3[] = [];
    const count = closed ? steps : steps + 1;
    for (let i = 0; i < count; i++) {
      const t = i / steps;
      DP.push(curve ? curve.getPoint(t) : P[0].clone().lerp(P[1], t));
      const f = t * segs;
      const k = Math.min(segs - 1, Math.floor(f));
      const nn = N[k].clone().lerp(N[(k + 1) % N.length], f - k);
      DN.push(nn.lengthSq() > 1e-12 ? nn.normalize() : N[k].clone());
    }
    return new PathFrames(DP, DN, closed);
  }

  /** The frame at arc length s (wraps on closed paths, clamps on open ones). */
  at(s: number): Frame {
    const L = this.length;
    s = this.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    const c = this.cum;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const k = (s - c[lo]) / Math.max(1e-12, c[hi] - c[lo]);
    const p = this.P[lo].clone().lerp(this.P[hi], k);
    const t = this.T[lo].clone().lerp(this.T[hi], k).normalize();
    const n = this.N[lo].clone().lerp(this.N[hi], k);
    n.addScaledVector(t, -n.dot(t));
    if (n.lengthSq() < 1e-12) n.copy(Math.abs(t.z) < 0.9 ? v3(0, 0, 1) : v3(0, 1, 0)).addScaledVector(t, -n.dot(t));
    n.normalize();
    const w = n.clone().cross(t).normalize();
    return { p, t, n, w };
  }

  /** Point at arc length s shifted by w along W and h along N. */
  point(s: number, w = 0, h = 0): THREE.Vector3 {
    const f = this.at(s);
    return f.p.addScaledVector(f.w, w).addScaledVector(f.n, h);
  }

  /** A parallel path w along W (and h along N), resampled so pitches stay true on curves. */
  offset(w: number, h = 0, step = 0.0006): PathFrames {
    if (Math.abs(w) < 1e-7 && Math.abs(h) < 1e-7) return this;
    const n = Math.max(8, Math.ceil(this.length / step));
    const P: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
    for (let i = 0; i < (this.closed ? n : n + 1); i++) {
      const f = this.at((this.length * i) / n);
      P.push(f.p.addScaledVector(f.w, w).addScaledVector(f.n, h));
      N.push(f.n);
    }
    return new PathFrames(P, N, this.closed);
  }
}

/** Frames for a straight local line (point modules that run stitches or ridges along an axis). */
export function lineFrames(a: THREE.Vector3, b: THREE.Vector3, n = v3(0, 0, 1), steps = 16): PathFrames {
  const P: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    P.push(a.clone().lerp(b, i / steps));
    N.push(n.clone());
  }
  return new PathFrames(P, N, false);
}

// ---------- Thread ----------

/** One stitch (or any small repeated piece), local frame: x across, y along, z out. Flat triangle soup. */
export interface StitchTpl {
  pos: number[];
  nor: number[];
  uv: number[];
}

/**
 * A taut thread stitch between two needle holes: four elliptical rings (three when lean) and two
 * tips that dip into the cloth. 48 triangles (36 lean), analytic normals. `arch` bows the middle up (satin over a core).
 */
export function stitchTemplate(r: number, len: number, flat = 0.72, arch = 0, radial = 6, lean = false): StitchTpl {
  const half = len / 2;
  // Fine thread is a few pixels wide even close up: three rings (36 triangles) are plenty.
  const rings = lean
    ? [{ c: -0.62, k: 0.9 }, { c: 0, k: 1 }, { c: 0.62, k: 0.9 }]
    : [{ c: -0.84, k: 0.8 }, { c: -0.42, k: 0.98 }, { c: 0.42, k: 0.98 }, { c: 0.84, k: 0.8 }];
  const V: THREE.Vector3[] = [], Nn: THREE.Vector3[] = [], U: [number, number][] = [];
  for (const { c, k } of rings) {
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const x = Math.cos(th) * k, z = Math.sin(th) * k;
      V.push(v3(x * r, c * half, z * r * flat + arch * (1 - c * c)));
      Nn.push(v3(x / r, (c / half) * 0.6, z / (r * flat) - (arch > 0 ? (2 * c * arch) / (half * half) : 0)).normalize());
      U.push([c * half + half, th * r]);
    }
  }
  const tip0 = V.length;
  V.push(v3(0, -half, -0.25 * flat * r), v3(0, half, -0.25 * flat * r));
  Nn.push(v3(0, -1, 0.6).normalize(), v3(0, 1, 0.6).normalize());
  U.push([0, 0], [len, 0]);
  const tris: [number, number, number][] = [];
  const last = (rings.length - 1) * radial;
  for (let a = 0; a < rings.length - 1; a++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const i0 = a * radial + j, i1 = a * radial + j2, i2 = (a + 1) * radial + j2, i3 = (a + 1) * radial + j;
      tris.push([i0, i1, i2], [i0, i2, i3]);
    }
  }
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    tris.push([tip0, j2, j], [tip0 + 1, last + j, last + j2]);
  }
  const tpl: StitchTpl = { pos: [], nor: [], uv: [] };
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const t of tris) {
    e1.subVectors(V[t[1]], V[t[0]]);
    e2.subVectors(V[t[2]], V[t[0]]);
    const avg = Nn[t[0]].clone().add(Nn[t[1]]).add(Nn[t[2]]);
    const order = e1.cross(e2).dot(avg) < 0 ? [t[0], t[2], t[1]] : t;
    for (const i of order) {
      tpl.pos.push(V[i].x, V[i].y, V[i].z);
      tpl.nor.push(Nn[i].x, Nn[i].y, Nn[i].z);
      tpl.uv.push(U[i][0], U[i][1]);
    }
  }
  return tpl;
}

/** Collects stitches as raw arrays (cloning a geometry per stitch is far too slow for long seams). */
export class ThreadBuf {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];

  /** Place a template at c with basis X (across), Y (along), Z (out). */
  put(tpl: StitchTpl, c: THREE.Vector3, X: THREE.Vector3, Y: THREE.Vector3, Z: THREE.Vector3): void {
    const p = tpl.pos, n = tpl.nor;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      this.pos.push(c.x + X.x * x + Y.x * y + Z.x * z, c.y + X.y * x + Y.y * y + Z.y * z, c.z + X.z * x + Y.z * y + Z.z * z);
      const a = n[i], b = n[i + 1], d = n[i + 2];
      this.nor.push(X.x * a + Y.x * b + Z.x * d, X.y * a + Y.y * b + Z.y * d, X.z * a + Y.z * b + Z.z * d);
    }
    for (const u of tpl.uv) this.uv.push(u);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.userData.meterUV = true;
    return g;
  }

  /** Add the collected thread to an accumulator (keeps its analytic normals). */
  addTo(acc: Acc, mat: Piece["mat"]): void {
    const g = this.geometry();
    if (g) acc.add(g, mat);
  }
}

export interface StitchOpts {
  pitch: number;
  /** Thread radius. */
  r: number;
  /** Height / width of the thread section. */
  flat?: number;
  /** Fraction of the pitch where the thread is below the cloth. */
  gap?: number;
  /** Ply twist: each stitch leans this many radians off the seam line. */
  twist?: number;
  /** Center height above the path (default: resting on the surface). */
  lift?: number;
  from?: number;
  to?: number;
}

/** Lockstitch along a path: stitches sit between chord endpoints on the path, so they follow curves. */
export function stitchAlong(buf: ThreadBuf, f: PathFrames, o: StitchOpts): number {
  const L = f.length;
  const from = clamp(o.from ?? 0, 0, L), to = clamp(o.to ?? L, 0, L);
  const span = to - from;
  let pitch = o.pitch, n: number, start: number;
  if (f.closed && o.from === undefined && o.to === undefined) {
    n = Math.max(3, Math.round(L / pitch));
    pitch = L / n;
    start = 0;
  } else {
    n = Math.floor(span / pitch + 1e-6);
    if (n < 1) return 0;
    start = from + (span - n * pitch) / 2;
  }
  const flat = o.flat ?? 0.72;
  const len = pitch * (1 - (o.gap ?? 0.07));
  const tpl = stitchTemplate(o.r, len, flat, 0, 6, o.r < 0.00025);
  const lift = o.lift ?? 0.00012 + o.r * flat * 0.55;
  const tw = o.twist ?? 0.09;
  const Y = new THREE.Vector3(), X = new THREE.Vector3(), Z = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = start + (i + 0.5) * pitch;
    const a = f.at(s - len / 2).p, b = f.at(s + len / 2).p, fr = f.at(s);
    Y.subVectors(b, a);
    if (Y.lengthSq() < 1e-14) Y.copy(fr.t);
    Y.normalize();
    Z.copy(fr.n).addScaledVector(Y, -fr.n.dot(Y)).normalize();
    Y.applyAxisAngle(Z, tw);
    X.crossVectors(Y, Z).normalize();
    Z.crossVectors(X, Y).normalize();
    c.addVectors(a, b).multiplyScalar(0.5).addScaledVector(Z, lift);
    buf.put(tpl, c, X, Y, Z);
  }
  return n;
}

/** Thread radius per weight option: fine shirting, regular, heavy denim topstitch. */
export const THREAD_WEIGHT = [0.0002, 0.0003, 0.00046];
export const WEIGHT_OPTIONS = ["fine", "regular", "heavy"];

/** Thread colors for modules whose body is fabric (index = option in THREAD_OPTIONS). */
export const THREAD_OPTIONS = ["contrast", "gold", "tonal", "cream", "black", "white"];
export function threadMaterial(i: number): (m: PartMaterial) => THREE.Material {
  return (m) => {
    switch (i) {
      case 1: return getMaterial({ preset: "cotton", color: "#C98F33" });
      case 2: {
        const c = new THREE.Color(m.color).multiplyScalar(0.72);
        return getMaterial({ preset: "cotton", color: `#${c.getHexString()}` });
      }
      case 3: return getMaterial({ preset: "cotton", color: "#EDE3CB" });
      case 4: return getMaterial({ preset: "cotton", color: "#1E1F22" });
      case 5: return getMaterial({ preset: "cotton", color: "#F3F2EE" });
      default: return getMaterial(contrastThread(m));
    }
  };
}

// ---------- Surfaces along paths ----------

const smooth01 = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Indexed grid surface rows x cols with smooth normals; flip reverses the winding. */
function grid(rows: number, cols: number, at: (i: number, j: number) => THREE.Vector3, opts: { wrapRows?: boolean; flip?: boolean; uv?: (i: number, j: number) => [number, number] } = {}): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = at(i, j);
      pos.push(p.x, p.y, p.z);
      const u = opts.uv ? opts.uv(i, j) : [i, j];
      uv.push(u[0], u[1]);
    }
  }
  const R = opts.wrapRows ? rows : rows - 1;
  for (let i = 0; i < R; i++) {
    const i2 = (i + 1) % rows;
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = i2 * cols + j, c = i2 * cols + j + 1, d = i * cols + j + 1;
      if (opts.flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.meterUV = true;
  return g;
}

/**
 * A strip along the path with an open cross-section of [w, h] pairs (w along W ascending, h along
 * N). Profile ends should dip below 0 so the strip edges tuck into the surface. `hScale` / `wScale`
 * taper the section by arc length (ends of a seam, a dart's point).
 */
export function bandSweep(
  f: PathFrames,
  profile: [number, number][],
  opts: { step?: number; lift?: number; hScale?: (s: number) => number; wScale?: (s: number) => number; from?: number; to?: number } = {},
): THREE.BufferGeometry {
  const L = f.length;
  const from = opts.from ?? 0, to = opts.to ?? L;
  const whole = f.closed && opts.from === undefined && opts.to === undefined;
  const n = Math.max(2, Math.ceil((to - from) / (opts.step ?? 0.0012)));
  const rows = whole ? n : n + 1;
  const lift = opts.lift ?? 0.0003;
  const frames = Array.from({ length: rows }, (_, i) => {
    const s = from + ((to - from) * i) / n;
    return { s, f: f.at(s), hs: opts.hScale ? opts.hScale(s) : 1, ws: opts.wScale ? opts.wScale(s) : 1 };
  });
  return grid(rows, profile.length, (i, j) => {
    const { f: fr, hs, ws } = frames[i];
    const [w, h] = profile[j];
    return fr.p.clone().addScaledVector(fr.w, w * ws).addScaledVector(fr.n, h * hs + lift);
  }, { wrapRows: whole, uv: (i, j) => [frames[i].s, profile[j][0]] });
}

/** Linear interpolation of a profile's height at w. */
function profileAt(profile: [number, number][], w: number): number {
  if (w <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (w <= profile[i][0]) {
      const [w0, h0] = profile[i - 1], [w1, h1] = profile[i];
      return h0 + ((h1 - h0) * (w - w0)) / Math.max(1e-9, w1 - w0);
    }
  }
  return profile[profile.length - 1][1];
}

// ---------- Topstitch ----------

/** Parallel rows of lockstitch hugging the surface. Main material = thread. */
export const topstitch: Builder = (p, path) => {
  const f = PathFrames.from(path);
  const rows = clamp(Math.round(p.rows), 1, 3);
  const r = THREAD_WEIGHT[p.weight] ?? THREAD_WEIGHT[1];
  const buf = new ThreadBuf();
  for (let k = 0; k < rows; k++) {
    const w = p.offset + (k - (rows - 1) / 2) * p.gap;
    stitchAlong(buf, f.offset(w), { pitch: p.pitch, r, flat: 0.7 });
  }
  const acc = new Acc();
  buf.addTo(acc, "main");
  return acc.finish();
};

// ---------- Welt / flat-felled seam ----------

/**
 * Raised flat-felled seam: a soft ramp on the -W side and a crisp folded edge on +W, with rows of
 * stitches on the felled band. Main = garment fabric; thread color from the `thread` option.
 */
export const seamWelt: Builder = (p, path) => {
  const f = PathFrames.from(path);
  const hw = p.width / 2, H = p.height;
  const prof: [number, number][] = [
    [-hw - 0.0012, -0.00035], [-hw - 0.0005, -0.00005], [-hw, 0.2 * H], [-hw + 0.0008, 0.5 * H], [-hw + 0.002, 0.76 * H],
    [-0.4 * hw, 0.9 * H], [0, 0.96 * H], [0.5 * hw, H], [hw - 0.0009, 0.99 * H], [hw - 0.00045, 0.9 * H],
    [hw - 0.00015, 0.66 * H], [hw, 0.36 * H], [hw + 0.0001, 0.08 * H], [hw + 0.0003, -0.00035],
  ];
  const L = f.length;
  const taper = (s: number) => (f.closed ? 1 : Math.sqrt(smooth01(0, 0.004, s) * smooth01(0, 0.004, L - s)));
  const acc = new Acc();
  acc.add(bandSweep(f, prof, { step: 0.0012, hScale: taper }), "main");
  const rows = clamp(Math.round(p.rows), 1, 3);
  const inset = Math.min(0.0016, hw * 0.4);
  const ws = rows === 1 ? [hw - inset] : rows === 2 ? [-hw + inset + 0.0006, hw - inset] : [-hw + inset + 0.0006, 0.1 * hw, hw - inset];
  const r = THREAD_WEIGHT[p.weight] ?? THREAD_WEIGHT[1];
  const buf = new ThreadBuf();
  for (const w of ws) {
    const h = profileAt(prof, w) + 0.0003;
    stitchAlong(buf, f.offset(w, h), { pitch: r > 0.0004 ? 0.0035 : 0.003, r, from: f.closed ? undefined : 0.002, to: f.closed ? undefined : L - 0.002 });
  }
  buf.addTo(acc, threadMaterial(p.thread));
  return acc.finish();
};

// ---------- Pleats ----------

/**
 * Pressed pleats hanging from the path: each is a raised fold with a crisp edge (knife pleats all
 * face +T; box pleats are a raised panel with an edge on each side). Main = garment fabric.
 */
export const pleats: Builder = (p, path) => {
  const f = PathFrames.from(path);
  const L = f.length;
  const count = clamp(Math.round(p.count), 1, 24);
  const len = p.length, D = p.depth;
  const down = p.align === 1 ? 1 : -1; // outside (default) hangs toward -W
  const spacing = L / count;
  const A = Math.min(0.024, spacing * 0.5);
  const e = 0.0013;
  const knife: [number, number][] = [
    [-A, -0.12], [-0.85 * A, 0.04], [-0.62 * A, 0.28], [-0.4 * A, 0.55], [-0.2 * A, 0.78], [-0.07 * A, 0.92],
    [-0.75 * e, 0.99], [-0.3 * e, 1.0], [0, 0.95], [0.25 * e, 0.8], [0.5 * e, 0.52], [0.68 * e, 0.22], [0.8 * e, -0.12],
  ];
  const B = A * 0.9;
  const box: [number, number][] = [
    [-B / 2 - 0.8 * e, -0.12], [-B / 2 - 0.68 * e, 0.22], [-B / 2 - 0.5 * e, 0.52], [-B / 2 - 0.25 * e, 0.8], [-B / 2, 0.95],
    [-B / 2 + 0.4 * e, 1.0], [-0.25 * B, 0.97], [0, 0.94], [0.25 * B, 0.97], [B / 2 - 0.4 * e, 1.0],
    [B / 2, 0.95], [B / 2 + 0.25 * e, 0.8], [B / 2 + 0.5 * e, 0.52], [B / 2 + 0.68 * e, 0.22], [B / 2 + 0.8 * e, -0.12],
  ];
  const prof = p.style === 1 ? box : knife;
  const fade = clamp(p.fade, 0, 1);
  const H = (v: number) => {
    const u = v / len;
    const grow = 0.5 + 0.5 * smooth01(0, 0.4, u);
    const tail = fade > 0 ? 1 - smooth01(1 - fade, 1, u) * 0.97 : 1;
    return grow * tail;
  };
  const acc = new Acc();
  const rowsN = Math.max(8, Math.min(48, Math.ceil(len / 0.006)));
  // Open paths: pleats hang with gravity, all in the path's average W direction (a wavy waistline
  // must not fan them out). Closed paths (skirt hems/waists) use the local W.
  const avgW = new THREE.Vector3();
  if (!f.closed) for (let i = 0; i <= 16; i++) avgW.add(f.at((L * i) / 16).w);
  for (let k = 0; k < count; k++) {
    const s = f.closed ? spacing * k : spacing * (k + 0.5);
    const fr = f.at(s);
    const dir = fr.w.clone();
    if (avgW.lengthSq() > 1e-6) {
      const g = avgW.clone().addScaledVector(fr.n, -avgW.dot(fr.n));
      if (g.lengthSq() > 1e-6) dir.copy(g.normalize());
    }
    dir.multiplyScalar(down);
    const flip = fr.t.clone().cross(dir).dot(fr.n) < 0;
    const geo = grid(rowsN + 1, prof.length, (i, j) => {
      const v = (len * i) / rowsN;
      const [a, h] = prof[j];
      return fr.p.clone().addScaledVector(fr.t, a).addScaledVector(dir, v).addScaledVector(fr.n, h * D * H(v) + 0.0003);
    }, { flip: !flip, uv: (i, j) => [(len * i) / rowsN, prof[j][0]] });
    acc.add(geo, "main");
    // Fold shadow: a soft dark band where the fold edge meets the cloth (reads under any light).
    const edges = p.style === 1 ? [[-B / 2 - 0.8 * e, -1], [B / 2 + 0.8 * e, 1]] : [[0.8 * e, 1]];
    for (const [a0, side] of edges) {
      const band = grid(rowsN + 1, 3, (i, j) => {
        const v = (len * i) / rowsN;
        const wdt = mm(2.2) * H(v) * (D / 0.003);
        const a = a0 + side * wdt * [-(0.3), 0.25, 1][j];
        return fr.p.clone().addScaledVector(fr.t, a).addScaledVector(dir, v).addScaledVector(fr.n, 0.00022 + (j === 1 ? 0.00003 : 0));
      }, { flip: side > 0 ? !flip : flip });
      acc.add(band, shade);
    }
  }
  return acc.finish();
};

const mm = (v: number) => v * 0.001;
/** The part material, darkened (fold shadows). */
const shade = (m: PartMaterial) => getMaterial({ ...m, color: `#${new THREE.Color(m.color).multiplyScalar(0.55).getHexString()}` });

// ---------- Dart ----------

/**
 * A sewn dart: a tapered fold pressed to one side, running from the origin (wide end, at the seam)
 * down -Y to its point, with a fine stitch line in the crease. Main = garment fabric.
 */
export const dart: Builder = (p) => {
  const L = p.length, W0 = p.width / 2;
  const Hmax = Math.min(0.0012, 0.00035 + W0 * 0.12);
  const xs = [-1.15, -1, -0.8, -0.55, -0.3, -0.12, -0.04, 0, 0.05, 0.16, 0.36, 0.6, 0.82, 1, 1.15];
  const bump = (u: number) => {
    const a = Math.max(0, 1 - ((u - 0.18) / 1.0) ** 2) ** 1.6;
    const crease = 0.42 * Math.exp(-((u / 0.07) ** 2));
    return Math.abs(u) >= 1.1 ? -0.3 : a - crease;
  };
  const rows = Math.max(16, Math.ceil(L / 0.003));
  const width = (v: number) => Math.max(0.0005, W0 * (1 - v / L) ** 0.85);
  const height = (v: number) => Hmax * (1 - v / L) ** 0.75;
  const acc = new Acc();
  const geo = grid(rows + 1, xs.length, (i, j) => {
    const v = (L * i) / rows;
    const u = xs[j];
    return v3(u * width(v), -v, bump(u) * height(v) + 0.00025);
  }, { uv: (i, j) => [(L * i) / rows, xs[j] * W0] });
  acc.add(geo, "main");
  // Stitch line in the crease.
  const P: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const v = 0.0015 + ((L - 0.006) * i) / 24;
    P.push(v3(0, -v, bump(0) * height(v) + 0.00025));
    N.push(v3(0, 0, 1));
  }
  const buf = new ThreadBuf();
  stitchAlong(buf, new PathFrames(P, N, false), { pitch: 0.0024, r: 0.00019, flat: 0.65 });
  buf.addTo(acc, threadMaterial(p.thread));
  return acc.finish();
};

// ---------- Bar tack ----------

/** Dense zigzag satin bar along X over a padded core (pocket corners, fly base, belt loops). */
export const barTack: Builder = (p) => {
  const L = p.length, w = p.width;
  const acc = new Acc();
  const core = 0.0003;
  // Padding under the satin: shorter and narrower than the stitches so it never shows.
  const f = lineFrames(v3(-L / 2, 0, 0), v3(L / 2, 0, 0));
  const prof: [number, number][] = [[-0.52 * w, -0.0002], [-0.4 * w, 0.45 * core], [-0.2 * w, 0.88 * core], [0, core], [0.2 * w, 0.88 * core], [0.4 * w, 0.45 * core], [0.52 * w, -0.0002]];
  const endIn = Math.min(0.0006, L * 0.06);
  acc.add(bandSweep(f, prof, { step: L / 20, lift: 0.0001, from: endIn, to: L - endIn, hScale: (s) => smooth01(endIn, endIn + 0.0008, s) * smooth01(endIn, endIn + 0.0008, L - s) }), "main");
  // Satin: stitches across the bar, alternating diagonals (the zigzag), arched over the core.
  const n = Math.max(8, Math.round(L / 0.00024));
  const step = L / n;
  const r = 0.00021;
  const tpl = stitchTemplate(r, Math.hypot(w, step), 0.7, core * 0.85);
  const buf = new ThreadBuf();
  const Z = v3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * step;
    const Y = v3((i % 2 === 0 ? 1 : -1) * step, w, 0).normalize();
    const X = Y.clone().cross(Z).normalize();
    buf.put(tpl, v3(x, 0, 0.00012 + r * 0.3), X, Y, Z);
  }
  buf.addTo(acc, "main");
  return acc.finish();
};

// ---------- Jeans rivet ----------

export const FINISH_OPTIONS = ["auto", "copper", "brass", "nickel", "antique", "gunmetal", "gold", "black"];
const FINISHES: PartMaterial[] = [
  { preset: "metal_polished", color: "#B9784C", roughness: 0.34 },
  { preset: "metal_polished", color: "#B8733F", roughness: 0.34 },
  M.brass,
  { preset: "metal_polished", color: "#C4C7CC", roughness: 0.22 },
  { preset: "metal_brushed", color: "#8A6A3E", roughness: 0.5 },
  M.gunmetal,
  M.gold,
  { preset: "metal_polished", color: "#2A2B2F", roughness: 0.35 },
];
export const isMetal = (m: PartMaterial) => m.preset === "metal_polished" || m.preset === "metal_brushed";

/** Hardware finish by option index: "auto" (0) takes the part material when it is metal, else `auto`. */
export function finishMaterial(i: number, auto: PartMaterial = FINISHES[1]): (m: PartMaterial) => THREE.Material {
  return (m) => getMaterial(i > 0 ? FINISHES[Math.min(i, FINISHES.length - 1)] : isMetal(m) ? m : auto);
}
export const FINISH = { copper: FINISHES[1], brass: FINISHES[2], nickel: FINISHES[3], antique: FINISHES[4], gunmetal: FINISHES[5], gold: FINISHES[6], black: FINISHES[7] };

/**
 * Lathe around Z with a height (z) displacement: peened burrs, stamped rings. `disp(theta, r)` in
 * meters. Profile [r, z] runs from the bottom center outward and up over the crown.
 */
export function latheZStamped(profile: [number, number][], segs: number, disp: (theta: number, r: number) => number): THREE.BufferGeometry {
  const g = lathe(profile, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    pos.setY(i, pos.getY(i) + disp(Math.atan2(x, z), r));
  }
  g.deleteAttribute("normal");
  return g.rotateX(Math.PI / 2);
}

/** 3x5 pixel glyphs for stamped hardware lettering (rows top to bottom). */
const GLYPHS: Record<string, string> = {
  W: "101101101111101", I: "111010010010111", S: "111100111001111", H: "101101111101101", T: "111010010010010",
  E: "111100110100111", O: "111101101101111", N: "101111111111101", D: "110101101101110", ".": "000000000000010", " ": "000000000000000",
};

/** Strokes of a 3x5 glyph as [col0, row0, col1, row1] runs (vertical and horizontal), so letters read as lines. */
function glyphStrokes(bits: string): [number, number, number, number][] {
  const on = (c: number, r: number) => c >= 0 && c < 3 && r >= 0 && r < 5 && bits[r * 3 + c] === "1";
  const out: [number, number, number, number][] = [];
  const used = new Set<number>();
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 5; r++) {
      if (!on(c, r) || on(c, r - 1)) continue;
      let e = r;
      while (on(c, e + 1)) e++;
      if (e > r) {
        out.push([c, r, c, e]);
        for (let k = r; k <= e; k++) used.add(k * 3 + c);
      }
    }
  }
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      if (!on(c, r) || on(c - 1, r)) continue;
      let e = c;
      while (on(e + 1, r)) e++;
      if (e > c || !used.has(r * 3 + c)) out.push([c, r, e, r]);
    }
  }
  return out;
}

/**
 * Raised stamped lettering around a ring on a domed cap: one crisp bar per glyph stroke, tilted to
 * the dome slope. `zAt(r)` is the cap height at radius r. Tops of the letters face outward and the
 * text reads clockwise seen from +Z.
 */
export function stampedRing(acc: Acc, mat: Piece["mat"], text: string, rIn: number, rOut: number, zAt: (r: number) => number, relief: number): void {
  const chars = [...text];
  const cols = chars.length * 4;
  const rowH = (rOut - rIn) / 5;
  const R = new THREE.Vector3(), Tg = new THREE.Vector3(), Up = new THREE.Vector3(), Rr = new THREE.Vector3(), m = new THREE.Matrix4();
  const Z = v3(0, 0, 1);
  chars.forEach((ch, ci) => {
    for (const [c0, r0, c1, r1] of glyphStrokes(GLYPHS[ch] ?? GLYPHS[" "])) {
      const cc = (c0 + c1) / 2, rr = (r0 + r1) / 2;
      const th = Math.PI / 2 - ((ci * 4 + cc + 0.5) / cols) * Math.PI * 2;
      const r = rOut - (rr + 0.5) * rowH;
      const colW = (Math.PI * 2 * r) / cols;
      const stroke = Math.min(rowH, colW) * 0.62;
      const radial = (r1 - r0) * rowH + stroke;
      const tang = (c1 - c0) * colW + stroke;
      const e = rowH * 0.5;
      const slope = (zAt(r + e) - zAt(r - e)) / (2 * e);
      R.set(Math.cos(th), Math.sin(th), 0);
      Tg.set(-Math.sin(th), Math.cos(th), 0);
      Up.copy(Z).addScaledVector(R, -slope).normalize();
      Rr.copy(R).addScaledVector(Z, slope).normalize();
      const box = new THREE.BoxGeometry(radial, tang, relief * 2);
      const lift = relief * 0.1;
      m.makeBasis(Rr, Tg, Up).setPosition(R.x * r + Up.x * lift, R.y * r + Up.y * lift, zAt(r) + Up.z * lift);
      box.applyMatrix4(m);
      acc.add(box, mat, { crease: 0.3 });
    }
  });
}

/** Copper jeans rivet: flanged cap, stamped lettering ring, peened burr at the center. */
export const jeansRivet: Builder = (p) => {
  const s = p.radius / 0.0045;
  const mm = (v: number) => v * 0.001 * s;
  const raw: [number, number][] = [
    [0, 0], [4.25, 0], [4.45, 0.08], [4.56, 0.3], [4.52, 0.52], [4.36, 0.68], [4.05, 0.77], [3.78, 0.8],
    [3.62, 0.74], [3.5, 0.76], [3.36, 0.9], [3.12, 1.1], [2.85, 1.27], [2.5, 1.41], [2.1, 1.52], [1.7, 1.6],
    [1.35, 1.64], [1.12, 1.68], [1.02, 1.67], [0.92, 1.6], [0.8, 1.5], [0.62, 1.42], [0.34, 1.37], [0, 1.36],
  ];
  const prof = raw.map(([r, z]) => [mm(r), mm(z)] as [number, number]);
  const dome = prof.slice(10, 17).reverse(); // ascending r, 1.35 .. 3.36 mm
  const zAt = (r: number) => profileAt(dome, r);
  const burr = (th: number, r: number) =>
    r > mm(0.78) && r < mm(1.2) ? mm(0.04) * (Math.sin(th * 7 + 1.3) * 0.6 + Math.sin(th * 13) * 0.4) * Math.sin(((r - mm(0.78)) / mm(0.42)) * Math.PI) : 0;
  const acc = new Acc();
  const mat = finishMaterial(p.finish);
  acc.add(latheZStamped(prof, 96, burr), mat, { crease: 0.6 });
  stampedRing(acc, mat, "WISH IT . WISH IT . ", mm(1.85), mm(3.0), zAt, mm(0.045));
  return acc.finish();
};

export const CONSTRUCTION_BUILDERS: Record<string, Builder> = {
  topstitch,
  seam_welt: seamWelt,
  pleats,
  dart,
  bar_tack: barTack,
  jeans_rivet: jeansRivet,
};
