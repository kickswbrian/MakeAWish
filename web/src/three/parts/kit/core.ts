import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartMaterial } from "@wishit/shared";
import { boxProjectUVs } from "../uv.ts";

/**
 * Shared toolkit for the procedural kit builders: geometry primitives at millimetre scale,
 * creased normals that work on tiny parts, sweeps along paths, and an accumulator that merges
 * every piece into one geometry per material.
 */

// ---------- Materials ----------

/** Who colors a piece: the part's own material ("main"), a fixed finish, or a function of the part material. */
export type MatRef = "main" | PartMaterial | ((m: PartMaterial) => THREE.Material);

export interface Piece {
  geo: THREE.BufferGeometry;
  mat: MatRef;
}

export const M = {
  steel: { preset: "metal_polished", color: "#C9CCD2" },
  chrome: { preset: "metal_polished", color: "#E4E7EC", roughness: 0.12 },
  brushed: { preset: "metal_brushed", color: "#B7BBC2" },
  gunmetal: { preset: "metal_brushed", color: "#5C5F66" },
  darkSteel: { preset: "metal_polished", color: "#3A3C41", roughness: 0.35 },
  gold: { preset: "metal_polished", color: "#E3BA5F", roughness: 0.25 },
  brass: { preset: "metal_polished", color: "#CDA75A", roughness: 0.3 },
  blackPlastic: { preset: "plastic_matte", color: "#1C1D20" },
  blackGloss: { preset: "plastic_gloss", color: "#141518" },
  greyPlastic: { preset: "plastic_matte", color: "#4A4D53" },
  whitePlastic: { preset: "plastic_gloss", color: "#F2F2F0" },
  void: { preset: "plastic_matte", color: "#060607", roughness: 1 },
  rubberBlack: { preset: "rubber", color: "#202124" },
  webbingBlack: { preset: "nylon", color: "#25262A" },
  cordGrey: { preset: "cotton", color: "#3B3E44" },
} satisfies Record<string, PartMaterial>;

/** Relative luminance 0..1 of a hex color. */
export function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Thread that reads against the part color: cream on dark, charcoal on light. */
export function contrastThread(m: PartMaterial, preset: PartMaterial["preset"] = "cotton"): PartMaterial {
  return luminance(m.color) > 0.45 ? { preset, color: "#2C2D31" } : { preset, color: "#F1E9D6" };
}

/** The glow color for emissive parts. */
export const glowOf = (m: PartMaterial) => m.emissive ?? m.color;

// ---------- Geometry accumulator ----------

export interface AddOpts {
  /** Recompute normals with this crease angle (radians). Omit to keep the geometry's own normals. */
  crease?: number;
  /** Keep the geometry's own UVs (default: box-projected meter UVs). */
  keepUV?: boolean;
}

/** Collects geometries per material and merges each group into one BufferGeometry. */
export class Acc {
  private groups = new Map<MatRef, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: MatRef, opts: AddOpts = {}): this {
    const meterUV = !!geo.userData.meterUV;
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    g.clearGroups();
    if (opts.crease !== undefined || !g.attributes.normal) creasedNormals(g, opts.crease ?? 0.6);
    if (!(opts.keepUV || meterUV) || !g.attributes.uv) boxProjectUVs(g);
    const list = this.groups.get(mat);
    if (list) list.push(g);
    else this.groups.set(mat, [g]);
    return this;
  }

  finish(): Piece[] {
    const out: Piece[] = [];
    for (const [mat, geos] of this.groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      out.push({ geo: merged, mat });
    }
    return out;
  }
}

/**
 * Angle-thresholded normals for non-indexed geometry: faces sharing a vertex position are averaged
 * (area-weighted) when within `crease` radians. Unlike three's toCreasedNormals this hashes
 * positions at micrometer precision, which matters for millimetre-scale parts.
 */
export function creasedNormals(g: THREE.BufferGeometry, crease: number): void {
  const pos = g.attributes.position;
  const n = pos.count;
  const faces = n / 3;
  const fn = new Float32Array(faces * 3);
  const fa = new Float32Array(faces * 3); // area-weighted
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const map = new Map<string, number[]>();
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e6)},${Math.round(pos.getY(i) * 1e6)},${Math.round(pos.getZ(i) * 1e6)}`;
  for (let f = 0; f < faces; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    e1.subVectors(c, b);
    e2.subVectors(a, b);
    e1.cross(e2);
    fa[f * 3] = e1.x; fa[f * 3 + 1] = e1.y; fa[f * 3 + 2] = e1.z;
    const l = e1.length() || 1;
    fn[f * 3] = e1.x / l; fn[f * 3 + 1] = e1.y / l; fn[f * 3 + 2] = e1.z / l;
    for (let k = 0; k < 3; k++) {
      const h = key(f * 3 + k);
      const list = map.get(h);
      if (list) list.push(f);
      else map.set(h, [f]);
    }
  }
  const cosT = Math.cos(crease);
  const out = new Float32Array(n * 3);
  for (let f = 0; f < faces; f++) {
    const nx = fn[f * 3], ny = fn[f * 3 + 1], nz = fn[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const vi = f * 3 + k;
      const list = map.get(key(vi))!;
      let sx = 0, sy = 0, sz = 0;
      for (const o of list) {
        if (nx * fn[o * 3] + ny * fn[o * 3 + 1] + nz * fn[o * 3 + 2] >= cosT) {
          sx += fa[o * 3]; sy += fa[o * 3 + 1]; sz += fa[o * 3 + 2];
        }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[vi * 3] = sx / l; out[vi * 3 + 1] = sy / l; out[vi * 3 + 2] = sz / l;
    }
  }
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

/** Fully smooth normals (welds coincident vertices first). For displaced or swept surfaces. */
export function smoothNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const w = mergeVertices(g, 1e-8);
  w.computeVertexNormals();
  g.dispose();
  return w;
}

// ---------- Transforms ----------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Apply position / rotation (radians, XYZ) / scale to a geometry in place. */
export function xf(
  geo: THREE.BufferGeometry,
  p: [number, number, number] = [0, 0, 0],
  r: [number, number, number] = [0, 0, 0],
  s: number | [number, number, number] = 1,
): THREE.BufferGeometry {
  const sc = typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  _m.compose(new THREE.Vector3(...p), _q, sc);
  geo.applyMatrix4(_m);
  return geo;
}

// ---------- Primitives ----------

export const rbox = (w: number, h: number, d: number, r: number, segs = 3) =>
  new RoundedBoxGeometry(w, h, d, segs, Math.max(1e-6, Math.min(r, Math.min(w, h, d) / 2 - 1e-6)));

/** Lathe around +Y from [radius, y] points. */
export function lathe(pts: [number, number][], segs = 48, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segs, phiStart, phiLength);
  // Meter UVs: u runs around by local arc length (spun-metal grain), v along the profile by arc length.
  const cum = [0];
  for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const uv = g.attributes.uv;
  const np = pts.length;
  for (let i = 0; i <= segs; i++) {
    for (let j = 0; j < np; j++) {
      const k = i * np + j;
      if (k < uv.count) uv.setXY(k, (i / segs) * phiLength * Math.max(0, pts[j][0]), cum[j]);
    }
  }
  g.userData.meterUV = true;
  return g;
}

/** TubeGeometry with meter UVs (u along the tube, v around it). */
export function tube(curve: THREE.Curve<THREE.Vector3>, segs: number, r: number, radial = 12, closed = false): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, r, radial, closed);
  const L = curve.getLength();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * Math.PI * 2 * r);
  g.userData.meterUV = true;
  return g;
}

/** Lathe whose axis is +Z (rotated so lathe +Y maps to +Z). */
export function latheZ(pts: [number, number][], segs = 48): THREE.BufferGeometry {
  return lathe(pts, segs).rotateX(Math.PI / 2);
}

/** Rounded corner arc points for profile building: quarter circle from angle a0 to a1 (radians). */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Lathe with a radial displacement (knurling, threads, ribs). `disp(theta, y, r)` returns the
 * radius offset. Add it with a crease (normals are recomputed from the displaced faces).
 */
export function latheDisplaced(
  pts: [number, number][],
  segs: number,
  disp: (theta: number, y: number, r: number) => number,
): THREE.BufferGeometry {
  const g = lathe(pts, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-9) continue;
    const th = Math.atan2(x, z);
    const nr = Math.max(0, r + disp(th, y, r));
    pos.setXYZ(i, (x / r) * nr, y, (z / r) * nr);
  }
  g.deleteAttribute("normal");
  return g;
}

// ---------- 2D shapes ----------

/** Rounded rectangle centered at (cx, cy). */
export function rrectPath<T extends THREE.Path>(p: T, w: number, h: number, r: number, cx = 0, cy = 0, cw = true): T {
  r = Math.max(1e-6, Math.min(r, w / 2 - 1e-7, h / 2 - 1e-7));
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  if (!cw) {
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0);
    p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
    p.lineTo(x1, y1 - r);
    p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    p.lineTo(x0 + r, y1);
    p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
    p.lineTo(x0, y0 + r);
    p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  } else {
    p.moveTo(x0 + r, y0);
    p.absarc(x0 + r, y0 + r, r, Math.PI * 1.5, Math.PI, true);
    p.lineTo(x0, y1 - r);
    p.absarc(x0 + r, y1 - r, r, Math.PI, Math.PI / 2, true);
    p.lineTo(x1 - r, y1);
    p.absarc(x1 - r, y1 - r, r, Math.PI / 2, 0, true);
    p.lineTo(x1, y0 + r);
    p.absarc(x1 - r, y0 + r, r, 0, -Math.PI / 2, true);
    p.lineTo(x0 + r, y0);
  }
  return p;
}

export const rrect = (w: number, h: number, r: number, cx = 0, cy = 0) => rrectPath(new THREE.Shape(), w, h, r, cx, cy, false);
export const rrectHole = (w: number, h: number, r: number, cx = 0, cy = 0) => rrectPath(new THREE.Path(), w, h, r, cx, cy, true);

export function circleShape(r: number, cx = 0, cy = 0, n = 0): THREE.Shape {
  const s = new THREE.Shape();
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (i === 0) s.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    s.closePath();
  } else s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

export function circleHole(r: number, cx = 0, cy = 0, n = 0): THREE.Path {
  const p = new THREE.Path();
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      const a = -(i / n) * Math.PI * 2;
      if (i === 0) p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    p.closePath();
  } else p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

export function polyShape(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

export function polyHole(pts: [number, number][]): THREE.Path {
  const s = new THREE.Path();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

/** Chaikin corner cutting on a closed polygon: rounds every corner. */
export function chaikin(pts: [number, number][], iterations = 3, closed = true): [number, number][] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    const n = cur.length;
    const lim = closed ? n : n - 1;
    if (!closed) next.push(cur[0]);
    for (let i = 0; i < lim; i++) {
      const [ax, ay] = cur[i];
      const [bx, by] = cur[(i + 1) % n];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
}

/**
 * Extrude a shape along +Z from z0 to z0 + depth, with a rounded bevel that keeps the outline
 * at the given size (bevel grows inward).
 */
export function extrude(
  shape: THREE.Shape | THREE.Shape[],
  depth: number,
  bevel = 0,
  opts: { z0?: number; bevelSegs?: number; curveSegs?: number } = {},
): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, depth / 2 - 1e-7));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - 2 * b, 1e-7),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: opts.bevelSegs ?? 3,
    curveSegments: opts.curveSegs ?? 10,
  });
  g.translate(0, 0, (opts.z0 ?? 0) + b);
  return g;
}

// ---------- Sweeps ----------

/** Rounded-rect cross-section (CCW) of width w (along the sweep's width axis) and thickness t. */
export function rrectProfile(w: number, t: number, r: number, n = 4): [number, number][] {
  r = Math.min(r, w / 2 - 1e-7, t / 2 - 1e-7);
  const hw = w / 2, ht = t / 2;
  return [
    ...arcPts(hw - r, -ht + r, r, -Math.PI / 2, 0, n),
    ...arcPts(hw - r, ht - r, r, 0, Math.PI / 2, n),
    ...arcPts(-hw + r, ht - r, r, Math.PI / 2, Math.PI, n),
    ...arcPts(-hw + r, -ht + r, r, Math.PI, Math.PI * 1.5, n),
  ];
}

export function circleProfile(r: number, n = 12, sx = 1, sy = 1): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * r * sx, Math.sin(a) * r * sy]);
  }
  return out;
}

/**
 * Sweep a closed CCW profile (x along `widthAxis`, y along the path normal) along a path.
 * For planar paths pass the plane normal as widthAxis. `scale(t)` varies the section.
 */
export function sweep(
  path: THREE.Vector3[],
  profile: [number, number][],
  widthAxis: THREE.Vector3,
  opts: { closed?: boolean; caps?: boolean; scale?: (t: number) => [number, number] } = {},
): THREE.BufferGeometry {
  const closed = !!opts.closed;
  const caps = opts.caps ?? !closed;
  const np = path.length, nq = profile.length;
  const verts: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), W = new THREE.Vector3();
  const frames: { p: THREE.Vector3; w: THREE.Vector3; n: THREE.Vector3; s: [number, number] }[] = [];
  for (let i = 0; i < np; i++) {
    const prev = path[closed ? (i - 1 + np) % np : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % np : Math.min(np - 1, i + 1)];
    T.subVectors(next, prev).normalize();
    W.copy(widthAxis).addScaledVector(T, -widthAxis.dot(T)).normalize();
    N.crossVectors(T, W).normalize();
    const t = closed ? i / np : i / (np - 1);
    frames.push({ p: path[i], w: W.clone(), n: N.clone(), s: opts.scale ? opts.scale(t) : [1, 1] });
  }
  for (const f of frames) {
    for (const [x, y] of profile) {
      verts.push(f.p.x + f.w.x * x * f.s[0] + f.n.x * y * f.s[1], f.p.y + f.w.y * x * f.s[0] + f.n.y * y * f.s[1], f.p.z + f.w.z * x * f.s[0] + f.n.z * y * f.s[1]);
    }
  }
  const rings = closed ? np : np - 1;
  for (let i = 0; i < rings; i++) {
    const i2 = (i + 1) % np;
    for (let j = 0; j < nq; j++) {
      const j2 = (j + 1) % nq;
      const a = i * nq + j, b = i2 * nq + j, c = i2 * nq + j2, d = i * nq + j2;
      idx.push(a, c, b, a, d, c);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  body.setIndex(idx);
  const smooth = smoothNormals(body);
  body.dispose();
  if (!caps) return smooth;
  // Caps: flat, separate vertices.
  const tris = THREE.ShapeUtils.triangulateShape(profile.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const capVerts: number[] = [];
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  const capFor = (fi: number, outward: THREE.Vector3) => {
    const f = frames[fi];
    const P = (k: number, v: THREE.Vector3) => {
      const [x, y] = profile[k];
      return v.set(f.p.x + f.w.x * x * f.s[0] + f.n.x * y * f.s[1], f.p.y + f.w.y * x * f.s[0] + f.n.y * y * f.s[1], f.p.z + f.w.z * x * f.s[0] + f.n.z * y * f.s[1]);
    };
    for (const tri of tris) {
      P(tri[0], pa); P(tri[1], pb); P(tri[2], pc);
      const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      const order = nrm.dot(outward) < 0 ? [pa, pc, pb] : [pa, pb, pc];
      for (const v of order) capVerts.push(v.x, v.y, v.z);
    }
  };
  capFor(0, path[0].clone().sub(path[1]));
  capFor(np - 1, path[np - 1].clone().sub(path[np - 2]));
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(capVerts, 3));
  cap.computeVertexNormals();
  const s2 = smooth.toNonIndexed();
  smooth.dispose();
  const merged = mergeGeometries([s2, cap], false)!;
  s2.dispose();
  cap.dispose();
  return merged;
}

/** Evenly spaced samples of a curve (by arc length). */
export function samples(curve: THREE.Curve<THREE.Vector3>, n: number): THREE.Vector3[] {
  return curve.getSpacedPoints(n);
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A [t0, t1] slice of a (closed) curve, re-parameterized to [0, 1]. t1 may exceed 1 to wrap. */
export class SubCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private base: THREE.Curve<THREE.Vector3>, private t0: number, private t1: number) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    let u = this.t0 + (this.t1 - this.t0) * t;
    u = ((u % 1) + 1) % 1;
    return this.base.getPoint(u, target);
  }
}

/**
 * Tube with a braided / twisted-cord surface: radius modulated by a helical pattern.
 * `strands` bumps around the circumference, `twistPitch` meters per full twist.
 */
export function braidTube(curve: THREE.Curve<THREE.Vector3>, segs: number, r: number, radial = 10, strands = 3, twistPitch = 0.004, amp = 0.14): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, r, radial, false);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const L = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const along = (i / segs) * L;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const th = (j / radial) * Math.PI * 2;
      const d = r * amp * Math.cos(strands * th - (along / twistPitch) * Math.PI * 2);
      pos.setXYZ(k, pos.getX(k) + nor.getX(k) * d, pos.getY(k) + nor.getY(k) * d, pos.getZ(k) + nor.getZ(k) * d);
    }
  }
  const s = smoothNormals(g);
  g.dispose();
  return s;
}

/** Spherical cap facing +Z: base radius a at z = 0, height h. */
export function domeZ(a: number, h: number, segs = 32, rings = 10): THREE.BufferGeometry {
  const R = (a * a + h * h) / (2 * h);
  const theta = Math.asin(Math.min(1, a / R));
  const g = new THREE.SphereGeometry(R, segs, rings, 0, Math.PI * 2, 0, h > R ? Math.PI - theta : theta);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, h - R);
  return g;
}

// ---------- Repeated details ----------

const _basis = new THREE.Matrix4();

/**
 * Thread stitches: capsules placed along a path at a given pitch, lying on a surface with the
 * given normal. `dir`/`pos` sample a parametric path at arc length u in [0, 1].
 */
export function stitchRow(
  at: (u: number) => { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3 },
  pathLength: number,
  opts: { pitch: number; stitch: number; radius: number; flatten?: number; twist?: number; closed?: boolean },
): THREE.BufferGeometry | null {
  const count = Math.max(1, Math.floor(pathLength / opts.pitch + (opts.closed ? 0 : 0.0001)));
  const r = opts.radius;
  const len = Math.min(opts.stitch, opts.pitch * 0.95);
  // Low-poly ellipsoid stitch: reads as a taut thread stitch at a fraction of a capsule's cost.
  const base = new THREE.SphereGeometry(1, 7, 5).scale(r, len / 2, r);
  const geos: THREE.BufferGeometry[] = [];
  const offset = opts.closed ? 0 : (pathLength - count * opts.pitch) / 2 + opts.pitch / 2;
  const X = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = (offset + i * opts.pitch) / pathLength;
    const { p, t, n } = at(opts.closed ? ((s % 1) + 1) % 1 : Math.min(1, Math.max(0, s)));
    const tw = (opts.twist ?? 0.12);
    const tt = t.clone().applyAxisAngle(n, tw).normalize();
    X.crossVectors(tt, n).normalize();
    _basis.makeBasis(X, tt, n);
    const g = base.clone();
    g.scale(1, 1, opts.flatten ?? 0.7);
    g.applyMatrix4(_basis);
    g.translate(p.x, p.y, p.z);
    geos.push(g.toNonIndexed());
    g.dispose();
  }
  base.dispose();
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

/** Stitches along a closed 2D path on the z = z plane. */
export function stitch2D(path: THREE.Path, z: number, opts: { pitch: number; stitch: number; radius: number; flatten?: number }) {
  const L = path.getLength();
  const n = v3(0, 0, 1);
  return stitchRow((u) => {
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u);
    return { p: v3(p.x, p.y, z), t: v3(t.x, t.y, 0).normalize(), n };
  }, L, { ...opts, closed: true });
}

/** Stitches along a straight line from a to b (lying on a plane with normal n). */
export function stitchLine(a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, opts: { pitch: number; stitch: number; radius: number; flatten?: number }) {
  const L = a.distanceTo(b);
  const t = b.clone().sub(a).normalize();
  return stitchRow((u) => ({ p: a.clone().lerp(b, u), t, n }), L, opts);
}

// ---------- Params ----------

export type Params = Record<string, number>;

/** The line a path kit follows, in the part's frame, with optional per-point surface normals. */
export interface KitPath {
  points: [number, number, number][];
  normals?: [number, number, number][];
}

/** A kit builder: params resolved from the catalog (enums as option indices), plus the path for path kits. */
export type Builder = (p: Params, path?: KitPath) => Piece[];

/** Stable key for caching (params rounded to 0.1 mm). */
export function paramKey(p: Params): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${Math.round(p[k] * 1e4) / 1e4}`)
    .join(",");
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
