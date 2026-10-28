import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartMaterial } from "@wishit/shared";
import { gemSeatZ, HOOP_PROFILES, hoopSection, huggieDepth } from "@wishit/shared/modules/jewelry.ts";
import {
  Acc, type Builder, type KitPath, type MatRef, type Params, chaikin, circleProfile, clamp, extrude, lathe, latheZ, polyShape, rrect, rrectProfile,
  smoothNormals, sweep, tube, v3,
} from "./core.ts";

/**
 * Detail module builders: jewelry (catalog entries in shared/modules/jewelry.ts). Fine jewelry is
 * judged up close, so everything is at true size: 0.8 mm posts, 0.4 mm prongs, real brilliant
 * facets (flat-shaded so each one catches its own highlight), interlocking chain links.
 */

type V2 = [number, number];
type V = THREE.Vector3;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// ---------- Finishes ----------

/** Fixed metals for settings and caps (index = the catalog's `metal` enum). */
const METAL: PartMaterial[] = [
  { preset: "metal_polished", color: "#E3BA5F", roughness: 0.12 },
  { preset: "metal_polished", color: "#D8DCE2", roughness: 0.1 },
  { preset: "metal_polished", color: "#E6B7A0", roughness: 0.12 },
  { preset: "metal_polished", color: "#5C5F66", roughness: 0.2 },
];
/** Fixed stones (index = the catalog's `stone` enum). Onyx is opaque, so it is a black gloss. */
const STONE: PartMaterial[] = [
  { preset: "gem", color: "#F4F8FF" },
  { preset: "gem", color: "#B3122E" },
  { preset: "gem", color: "#1D47A8" },
  { preset: "gem", color: "#0F7D52" },
  { preset: "gem", color: "#8350B8" },
  { preset: "gem", color: "#E8A33A" },
  { preset: "plastic_gloss", color: "#111214", roughness: 0.05 },
  { preset: "gem", color: "#F0A3BF" },
];
const PEARL: PartMaterial = { preset: "pearl", color: "#EFE5D3" };
/** Shadowed slots and holes in metal. */
const DARK: PartMaterial = { preset: "metal_brushed", color: "#2A2623", roughness: 0.55 };

// ---------- Collected pieces (built in a local frame, then moved) ----------

interface Item {
  geo: THREE.BufferGeometry;
  mat: MatRef;
  crease?: number;
}
type Items = Item[];

const put = (out: Items, geo: THREE.BufferGeometry, mat: MatRef, crease?: number) => out.push({ geo, mat, crease });
const T4 = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
function moveItems(items: Items, m: THREE.Matrix4): Items {
  for (const it of items) it.geo.applyMatrix4(m);
  return items;
}
function flush(acc: Acc, items: Items): void {
  for (const it of items) acc.add(it.geo, it.mat, it.crease !== undefined ? { crease: it.crease } : {});
}

// ---------- Geometry helpers ----------

/**
 * Skin closed rings of equal vertex count into a surface (open along the run unless `closed`),
 * with optional fan caps. Winding is fixed afterwards so faces point outward.
 */
function loft(rings: V[][], opts: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}): THREE.BufferGeometry {
  const nr = rings.length, nq = rings[0].length;
  const pos: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  const idx: number[] = [];
  const runs = opts.closed ? nr : nr - 1;
  for (let i = 0; i < runs; i++) {
    const a = i * nq, b = ((i + 1) % nr) * nq;
    for (let j = 0; j < nq; j++) {
      const j2 = (j + 1) % nq;
      idx.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
    }
  }
  const cap = (ri: number, rev: boolean) => {
    const c = new THREE.Vector3();
    for (const p of rings[ri]) c.add(p);
    c.multiplyScalar(1 / nq);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < nq; j++) {
      const j2 = (j + 1) % nq;
      if (rev) idx.push(ci, ri * nq + j2, ri * nq + j);
      else idx.push(ci, ri * nq + j, ri * nq + j2);
    }
  };
  if (opts.capStart) cap(0, false);
  if (opts.capEnd) cap(nr - 1, true);
  // Outward check: the flux of x through the surface is 3 * volume, positive when faces point out.
  const cen = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) cen.x += pos[i], cen.y += pos[i + 1], cen.z += pos[i + 2];
  cen.multiplyScalar(3 / pos.length);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
  let flux = 0;
  for (let t = 0; t < idx.length; t += 3) {
    A.fromArray(pos, idx[t] * 3);
    B.fromArray(pos, idx[t + 1] * 3);
    C.fromArray(pos, idx[t + 2] * 3);
    n.subVectors(B, A).cross(C.clone().sub(A));
    flux += n.dot(A.add(B).add(C).multiplyScalar(1 / 3).sub(cen));
  }
  if (flux < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Flat-shaded triangles, each wound to face away from `center` (gems, faceted charms). */
function facetGeo(tris: V[][], center: V): THREE.BufferGeometry {
  const pos: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), m = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
    const order = e1.dot(m) < 0 ? [a, c, b] : [a, b, c];
    for (const p of order) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Radius of a closed polygon around the origin as a function of angle (ray cast, tabulated). */
function polarOf(pts: V2[]): (th: number) => number {
  const N = 720;
  const tab = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, dx = Math.cos(th), dy = Math.sin(th);
    let best = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (ax * ey - ex * ay) / den, u = (dy * ax - dx * ay) / den;
      if (u >= 0 && u <= 1 && t > 1e-9 && t < best) best = t;
    }
    tab[i] = Number.isFinite(best) ? best : i ? tab[i - 1] : 1;
  }
  return (th) => {
    const f = ((((th % TAU) + TAU) % TAU) / TAU) * N;
    const i = Math.floor(f), k = f - i;
    return tab[i] * (1 - k) + tab[Math.min(N, i + 1)] * k;
  };
}

/** Orthonormal frame matrix: local X -> x, Y -> y, Z -> z, origin at p. */
function basis(x: V, y: V, z: V, p: V): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}

/** Torus ring: inner radius `ri`, wire radius `w`, hole facing `axis`. */
function ring(ri: number, w: number, axis: "x" | "y" | "z", at: V, radial = 10, tubular = 40): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(ri + w, w, radial, tubular);
  if (axis === "x") g.rotateY(Math.PI / 2);
  else if (axis === "y") g.rotateX(Math.PI / 2);
  return g.translate(at.x, at.y, at.z);
}

/** Lathe for a profile listed top to bottom (caps, bells): reversed so the faces point outward. */
const latheDown = (pts: V2[], segs = 36) => lathe([...pts].reverse(), segs);

/** A cylinder (lathe profile along +Y) aimed from a to b. */
function aimed(profile: V2[], a: V, b: V, segs = 16): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = lathe(profile.map(([r, y]) => [r, y * len] as V2), segs);
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  return g.translate(a.x, a.y, a.z);
}

// ---------- Stone outlines ----------

/** A stone outline: polar radius r(θ) about center c (units: the short half-width is 1), prong angles in degrees. */
interface Outline {
  r: (th: number) => number;
  c: V2;
  half: V2;
  prongs: number[];
}

const vesica = (c: number, R: number) => (th: number) => {
  const k = Math.abs(Math.cos(th));
  return -c * k + Math.sqrt(c * c * k * k - c * c + R * R);
};
const marquiseR = vesica(1.5, 2.5);
const pearTop = vesica(0.78, 1.78);

const HEART_PTS: V2[] = (() => {
  const raw: V2[] = [];
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * TAU;
    raw.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
  }
  const ys = raw.map((p) => p[1]);
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return raw.map(([x, y]) => [x / 16, (y - cy) / 16]);
})();
const HEART_HALF_Y = Math.max(...HEART_PTS.map((p) => p[1]));
const heartR = polarOf(HEART_PTS);
/** Where the cleft between the lobes sits (fraction of the half width, above center). */
const HEART_CLEFT = HEART_PTS[0][1];

/** Emerald step cut outline: rectangle with cut corners. */
const OCT: V2[] = [[1, -1.08], [1, 1.08], [0.7, 1.38], [-0.7, 1.38], [-1, 1.08], [-1, -1.08], [-0.7, -1.38], [0.7, -1.38]];

const OUTLINES: Outline[] = [
  { r: () => 1, c: [0, 0], half: [1, 1], prongs: [45, 135, 225, 315] },
  { r: (th) => 1.35 / Math.hypot(1.35 * Math.cos(th), Math.sin(th)), c: [0, 0], half: [1, 1.35], prongs: [45, 135, 225, 315] },
  { r: (th) => (Math.sin(th) > 0 ? pearTop(th) : 1), c: [0, -0.3], half: [1, 1.3], prongs: [90, 190, 245, 295, 350] },
  { r: polarOf(OCT), c: [0, 0], half: [1, 1.38], prongs: [52, 128, 232, 308] },
  { r: marquiseR, c: [0, 0], half: [1, 2], prongs: [90, 270, 28, 152, 208, 332] },
  { r: heartR, c: [0, 0], half: [1, HEART_HALF_Y], prongs: [90, 205, 335, 270] },
];
const CUT_EMERALD = 3;
const ROUND = OUTLINES[0];
const PEAR = OUTLINES[2];

/** Long half-width of an outline: the stone's size is its length. */
const longHalf = (o: Outline) => Math.max(o.half[0], o.half[1]);

// ---------- Faceted stones ----------

/**
 * Brilliant cut for any star-shaped outline (round, oval, pear, marquise, heart): table, 8 star
 * facets, 8 kites, 16 upper and 16 lower girdle facets, 8 pavilion mains to the culet. Girdle centered
 * on z = 0, table facing +Z. R scales the outline's unit (short half-width).
 */
function brilliant(o: Outline, R: number): THREE.BufferGeometry {
  const g = 0.02 * R, C = 0.3 * R, P = 0.86 * R, rt = 0.56, rs = 0.78, rl = 0.3;
  const cx = o.c[0] * R, cy = o.c[1] * R;
  const pt = (k: number, th: number, z: number) => {
    const rr = o.r(th) * k * R;
    return v3(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, z);
  };
  const zc = (k: number) => g + (C * (1 - k)) / (1 - rt);
  const zp = (k: number) => -g - P * (1 - k);
  const a8 = (k: number) => (k * Math.PI) / 4;
  const T: V[] = [], S: V[] = [], L: V[] = [], Gt: V[] = [], Gb: V[] = [];
  for (let k = 0; k < 8; k++) {
    T.push(pt(rt, a8(k), g + C));
    S.push(pt(rs, a8(k) + Math.PI / 8, zc(rs)));
    L.push(pt(rl, a8(k) + Math.PI / 8, zp(rl)));
  }
  for (let j = 0; j < 32; j++) {
    Gt.push(pt(1, (j * Math.PI) / 16, g));
    Gb.push(pt(1, (j * Math.PI) / 16, -g));
  }
  const top = v3(cx, cy, g + C), cul = v3(cx, cy, -g - P);
  const tris: V[][] = [];
  for (let k = 0; k < 8; k++) {
    const k1 = (k + 1) % 8, km = (k + 7) % 8;
    tris.push([top, T[k], T[k1]], [T[k], S[k], T[k1]], [T[k], S[km], Gt[4 * k]], [T[k], Gt[4 * k], S[k]]);
    for (let i = 0; i < 4; i++) tris.push([S[k], Gt[(4 * k + i) % 32], Gt[(4 * k + i + 1) % 32]]);
    tris.push([Gb[4 * k], L[k], cul], [Gb[4 * k], cul, L[km]]);
    for (let i = 0; i < 4; i++) tris.push([L[k], Gb[(4 * k + i) % 32], Gb[(4 * k + i + 1) % 32]]);
  }
  for (let j = 0; j < 32; j++) {
    const j1 = (j + 1) % 32;
    tris.push([Gt[j], Gb[j], Gb[j1]], [Gt[j], Gb[j1], Gt[j1]]);
  }
  return facetGeo(tris, v3(cx, cy, 0));
}

/** Single cut for tiny pavé stones (under ~1.8 mm the extra brilliant facets are invisible): 48 triangles. */
function singleCut(R: number): THREE.BufferGeometry {
  const g = 0.02 * R, C = 0.3 * R, P = 0.86 * R;
  const T: V[] = [], G: V[] = [];
  for (let k = 0; k < 8; k++) T.push(v3(Math.cos((k * Math.PI) / 4) * 0.55 * R, Math.sin((k * Math.PI) / 4) * 0.55 * R, g + C));
  for (let j = 0; j < 16; j++) G.push(v3(Math.cos((j * Math.PI) / 8) * R, Math.sin((j * Math.PI) / 8) * R, g));
  const top = v3(0, 0, g + C), cul = v3(0, 0, -g - P);
  const tris: V[][] = [];
  for (let k = 0; k < 8; k++) {
    const k1 = (k + 1) % 8;
    tris.push([top, T[k], T[k1]], [T[k], G[2 * k], G[2 * k + 1]], [T[k], G[2 * k + 1], T[k1]], [T[k1], G[2 * k + 1], G[(2 * k + 2) % 16]]);
  }
  for (let j = 0; j < 16; j++) tris.push([G[j], cul, G[(j + 1) % 16]]);
  return facetGeo(tris, v3(0, 0, 0));
}

/** Emerald step cut: three crown steps to a large table, four pavilion steps to a keel line. */
function stepCut(R: number): THREE.BufferGeometry {
  const g = 0.02 * R, C = 0.3 * R, P = 0.82 * R;
  const ringAt = (d: number, z: number) => OCT.map(([x, y]) => v3(x * (1 - d) * R, y * (1 - d / 1.38) * R, z));
  const crown = [ringAt(0, g), ringAt(0.12, g + 0.38 * C), ringAt(0.24, g + 0.72 * C), ringAt(0.36, g + C)];
  const pav = [ringAt(0, -g), ringAt(0.25, -g - 0.32 * P), ringAt(0.5, -g - 0.62 * P), ringAt(0.75, -g - 0.86 * P), ringAt(0.97, -g - P)];
  const tris: V[][] = [];
  const band = (a: V[], b: V[]) => {
    for (let j = 0; j < a.length; j++) {
      const j1 = (j + 1) % a.length;
      tris.push([a[j], b[j], b[j1]], [a[j], b[j1], a[j1]]);
    }
  };
  const fan = (r: V[]) => {
    const c = r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length);
    for (let j = 0; j < r.length; j++) tris.push([c, r[j], r[(j + 1) % r.length]]);
  };
  for (let i = 0; i < crown.length - 1; i++) band(crown[i], crown[i + 1]);
  for (let i = 0; i < pav.length - 1; i++) band(pav[i], pav[i + 1]);
  band(crown[0], pav[0]);
  fan(crown[crown.length - 1]);
  fan(pav[pav.length - 1]);
  return facetGeo(tris, v3(0, 0, 0));
}

const stoneGeo = (cut: number, R: number) => (cut === CUT_EMERALD ? stepCut(R) : brilliant(OUTLINES[cut] ?? ROUND, R));

// ---------- Settings ----------

const prongRadius = (R: number) => clamp(0.13 * R, 0.00018, 0.0008);

/** Basket prong setting for a stone whose girdle sits at zg: prongs, gallery rail, base ring. */
function prongSet(out: Items, o: Outline, R: number, zg: number, mat: MatRef, cup = false): void {
  const pr = prongRadius(R);
  const cx = o.c[0] * R, cy = o.c[1] * R;
  const at = (th: number, rad: number, z: number) => v3(cx + Math.cos(th) * rad, cy + Math.sin(th) * rad, z);
  const zBase = 0.0002 + pr * 0.6, zRail = zg * 0.42;
  for (const deg of o.prongs) {
    const th = deg * D2R, rr = o.r(th) * R;
    const pts = [
      at(th, rr * 0.42, zBase), at(th, rr * 0.64, zRail), at(th, rr + pr * 0.55, zg - 0.05 * R),
      at(th, rr + pr * 0.5, zg + 0.02 * R + pr * 0.5), at(th, rr - pr * 0.55, zg + 0.07 * R + pr * 0.75),
    ];
    const path = new THREE.CatmullRomCurve3(pts, false, "centripetal").getSpacedPoints(26);
    const w = v3(-Math.sin(th), Math.cos(th), 0);
    put(out, sweep(path, circleProfile(pr, 12), w, { scale: (t) => [1 - 0.18 * t, 1 - 0.18 * t] }), mat, 0.8);
    const tip = path[path.length - 1];
    put(out, new THREE.SphereGeometry(pr * 0.86, 14, 10).scale(1, 1, 0.85).translate(tip.x, tip.y, tip.z), mat);
  }
  const loop = (k: number, z: number) => {
    const pts: V[] = [];
    for (let i = 0; i < 72; i++) {
      const th = (i / 72) * TAU;
      pts.push(at(th, o.r(th) * R * k, z));
    }
    return pts;
  };
  put(out, sweep(loop(0.64, zRail), circleProfile(pr * 0.72, 10), v3(0, 0, 1), { closed: true }), mat, 0.8);
  put(out, sweep(loop(0.42, zBase), circleProfile(pr * 0.78, 10), v3(0, 0, 1), { closed: true }), mat, 0.8);
  if (cup) {
    const rb = R * 0.42;
    put(out, lathe([[0, 0.00005], [0.0006, 0.00005], [rb * 0.92, zBase - pr * 0.2], [rb * 0.7, zBase + pr * 0.6], [0, zBase + pr * 0.6]], 40).rotateX(Math.PI / 2).translate(cx, cy, 0), mat, 0.7);
  }
}

/** Bezel collar around a stone whose girdle sits at zg: closed cup with a lip pressed over the crown. */
function bezelSet(out: Items, o: Outline, R: number, zg: number, mat: MatRef): void {
  const n = 96;
  const cx = o.c[0] * R, cy = o.c[1] * R;
  const ringAt = (s: number, z: number) => {
    const pts: V[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU, rr = o.r(th) * R * s;
      pts.push(v3(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, z));
    }
    return pts;
  };
  const zt = zg + 0.13 * R, e = Math.min(0.00022, zt * 0.1);
  const rings = [ringAt(1.06, 0), ringAt(1.13, e), ringAt(1.15, zt - e), ringAt(1.12, zt), ringAt(1.03, zt + 0.00001), ringAt(0.975, zg + 0.06 * R), ringAt(0.975, zg - 0.05 * R)];
  put(out, loft(rings, { capStart: true, capEnd: true }), mat, 0.75);
}

// ---------- Hoops ----------

/** Band cross-section [x = depth (Z), y = radial outward]. */
function bandSection(profile: string, radial: number, depth: number): V2[] {
  if (profile === "flat") return rrectProfile(depth, radial, radial * 0.45, 7);
  if (profile === "chunky") {
    const out: V2[] = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU, c = Math.cos(a), s = Math.sin(a);
      const y = (radial / 2) * Math.sign(s) * Math.abs(s) ** (2 / 2.6);
      out.push([(depth / 2) * Math.sign(c) * Math.abs(c) ** (2 / 2.6), s < 0 ? y * 0.9 : y]);
    }
    return out;
  }
  if (profile === "knife_edge") {
    const hw = depth / 2, hr = radial / 2, yk = -0.08 * radial;
    const out: V2[] = [];
    for (let i = 0; i < 4; i++) out.push([hw * (i / 4), hr + (yk - hr) * (i / 4)]);
    for (let i = 0; i <= 16; i++) {
      const f = (-Math.PI * i) / 16;
      out.push([hw * Math.cos(f), yk + (hr + yk) * Math.sin(f)]);
    }
    for (let i = 1; i < 4; i++) out.push([-hw * (1 - i / 4), yk + (hr - yk) * (i / 4)]);
    return out;
  }
  return circleProfile(radial / 2, 32, depth / radial, 1);
}

/** Point on a hoop band: ring centerline radius rc, centered at (0, -rc) so its top is the origin. */
const bandPt = (rc: number, a: number, x = 0, y = 0) => v3(Math.cos(a) * (rc + y), -rc + Math.sin(a) * (rc + y), x);
const bandT = (a: number) => v3(-Math.sin(a), Math.cos(a), 0);
const bandR = (a: number) => v3(Math.cos(a), Math.sin(a), 0);
const Z = v3(0, 0, 1);

interface Sample {
  a: number;
  s: number;
}

/** The band surface along samples (angle, section scale); `section` may vary along the arc (twist). */
function band(rc: number, samples: Sample[], section: (arc: number) => V2[], closed: boolean): THREE.BufferGeometry {
  const a0 = samples[0].a;
  const rings = samples.map(({ a, s }) => section((a - a0) * rc).map(([x, y]) => bandPt(rc, a, x * s, y * s)));
  return loft(rings, { closed, capStart: !closed, capEnd: !closed });
}

/** Evenly spaced angles over [a0, a1] (inclusive unless open), at most `step` meters apart along the centerline. */
function spaced(a0: number, a1: number, rc: number, step: number, min: number, inclusive = true): number[] {
  const n = Math.max(min, Math.ceil(((a1 - a0) * rc) / step));
  const out: number[] = [];
  for (let i = 0; i <= (inclusive ? n : n - 1); i++) out.push(a0 + ((a1 - a0) * i) / n);
  return out;
}

/** Twisted rope section: four rounded strands spiralling along the band. */
function twistSection(radial: number, depth: number, closedLen = 0): (arc: number) => V2[] {
  const n = 40;
  // On a closed band the twist must make whole lobe turns (period π/2) so the ring meets itself.
  let k = 1 / (radial * 0.55);
  if (closedLen > 0) k = (Math.max(1, Math.round((closedLen * k) / (Math.PI / 2))) * (Math.PI / 2)) / closedLen;
  return (arc) => {
    const psi = arc * k;
    const out: V2[] = [];
    for (let i = 0; i < n; i++) {
      const f = (i / n) * TAU;
      const r = (radial / 2) * (0.82 + 0.18 * Math.sqrt(Math.abs(Math.cos(2 * (f - psi)))));
      out.push([Math.cos(f) * r * (depth / radial), Math.sin(f) * r]);
    }
    return out;
  };
}

/**
 * A closed band with two click-hinge seams near the top (fine V grooves) and the hinge barrel
 * peeking on the inner side: click hoops and huggies.
 */
function clickBand(out: Items, rc: number, radial: number, depth: number, section: (arc: number) => V2[], seam: number): void {
  const top = Math.PI / 2;
  const e = 0.00011 / rc;
  const seams = [top - seam, top + seam];
  const base = spaced(top - Math.PI, top + Math.PI, rc, Math.min(radial * 0.3, (rc * TAU) / 160), 160, false).filter((a) => seams.every((s) => Math.abs(a - s) > e * 1.5));
  const samples: Sample[] = base.map((a) => ({ a, s: 1 }));
  for (const s of seams) samples.push({ a: s - e, s: 1 }, { a: s, s: 0.9 }, { a: s + e, s: 1 });
  samples.sort((p, q) => p.a - q.a);
  put(out, band(rc, samples, section, true), "main", 0.6);
  // Hinge barrel on the inside of the left seam.
  const h = bandPt(rc, top + seam, 0, -radial * 0.42);
  put(out, new THREE.CylinderGeometry(radial * 0.17, radial * 0.17, depth * 0.62, 18).rotateX(Math.PI / 2).translate(h.x, h.y, h.z), "main", 0.7);
}

/** A thin box at band angle a: dims along the band tangent, radial and Z; offsets in the same frame. */
function bandBox(rc: number, a: number, dims: [number, number, number], off: [number, number, number]): THREE.BufferGeometry {
  const p = bandPt(rc, a, off[2], off[1]).add(bandT(a).multiplyScalar(off[0]));
  return new THREE.BoxGeometry(...dims).applyMatrix4(basis(bandT(a), bandR(a), Z, p));
}

export const hoop: Builder = (p) => {
  const prof = HOOP_PROFILES[p.profile] ?? "round";
  const { radial, depth } = hoopSection(prof, p.thickness);
  const rc = Math.max(p.diameter / 2 - radial / 2, radial * 0.9);
  const closure = p.closure;
  const out: Items = [];
  const section = prof === "twisted" ? twistSection(radial, depth, closure === 2 ? rc * TAU : 0) : (() => {
    const s = bandSection(prof, radial, depth);
    return () => s;
  })();
  const top = Math.PI / 2;
  const step = prof === "twisted" ? radial * 0.11 : Math.min(radial * 0.3, (rc * TAU) / 160);

  if (closure === 2) {
    clickBand(out, rc, radial, depth, section, Math.min(0.0045 / rc, 0.6));
  } else {
    const hinged = closure === 0;
    const gap = hinged ? clamp(radial * 0.9, 0.0012, 0.0035) : 0.0007;
    const gA = gap / 2 / rc;
    const a0 = top + gA, a1 = top - gA + TAU;
    // Endless hoops taper from the bottom toward the top, where the wire end slips into the tube.
    const taper = (a: number) => (hinged ? 1 : 0.58 + 0.42 * ((1 - Math.cos(a - top)) / 2) ** 0.8);
    const b = (Math.min(radial, depth) * 0.16) / rc;
    const samples: Sample[] = [
      { a: a0, s: taper(a0) * 0.84 }, { a: a0 + b * 0.35, s: taper(a0) * 0.965 },
      ...spaced(a0 + b, a1 - b, rc, step, 128).map((a) => ({ a, s: taper(a) })),
      { a: a1 - b * 0.35, s: taper(a1) * 0.965 }, { a: a1, s: taper(a1) * 0.84 },
    ];
    put(out, band(rc, samples, section, false), "main", 0.62);
    if (hinged) {
      // Snap post: a wire hinged in a slot on the left end, spanning the gap into the right end.
      const pw = clamp(radial * 0.16, 0.0003, 0.00055);
      const slotW = Math.min(depth * 0.62, radial * 0.9);
      put(out, bandBox(rc, a0, [0.0004, pw * 2.8, slotW], [0.00018, 0, 0]), DARK, 0.3);
      const hinge = bandPt(rc, a0 + 0.0003 / rc);
      put(out, new THREE.CylinderGeometry(pw * 1.25, pw * 1.25, slotW * 0.96, 16).rotateX(Math.PI / 2).translate(hinge.x, hinge.y, hinge.z), "main", 0.7);
      const tipAt = bandPt(rc, a1 - 0.0007 / rc);
      put(out, aimed([[0, 0], [pw, 0.004], [pw, 0.86], [pw * 0.72, 0.89], [pw, 0.92], [pw * 0.9, 0.985], [pw * 0.4, 1], [0, 1]], hinge, tipAt), "main", 0.75);
      // Right end: the hole the post snaps into, and the notch cut toward the outer edge.
      const holeAt = bandPt(rc, a1).add(bandT(a1).multiplyScalar(0.00003));
      put(out, new THREE.CylinderGeometry(pw * 1.35, pw * 1.35, 0.0001, 18).applyMatrix4(basis(bandR(a1), bandT(a1), Z, holeAt)), DARK, 0.3);
      put(out, bandBox(rc, a1, [0.0005, radial * 0.5, pw * 1.5], [-0.00022, radial * 0.27, 0]), DARK, 0.3);
    } else {
      // Endless: the thin wire end leaves the right end and slides into the left end's bore.
      const rw = (Math.min(radial, depth) / 2) * taper(a1) * 0.42;
      const pts: V[] = [];
      for (let i = 0; i <= 10; i++) pts.push(bandPt(rc, a1 - 0.0004 / rc + ((gap + 0.001) / rc) * (i / 10)));
      put(out, tube(new THREE.CatmullRomCurve3(pts), 16, rw, 12), "main", 0.7);
      const holeAt = bandPt(rc, a0).add(bandT(a0).multiplyScalar(-0.00003));
      put(out, new THREE.CylinderGeometry(rw * 1.3, rw * 1.3, 0.0001, 16).applyMatrix4(basis(bandR(a0), bandT(a0), Z, holeAt)), DARK, 0.3);
    }
  }
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Pavé ----------

/** One pavé seat: a small brilliant with its table along `n`, plus two metal beads on its flanks. */
function paveRow(out: Items, centers: { p: V; t: V; n: V }[], d: number, stone: MatRef, metal: MatRef, closed = false): void {
  const base = d < 0.0018 ? singleCut(d / 2) : brilliant(ROUND, d / 2);
  const bead = d < 0.0018 ? new THREE.SphereGeometry(d * 0.17, 6, 4) : new THREE.SphereGeometry(d * 0.17, 8, 6);
  const stones: THREE.BufferGeometry[] = [];
  const beads: THREE.BufferGeometry[] = [];
  centers.forEach(({ p, t, n }, i) => {
    const w = n.clone().cross(t).normalize();
    const tt = w.clone().cross(n).normalize();
    const spin = new THREE.Matrix4().makeRotationZ(i * 0.37);
    stones.push(base.clone().applyMatrix4(spin).applyMatrix4(basis(tt, w, n, p.clone().addScaledVector(n, -d * 0.04))));
    // Very long rows skip the beads to stay within budget (they are sub-pixel at that zoom anyway).
    if ((i < centers.length - 1 || (closed && centers.length > 2)) && centers.length < 300) {
      const q = p.clone().lerp(centers[(i + 1) % centers.length].p, 0.5).addScaledVector(n, d * 0.06);
      for (const s of [-1, 1]) beads.push(bead.clone().translate(q.x + w.x * s * d * 0.42, q.y + w.y * s * d * 0.42, q.z + w.z * s * d * 0.42).toNonIndexed());
    }
  });
  base.dispose();
  bead.dispose();
  if (stones.length) put(out, mergeGeometries(stones, false)!, stone);
  if (beads.length) put(out, mergeGeometries(beads, false)!, metal);
}

// ---------- Huggie ----------

export const huggie: Builder = (p) => {
  const t = p.thickness, depth = huggieDepth(t);
  const rc = Math.max(p.diameter / 2 - t / 2, t * 0.85);
  const out: Items = [];
  const sec: V2[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU, c = Math.cos(a), s = Math.sin(a);
    // Rounded square band, its front (+Z) face gently domed.
    const x = (depth / 2) * Math.sign(c) * Math.abs(c) ** (2 / 3.4);
    sec.push([x > 0 ? x * (1 + 0.04 * (1 - Math.abs(s))) : x, (t / 2) * Math.sign(s) * Math.abs(s) ** (2 / 3.4)]);
  }
  const seam = clamp(0.0034 / rc, 0.3, 0.75);
  clickBand(out, rc, t, depth, () => sec, seam);
  if (p.pave === 1) {
    const d = t * 0.56, pitch = d * 1.16;
    const top = Math.PI / 2;
    const s0 = top + seam + (d * 0.9) / rc, s1 = top - seam - (d * 0.9) / rc + TAU;
    const n = Math.max(1, Math.floor(((s1 - s0) * rc) / pitch));
    const centers: { p: V; t: V; n: V }[] = [];
    for (let i = 0; i <= n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      centers.push({ p: bandPt(rc, a, depth / 2), t: bandT(a), n: Z.clone() });
    }
    paveRow(out, centers, d, STONE[p.stone] ?? STONE[0], "main");
  }
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Charm shapes ----------

/** Puffy slab: polar outline r(θ) (meters), front and back heights over ρ (0 center .. 1 rim), rounded rim. */
function slab(rAt: (th: number) => number, front: (rho: number, th: number) => number, back: (rho: number, th: number) => number, n = 96, nr = 12): THREE.BufferGeometry {
  const P = (rho: number, th: number, z: number) => v3(Math.cos(th) * rAt(th) * rho, Math.sin(th) * rAt(th) * rho, z);
  const ths = Array.from({ length: n }, (_, i) => (i / n) * TAU);
  const rings: V[][] = [];
  for (let i = 1; i <= nr; i++) {
    const rho = Math.sin(((i / nr) * Math.PI) / 2);
    rings.push(ths.map((th) => P(rho, th, front(rho, th))));
  }
  const nrm = ths.map((th) => {
    const a = P(1, th - 0.002, 0), b = P(1, th + 0.002, 0);
    const t = b.sub(a);
    return v3(t.y, -t.x, 0).normalize();
  });
  for (let k = 1; k <= 5; k++) {
    const beta = Math.PI / 2 - (k * Math.PI) / 6;
    rings.push(ths.map((th, i) => {
      const f = front(1, th), b = back(1, th), mid = (f + b) / 2, half = (f - b) / 2;
      return P(1, th, mid + half * Math.sin(beta)).addScaledVector(nrm[i], half * 0.85 * Math.cos(beta));
    }));
  }
  for (let i = nr; i >= 1; i--) {
    const rho = Math.sin(((i / nr) * Math.PI) / 2);
    rings.push(ths.map((th) => P(rho, th, back(rho, th))));
  }
  return loft(rings, { capStart: true, capEnd: true });
}

/** Faceted star: ridges run from the raised center to each tip. */
function facetStar(R: number, ri: number, z0: number, hTip: number, hIn: number, hApex: number, pts = 5): THREE.BufferGeometry {
  const ang = (k: number) => Math.PI / 2 + (k * TAU) / (pts * 2);
  const top: V[] = [], bot: V[] = [];
  for (let k = 0; k < pts * 2; k++) {
    const r = k % 2 ? ri : R;
    top.push(v3(Math.cos(ang(k)) * r, Math.sin(ang(k)) * r, z0 + (k % 2 ? hIn : hTip)));
    bot.push(v3(Math.cos(ang(k)) * r, Math.sin(ang(k)) * r, z0));
  }
  const apex = v3(0, 0, z0 + hApex), bc = v3(0, 0, z0);
  const tris: V[][] = [];
  for (let k = 0; k < pts * 2; k++) {
    const k1 = (k + 1) % (pts * 2);
    tris.push([apex, top[k], top[k1]], [top[k], bot[k], bot[k1]], [top[k], bot[k1], top[k1]], [bc, bot[k1], bot[k]]);
  }
  return facetGeo(tris, v3(0, 0, z0 + hApex * 0.35));
}

const FLOWER_R = (R: number) => (th: number) => R * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * (th - Math.PI / 2))) ** 0.8);

/** Scallop shell fan (unit half-width): narrow hinge at the top, straight sides, scalloped round bottom. */
const SHELL_HINGE = 0.62;
const SHELL_PTS: V2[] = (() => {
  const pts: V2[] = [[-0.2, SHELL_HINGE], [0.2, SHELL_HINGE], [0.62, 0.22], [0.9, -0.08]];
  for (let i = 0; i <= 64; i++) {
    const a = (-12 - (156 * i) / 64) * D2R;
    const wave = 1 + 0.03 * Math.cos(i * Math.PI * 0.5) ** 2;
    pts.push([Math.cos(a) * 0.95 * wave, -0.15 + Math.sin(a) * 0.86 * wave]);
  }
  pts.push([-0.9, -0.08], [-0.62, 0.22]);
  return pts;
})();
const shellR = polarOf(SHELL_PTS);

/** Block capital strokes on a 0.72 x 1 grid (curves as arcs). */
const arcP = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): V2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * D2R;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as V2;
  });
const LETTER: Record<string, V2[][]> = {
  a: [[[0, 0], [0.36, 1], [0.72, 0]], [[0.15, 0.36], [0.57, 0.36]]],
  b: [[[0, 0], [0, 1], [0.36, 1], ...arcP(0.36, 0.765, 0.25, 0.235, 90, -90), [0, 0.53]], [[0, 0.53], [0.4, 0.53], ...arcP(0.4, 0.265, 0.28, 0.265, 90, -90), [0, 0]]],
  c: [arcP(0.4, 0.5, 0.36, 0.5, 45, 315, 20)],
  d: [[[0, 0], [0, 1], [0.26, 1], ...arcP(0.26, 0.5, 0.46, 0.5, 90, -90, 16), [0, 0]]],
  e: [[[0.68, 1], [0, 1], [0, 0], [0.68, 0]], [[0, 0.52], [0.54, 0.52]]],
  f: [[[0.68, 1], [0, 1], [0, 0]], [[0, 0.52], [0.54, 0.52]]],
  g: [[...arcP(0.4, 0.5, 0.36, 0.5, 45, 360, 20), [0.76, 0.44], [0.44, 0.44]]],
  h: [[[0, 0], [0, 1]], [[0.72, 0], [0.72, 1]], [[0, 0.52], [0.72, 0.52]]],
  i: [[[0.36, 0], [0.36, 1]], [[0.12, 1], [0.6, 1]], [[0.12, 0], [0.6, 0]]],
  j: [[[0.62, 1], [0.62, 0.3], ...arcP(0.36, 0.3, 0.26, 0.3, 0, -180)]],
  k: [[[0, 0], [0, 1]], [[0.68, 1], [0, 0.38]], [[0.24, 0.58], [0.72, 0]]],
  l: [[[0, 1], [0, 0], [0.66, 0]]],
  m: [[[0, 0], [0, 1], [0.36, 0.4], [0.72, 1], [0.72, 0]]],
  n: [[[0, 0], [0, 1], [0.72, 0], [0.72, 1]]],
  o: [arcP(0.36, 0.5, 0.36, 0.5, 0, 360, 28)],
  p: [[[0, 0], [0, 1], [0.38, 1], ...arcP(0.38, 0.74, 0.28, 0.26, 90, -90), [0, 0.48]]],
  q: [arcP(0.36, 0.5, 0.36, 0.5, 0, 360, 28), [[0.44, 0.24], [0.78, -0.06]]],
  r: [[[0, 0], [0, 1], [0.38, 1], ...arcP(0.38, 0.74, 0.28, 0.26, 90, -90), [0, 0.48]], [[0.3, 0.48], [0.72, 0]]],
  s: [[...arcP(0.36, 0.75, 0.32, 0.25, 15, 270, 14), ...arcP(0.36, 0.25, 0.34, 0.25, 90, -165, 14).slice(1)]],
  t: [[[0, 1], [0.72, 1]], [[0.36, 1], [0.36, 0]]],
  u: [[[0, 1], [0, 0.34], ...arcP(0.36, 0.34, 0.36, 0.34, 180, 360), [0.72, 1]]],
  v: [[[0, 1], [0.36, 0], [0.72, 1]]],
  w: [[[0, 1], [0.18, 0], [0.36, 0.62], [0.54, 0], [0.72, 1]]],
  x: [[[0, 1], [0.72, 0]], [[0.72, 1], [0, 0]]],
  y: [[[0, 1], [0.36, 0.5], [0.72, 1]], [[0.36, 0.5], [0.36, 0]]],
  z: [[[0, 1], [0.72, 1], [0, 0], [0.72, 0]]],
};
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

interface CharmMats {
  metal: MatRef;
  stone: MatRef;
  pearl: MatRef;
}

/** Soldered loop dims for a charm of this size: inner radius and wire radius. */
const charmLoop = (size: number) => ({ rl: clamp(size * 0.075, 0.00055, 0.0016), wl: clamp(size * 0.032, 0.00022, 0.0006) });

/**
 * A charm hanging from its soldered loop, whose center is the origin; the body hangs below (-Y),
 * face +Z. Returns the lowest y.
 */
function charmBody(kind: string, size: number, out: Items, m: CharmMats, letter = 0): number {
  const { rl, wl } = charmLoop(size);
  const th = clamp(size * 0.12, 0.0006, 0.003);
  const R = size / 2;
  const loopAt = (y = 0) => put(out, ring(rl, wl, "z", v3(0, y, 0), 10, 36), m.metal, 0.7);
  const add = (g: THREE.BufferGeometry, x: number, y: number, mat: MatRef = m.metal, crease = 0.9) => put(out, g.translate(x, y, 0), mat, crease);
  switch (kind) {
    case "heart": {
      const cy = -(rl + wl * 0.4) - HEART_CLEFT * R;
      add(slab((t) => heartR(t) * R, (rho) => th * 0.3 + th * 0.85 * Math.sqrt(Math.max(0, 1 - rho * rho)), () => -th * 0.35), 0, cy);
      loopAt();
      return cy - HEART_HALF_Y * R * 1.02;
    }
    case "star": {
      const cy = -(rl + wl) - R * 0.88;
      add(facetStar(R, R * 0.46, -th * 0.45, th * 0.72, th * 0.9, th * 1.9), 0, cy, m.metal, 0.05);
      loopAt();
      return cy - R * 0.85;
    }
    case "moon": {
      const outer = R, inner = R * 0.8, ox = R * 0.44, oy = R * 0.12;
      const pts: V2[] = [], ids: number[] = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * TAU;
        const x = Math.cos(a) * outer, y = Math.sin(a) * outer;
        if (Math.hypot(x - ox, y - oy) > inner) pts.push([x, y]), ids.push(i);
      }
      // Rotate the outer run so it is contiguous, then return along the inner arc.
      let cut = 0;
      for (let i = 1; i < ids.length; i++) if (ids[i] - ids[i - 1] > 1) cut = i;
      const run = [...pts.slice(cut), ...pts.slice(0, cut)];
      const end = run[run.length - 1], start = run[0];
      const a0 = Math.atan2(end[1] - oy, end[0] - ox), a1 = Math.atan2(start[1] - oy, start[0] - ox);
      let da = a1 - a0;
      while (da > 0) da -= TAU;
      for (let i = 1; i < 40; i++) {
        const a = a0 + (da * i) / 40;
        run.push([ox + Math.cos(a) * inner, oy + Math.sin(a) * inner]);
      }
      const cy = -(rl + wl * 0.5) - outer;
      add(extrude(polyShape(run), th * 1.3, th * 0.55, { z0: -th * 0.65, bevelSegs: 5 }), 0, cy, m.metal, 0.6);
      loopAt();
      return cy - outer;
    }
    case "disc": {
      const cy = -(rl + wl * 0.5) - R;
      add(slab(() => R, (rho) => th * 0.38 + th * 0.42 * (1 - rho * rho), () => -th * 0.42), 0, cy);
      loopAt();
      return cy - R;
    }
    case "initial": {
      const H = size * 1.1, sw = H * 0.15, dz = th * 1.1;
      const strokes = LETTER[LETTERS[letter] ?? "a"] ?? LETTER.a;
      let topX = 0.36, best = Infinity;
      for (const s of strokes) {
        for (const [x, y] of s) {
          if (y > 0.98 && Math.abs(x - 0.36) < best) {
            best = Math.abs(x - 0.36);
            topX = x;
          }
        }
      }
      const ox = -topX * H, oy = -(rl + wl * 0.2) - H + sw * 0.25;
      for (const s of strokes) {
        const closed = s.length > 20 && Math.hypot(s[0][0] - s[s.length - 1][0], s[0][1] - s[s.length - 1][1]) < 1e-6;
        const pts = closed ? s.slice(0, -1) : chaikin(s, 2, false);
        const path = pts.map(([x, y]) => v3(ox + x * H, oy + y * H, 0));
        put(out, sweep(path, rrectProfile(dz, sw, Math.min(dz, sw) * 0.3, 3), v3(0, 0, 1), { closed }), m.metal, 0.8);
      }
      loopAt();
      return oy - sw / 2;
    }
    case "shell": {
      const cy = -(rl + wl * 0.4) - shellR(Math.PI / 2) * R;
      const hingeY = SHELL_HINGE;
      const front = (rho: number, t: number) => {
        // Ribs fan out from the hinge at the top; the shell bulges most just below it.
        const x = Math.cos(t) * shellR(t) * rho, y = Math.sin(t) * shellR(t) * rho;
        const fan = Math.atan2(x, hingeY - y);
        const d = Math.hypot(x, hingeY - y);
        const ribs = 0.5 * th * Math.abs(Math.cos(12 * fan)) ** 0.6 * Math.min(1, d * 1.8) * Math.min(1, (1 - rho) * 6 + 0.25) * Math.min(1, rho * 2.2);
        return th * 0.3 + th * 0.6 * Math.sqrt(Math.max(0, 1 - rho * rho)) + ribs;
      };
      add(slab((t) => shellR(t) * R, front, () => -th * 0.35, 144, 14), 0, cy, m.metal, 0.75);
      // The two ears beside the hinge.
      for (const sx of [-1, 1]) {
        const ear = polyShape(chaikin([[0.06, 0], [0.42, 0.02], [0.4, 0.17], [0.08, 0.2]].map(([x, y]) => [sx * x * R, (y + SHELL_HINGE - 0.12) * R] as V2), 2));
        add(extrude(ear, th * 0.75, th * 0.2, { z0: -th * 0.35 }), 0, cy, m.metal, 0.7);
      }
      loopAt();
      return cy - shellR(-Math.PI / 2) * R;
    }
    case "flower": {
      const cy = -(rl + wl * 0.5) - R;
      const fr = FLOWER_R(R);
      add(slab(fr, (rho, t) => th * 0.25 + th * 0.65 * Math.sqrt(Math.max(0, 1 - rho * rho)) * (0.8 + 0.2 * Math.abs(Math.cos(2.5 * (t - Math.PI / 2)))), () => -th * 0.35, 150, 12), 0, cy, m.metal, 0.8);
      add(new THREE.SphereGeometry(R * 0.2, 24, 16).scale(1, 1, 0.75).translate(0, 0, th * 0.8), 0, cy, m.metal);
      loopAt();
      return cy - R;
    }
    case "pearl": {
      // Head pin loop, bell cap, pearl.
      const r = size / 2;
      const capH = r * 0.32;
      const capTop = -(rl + wl);
      put(out, latheDown([[0, 0], [r * 0.12, 0], [r * 0.16, -capH * 0.35], [r * 0.38, -capH * 0.85], [r * 0.46, -capH], [r * 0.4, -capH * 1.02], [0, -capH * 0.9]], 36).translate(0, capTop, 0), m.metal, 0.8);
      put(out, new THREE.CylinderGeometry(wl, wl, rl * 0.9, 10).translate(0, capTop + rl * 0.2, 0), m.metal);
      loopAt();
      const pc = capTop - capH * 0.6 - r;
      put(out, pearlGeo(r, 0).translate(0, pc, 0), m.pearl);
      return pc - r;
    }
    case "gem": {
      const o = PEAR, Rs = size / (2 * longHalf(o));
      const items: Items = [];
      const zg = gemSeatZ(Rs * 2);
      bezelSet(items, o, Rs, zg, m.metal);
      put(items, brilliant(o, Rs).translate(0, 0, zg), m.stone);
      const tipY = (o.c[1] + o.r(Math.PI / 2)) * Rs * 1.15;
      moveItems(items, T4(0, -(rl + wl * 0.4) - tipY, -zg * 0.55));
      out.push(...items);
      loopAt();
      return -(rl + wl * 0.4) - tipY + (o.c[1] - 1) * Rs * 1.15;
    }
    case "teardrop": {
      const o = PEAR, Rs = size / (2 * longHalf(o));
      const tip = (o.c[1] + o.r(Math.PI / 2)) * Rs;
      const cy = -(rl + wl * 0.4) - tip;
      add(slab((t) => o.r(t) * Rs, (rho) => th * 0.35 + th * 0.9 * Math.sqrt(Math.max(0, 1 - rho * rho)), () => -th * 0.45).translate(0, o.c[1] * Rs, 0), 0, cy);
      loopAt();
      return cy + (o.c[1] - 1) * Rs;
    }
    case "tassel": {
      // Bell cap with the loop on top, then fine ball-chain strands fanning slightly out.
      const capH = size * 0.34, rb = size * 0.17;
      const capTop = -(rl + wl);
      put(out, latheDown([[0, 0], [rb * 0.3, 0], [rb * 0.42, -capH * 0.3], [rb * 0.78, -capH * 0.72], [rb, -capH * 0.97], [rb * 0.92, -capH], [0, -capH * 0.95]], 40).translate(0, capTop, 0), m.metal, 0.8);
      loopAt();
      const len = size * 1.7;
      const bead = new THREE.SphereGeometry(0.00032, 7, 5);
      const beads: THREE.BufferGeometry[] = [];
      let low = 0;
      for (let k = 0; k < 18; k++) {
        const inner = k >= 11, a = (k / (inner ? 7 : 11)) * TAU + (inner ? 0.3 : 0);
        const r0 = rb * (inner ? 0.45 : 0.82);
        const L = len * (0.92 + 0.08 * Math.sin(k * 2.3));
        const start = v3(Math.cos(a) * r0, capTop - capH * 0.92, Math.sin(a) * r0);
        const dir = v3(Math.cos(a) * 0.1, -1, Math.sin(a) * 0.1).normalize();
        for (let s = 0; s < L; s += 0.00078) {
          const q = start.clone().addScaledVector(dir, s);
          beads.push(bead.clone().translate(q.x, q.y, q.z).toNonIndexed());
          low = Math.min(low, q.y);
        }
      }
      bead.dispose();
      put(out, mergeGeometries(beads, false)!, m.metal);
      return low;
    }
  }
  return -size;
}

// ---------- Pearl ----------

/** Pearl bead: 0 round, 1 baroque (lumpy, elongated), 2 teardrop (point +Y). */
function pearlGeo(r: number, shape: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 48, 32);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (shape === 1) {
      const f = 1 + 0.07 * Math.sin(2.7 * x + 1.3) * Math.cos(2.1 * y - 0.4) + 0.05 * Math.sin(3.3 * z + 2 * y) + 0.03 * Math.cos(5 * x - 3 * z);
      x *= f;
      z *= f;
      y *= f * 1.14;
    } else if (shape === 2 && y > 0) {
      const k = 1 - 0.42 * y ** 1.4;
      x *= k;
      z *= k;
      y *= 1.28;
    }
    pos.setXYZ(i, x * r, y * r, z * r);
  }
  const s = smoothNormals(g);
  g.dispose();
  return s;
}

export const pearl: Builder = (p) => {
  const r = p.size / 2, metal = METAL[p.metal] ?? METAL[0];
  const out: Items = [];
  if (p.mount === 1) {
    charmBodyPearl(out, p.size, p.shape, metal);
  } else {
    // Cup mount: pearl sitting on a shallow cup, peg into the surface.
    const zc = r + 0.0004;
    put(out, pearlGeo(r, p.shape).rotateX(-Math.PI / 2).translate(0, 0, zc), "main");
    put(out, latheZ([[0, 0], [0.0007, 0], [r * 0.42, 0.00038], [r * 0.46, 0.00075], [r * 0.4, 0.0009], [0, 0.0009]], 40), metal, 0.8);
  }
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

/** Hanging pearl: loop at the origin (a host wire passes through), bell cap, pearl in the part material. */
function charmBodyPearl(out: Items, size: number, shape: number, metal: MatRef): void {
  const { rl, wl } = charmLoop(size);
  const r = size / 2, capH = r * 0.32;
  const lc = -rl * 0.55;
  put(out, ring(rl, wl, "z", v3(0, lc, 0), 10, 36), metal, 0.7);
  const capTop = lc - rl - wl;
  put(out, latheDown([[0, 0], [r * 0.12, 0], [r * 0.16, -capH * 0.35], [r * 0.38, -capH * 0.85], [r * 0.46, -capH], [r * 0.4, -capH * 1.02], [0, -capH * 0.9]], 36).translate(0, capTop, 0), metal, 0.8);
  put(out, new THREE.CylinderGeometry(wl, wl, rl * 0.9, 10).translate(0, capTop + rl * 0.2, 0), metal);
  const pc = capTop - capH * 0.6 - r * (shape === 2 ? 1.2 : 1);
  put(out, pearlGeo(r, shape).translate(0, pc, 0), "main");
}

// ---------- Stud ----------

/** Butterfly back on the post axis, its clutch plate `d` behind the origin, scrolls toward the lobe. */
function butterfly(out: Items, mat: MatRef, d: number): void {
  const zp = -d - 0.0017;
  const pts: V2[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU, c = Math.cos(a), s = Math.sin(a);
    pts.push([0.0029 * c, 0.0023 * s * (0.66 + 0.34 * Math.abs(c) ** 0.6)]);
  }
  put(out, extrude(polyShape(pts), 0.00034, 0.00013, { z0: zp, bevelSegs: 2, curveSegs: 4 }), mat, 0.8);
  put(out, latheZ([[0.00042, zp - 0.0002], [0.00075, zp - 0.0002], [0.00075, zp + 0.0011], [0.00042, zp + 0.0011]], 28), mat, 0.8);
  for (const sx of [-1, 1]) {
    const ctl: V[] = [[0.0021, 0.00034], [0.0028, 0.0006], [0.00295, 0.00115], [0.0024, 0.00158], [0.0014, 0.00165], [0.0006, 0.00128]].map(([x, z]) => v3(sx * x, 0, zp + z));
    const path = new THREE.CatmullRomCurve3(ctl, false, "centripetal").getSpacedPoints(30);
    put(out, sweep(path, rrectProfile(0.0024, 0.0003, 0.00012, 3), v3(0, 1, 0)), mat, 0.8);
  }
}

/** Earring post along -Z with a rounded tip and the groove a back clicks into. */
function post(out: Items, mat: MatRef, zTop: number): void {
  put(out, latheZ([[0, -0.0106], [0.0003, -0.01055], [0.0004, -0.0102], [0.0004, -0.0087], [0.0003, -0.0085], [0.0004, -0.0083], [0.0004, zTop], [0, zTop]], 20), mat, 0.8);
}

const STUD_HEADS = ["ball", "gem", "pearl", "heart", "star", "flower", "bezel_gem", "prong_setting", "bezel_setting"];

export const stud: Builder = (p) => {
  const s = p.size, R = s / 2;
  const head = STUD_HEADS[p.head] ?? "ball";
  const out: Items = [];
  const stone = STONE[p.stone] ?? STONE[0];
  post(out, "main", 0.0006);
  if (p.back === 0) butterfly(out, "main", 0.0062);
  const zg = gemSeatZ(s);
  switch (head) {
    case "ball":
      put(out, new THREE.SphereGeometry(R, 48, 32).translate(0, 0, R + 0.0001), "main");
      put(out, latheZ([[0, 0], [R * 0.36, 0], [R * 0.3, R * 0.25], [0, R * 0.3]], 32), "main", 0.7);
      break;
    case "pearl":
      put(out, pearlGeo(R, 0).translate(0, 0, R + 0.0006), PEARL);
      put(out, latheZ([[0, 0], [0.0007, 0], [R * 0.42, 0.00045], [R * 0.47, 0.0008], [R * 0.41, 0.00095], [0, 0.00095]], 40), "main", 0.8);
      break;
    case "heart": {
      const th = s * 0.3;
      put(out, slab((t) => heartR(t) * R, (rho) => 0.0003 + th * 0.35 + th * 0.65 * Math.sqrt(Math.max(0, 1 - rho * rho)), () => 0.0003), "main", 0.9);
      break;
    }
    case "star":
      put(out, facetStar(R, R * 0.46, 0.0003, s * 0.08, s * 0.1, s * 0.3), "main", 0.05);
      break;
    case "flower": {
      const th = s * 0.22;
      put(out, slab(FLOWER_R(R), (rho, t) => 0.0003 + th * 0.3 + th * 0.7 * Math.sqrt(Math.max(0, 1 - rho * rho)) * (0.8 + 0.2 * Math.abs(Math.cos(2.5 * (t - Math.PI / 2)))), () => 0.0003, 150, 12), "main", 0.8);
      put(out, new THREE.SphereGeometry(R * 0.22, 24, 16).scale(1, 1, 0.8).translate(0, 0, 0.0003 + th * 1.02), "main");
      break;
    }
    case "gem":
    case "prong_setting":
      prongSet(out, ROUND, R, zg, "main", true);
      if (head === "gem") put(out, brilliant(ROUND, R).translate(0, 0, zg), stone);
      break;
    case "bezel_gem":
    case "bezel_setting":
      bezelSet(out, ROUND, R, zg, "main");
      if (head === "bezel_gem") put(out, brilliant(ROUND, R).translate(0, 0, zg), stone);
      break;
  }
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

export const earBack: Builder = (p) => {
  const out: Items = [];
  butterfly(out, "main", p.depth);
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Gem ----------

export const gem: Builder = (p) => {
  const cut = Math.round(p.cut), o = OUTLINES[cut] ?? ROUND;
  const R = p.size / (2 * longHalf(o));
  const metal = METAL[p.metal] ?? METAL[0];
  const out: Items = [];
  const zg = p.setting === 2 ? 0 : gemSeatZ(R * 2);
  put(out, stoneGeo(cut, R).translate(0, 0, zg), "main");
  if (p.setting === 0) prongSet(out, o, R, zg, metal);
  else if (p.setting === 1) bezelSet(out, o, R, zg, metal);
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Paths ----------

interface PathSampler {
  len: number;
  closed: boolean;
  point(s: number): V;
  normal(s: number): V;
  /** Direction of the chord across [s - h, s + h]: links sit on chords, not tangents. */
  chord(s: number, h: number): V;
}

function sampler(path: KitPath | undefined): PathSampler {
  const raw = path && path.points.length >= 2 ? path.points : [[-0.05, 0, 0], [0.05, 0, 0]] as [number, number, number][];
  const pts = raw.map(([x, y, z]) => v3(x, y, z));
  const closed = pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6;
  const ctl = closed ? pts.slice(0, -1) : pts;
  const curve = new THREE.CatmullRomCurve3(ctl, closed, "centripetal");
  curve.arcLengthDivisions = Math.max(400, ctl.length * 24);
  const len = curve.getLength();
  const ns = (path?.normals?.length === raw.length ? path.normals : raw.map(() => [0, 0, 1] as [number, number, number])).map(([x, y, z]) => v3(x, y, z).normalize());
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const polyLen = cum[cum.length - 1] || 1;
  const wrap = (s: number) => (closed ? ((s % len) + len) % len : clamp(s, 0, len));
  return {
    len,
    closed,
    point: (s) => curve.getPointAt(wrap(s) / len),
    normal: (s) => {
      const want = (wrap(s) / len) * polyLen;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < want) i++;
      const k = clamp((want - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]), 0, 1);
      return ns[i - 1].clone().lerp(ns[i], k).normalize();
    },
    chord(s, h) {
      const a = closed ? s - h : Math.max(0, s - h), b = closed ? s + h : Math.min(len, s + h);
      const d = this.point(b).sub(this.point(a));
      return d.lengthSq() > 1e-16 ? d.normalize() : curve.getTangentAt(wrap(s) / len);
    },
  };
}

/** Link-placement frame on a path: T along the chord, N the surface normal made perpendicular, W = N x T. */
function pathFrame(S: PathSampler, s: number, h: number): { p: V; t: V; n: V; w: V } {
  const t = S.chord(s, h);
  let n = S.normal(s);
  n = n.addScaledVector(t, -n.dot(t));
  if (n.lengthSq() < 1e-10) n = Math.abs(t.z) < 0.9 ? v3(0, 0, 1).addScaledVector(t, -t.z) : v3(0, 1, 0).addScaledVector(t, -t.y);
  n.normalize();
  return { p: S.point(s), t, n, w: n.clone().cross(t).normalize() };
}

export const pave: Builder = (p, path) => {
  const S = sampler(path);
  const d = p.stone, pitch = d * 1.16;
  const n = Math.max(1, Math.floor(S.len / pitch) + (S.closed ? 0 : 1));
  const step = S.closed ? S.len / n : pitch;
  const s0 = S.closed ? 0 : (S.len - (n - 1) * pitch) / 2;
  const centers: { p: V; t: V; n: V }[] = [];
  for (let i = 0; i < n; i++) {
    const f = pathFrame(S, s0 + i * step, pitch / 2);
    centers.push({ p: f.p, t: f.t, n: f.n });
  }
  const out: Items = [];
  paveRow(out, centers, d, "main", METAL[p.metal] ?? METAL[0], S.closed);
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

/** One chain link: a closed wire loop in the XY plane, long axis X, centered on the origin (non-indexed). */
function linkLoop(len: number, wid: number, dw: number, o: { radial: number; segs: number; flat?: number; square?: boolean }): THREE.BufferGeometry {
  const lc = Math.max(len - dw, dw * 1.4), wc = Math.max(wid - dw, dw * 0.9);
  const shape = rrect(lc, wc, o.square ? Math.min(lc, wc) * 0.32 : wc / 2);
  const pts = shape.getSpacedPoints(o.segs).slice(0, -1).map((q) => v3(q.x, q.y, 0));
  const prof = o.square ? rrectProfile(dw * (o.flat ?? 1), dw, dw * 0.28, o.radial >= 8 ? 2 : 1) : circleProfile(dw / 2, o.radial, o.flat ?? 1, 1);
  const g = sweep(pts, prof, v3(0, 0, 1), { closed: true });
  const ni = g.toNonIndexed();
  g.dispose();
  return ni;
}

const LINKS = ["cable", "curb", "rope", "paperclip", "box", "figaro", "bead"];

export const chain: Builder = (p, path) => {
  const S = sampler(path);
  const kind = LINKS[p.link] ?? "cable";
  const L = p.size;
  const ratio: Record<string, number> = { cable: 0.17, curb: 0.24, rope: 0.2, paperclip: 0.11, box: 0.15, figaro: 0.2, bead: 0.12 };
  const dw = p.wire > 0 ? Math.min(p.wire, L * 0.4) : L * ratio[kind];
  const geos: THREE.BufferGeometry[] = [];

  if (kind === "bead") {
    // Ball chain: beads on a thin hidden wire, short bar between each pair.
    const db = L * 0.7;
    const n = Math.max(2, Math.floor(S.len / L) + (S.closed ? 0 : 1));
    const step = S.closed ? S.len / n : L;
    const s0 = S.closed ? 0 : (S.len - (n - 1) * L) / 2;
    const seg = n * 2 > 220 ? [10, 7] : [14, 10];
    const ball = new THREE.SphereGeometry(db / 2, seg[0], seg[1]).toNonIndexed();
    const bar = new THREE.CylinderGeometry(db * 0.12, db * 0.12, step, 8, 1, true).rotateZ(Math.PI / 2).toNonIndexed();
    for (let i = 0; i < n; i++) {
      const s = s0 + i * step;
      const f = pathFrame(S, s, step / 2);
      geos.push(ball.clone().translate(f.p.x, f.p.y, f.p.z));
      if (i < n - 1 || S.closed) {
        const g = pathFrame(S, s + step / 2, step / 2);
        geos.push(bar.clone().applyMatrix4(basis(g.t, g.w, g.n, g.p)));
      }
    }
    ball.dispose();
    bar.dispose();
  } else {
    // Link lengths (figaro: three short, one long) and the spacing between neighbors.
    const pattern = kind === "figaro" ? [L, L, L, L * 2.1] : [L];
    const lenOf = (i: number) => pattern[i % pattern.length];
    const gapOf = (i: number) => (kind === "rope" ? L * 0.24 : (lenOf(i) + lenOf(i + 1)) / 2 - 2 * dw);
    let n = 1, used = 0;
    while (used + gapOf(n - 1) <= S.len + 1e-9 && n < 2000) used += gapOf(n++ - 1);
    if (S.closed) {
      if (kind !== "rope" && n % 2) n--;
      n = Math.max(2, n);
    }
    let total = 0;
    for (let i = 0; i < (S.closed ? n : n - 1); i++) total += gapOf(i);
    const k = S.closed ? S.len / total : 1;
    const start = S.closed ? 0 : (S.len - total) / 2;
    // Budget: <= ~38k triangles whatever the chain length (box links have a square wire).
    const square = kind === "box";
    const res = [[36, 12], [28, 10], [22, 8], [16, 6], [12, 5], [8, 4]];
    const profN = (radial: number) => (square ? 4 * ((radial >= 8 ? 2 : 1) + 1) : radial);
    const [segs, radial] = res.find(([sg, rd]) => n * sg * profN(rd) * 2 <= 38000) ?? res[res.length - 1];
    const proto = new Map<number, THREE.BufferGeometry>();
    const protoFor = (len: number) => {
      const key = Math.round(len * 1e6);
      let g = proto.get(key);
      if (!g) {
        const specs: Record<string, { wid: number; flat: number; square: boolean }> = {
          cable: { wid: len * 0.72, flat: 1, square: false },
          curb: { wid: len * 0.8, flat: 0.62, square: false },
          rope: { wid: len * 0.6, flat: 1, square: false },
          paperclip: { wid: len * 0.36, flat: 1, square: false },
          box: { wid: len, flat: 1, square: true },
          figaro: { wid: L * 0.78, flat: 0.62, square: false },
        };
        const spec = specs[kind] ?? specs.cable;
        g = linkLoop(len, spec.wid, dw, { radial, segs, flat: spec.flat, square: spec.square });
        proto.set(key, g);
      }
      return g;
    };
    let s = start;
    for (let i = 0; i < n; i++) {
      const f = pathFrame(S, s, gapOf(i) * k * 0.5 + 1e-6);
      if (kind === "rope") {
        // Rope: links lie on a thin cylinder around the path, four per turn, each leaning 45° the
        // same way, so the front ones read as diagonal strands of a twisted rope.
        const phi = i * 90 * D2R;
        const r = f.w.clone().multiplyScalar(Math.cos(phi)).addScaledVector(f.n, Math.sin(phi));
        const c = f.t.clone().cross(r);
        const lx = f.t.clone().multiplyScalar(Math.SQRT1_2).addScaledVector(c, Math.SQRT1_2);
        const ly = r.clone().cross(lx).normalize();
        const at = f.p.clone().addScaledVector(r, L * 0.17).addScaledVector(f.n, dw * 0.5);
        geos.push(protoFor(lenOf(i)).clone().applyMatrix4(basis(lx, ly, r, at)));
        s += gapOf(i) * k;
        continue;
      }
      let a: V;
      if (kind === "curb" || kind === "figaro") {
        const r = (i % 2 ? 1 : -1) * (kind === "curb" ? 24 : 10) * D2R;
        a = f.w.clone().multiplyScalar(Math.cos(r)).addScaledVector(f.n, Math.sin(r));
      } else if (kind === "rope") {
        const r = i * 60 * D2R;
        a = f.w.clone().multiplyScalar(Math.cos(r)).addScaledVector(f.n, Math.sin(r));
      } else a = i % 2 ? f.n.clone() : f.w.clone();
      const b = f.t.clone().cross(a).normalize();
      const at = f.p.clone().addScaledVector(f.n, dw * 0.5);
      geos.push(protoFor(lenOf(i)).clone().applyMatrix4(basis(f.t, a, b, at)));
      s += gapOf(i) * k;
    }
    for (const g of proto.values()) g.dispose();
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const acc = new Acc();
  if (merged) acc.add(merged, "main");
  return acc.finish();
};

// ---------- Ear wire ----------

export const earWire: Builder = (p) => {
  const r = p.wire / 2;
  const out: Items = [];
  const mm = (y: number, z: number, x = 0) => v3(x * 0.001, y * 0.001, z * 0.001);
  const pts: V[] = [mm(-16, -6.6), mm(-12, -5.3), mm(-8, -4.2), mm(-5, -3.6)];
  for (const f of [165, 140, 115, 90, 65, 40, 18]) pts.push(mm(-3.4 + 3.4 * Math.sin(f * D2R), 3.4 * Math.cos(f * D2R)));
  pts.push(mm(-4.8, 3.3), mm(-7, 3.1), mm(-9.5, 2.95), mm(-12, 2.85), mm(-12.9, 2.8));
  // Open loop at the bottom, in the XY plane, its end tucked beside the leg.
  const lc = -14.2, lr = 1.25;
  for (let i = 1; i <= 16; i++) {
    const a = (90 + (i / 16) * 330) * D2R;
    pts.push(mm(lc + lr * Math.sin(a), 2.8 + (i / 16) * 0.75, lr * Math.cos(a)));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  put(out, tube(curve, 260, r, 10), "main", 0.7);
  for (const q of [pts[0], pts[pts.length - 1]]) put(out, new THREE.SphereGeometry(r, 12, 8).translate(q.x, q.y, q.z), "main");
  // Ball and coil on the front leg.
  const ball = mm(-6.1, 3.08);
  put(out, new THREE.SphereGeometry(0.00105, 28, 18).translate(ball.x, ball.y, ball.z), "main");
  const coil: V[] = [];
  const cr = r + 0.00024;
  for (let i = 0; i <= 140; i++) {
    const t = i / 140, a = t * 7 * TAU;
    coil.push(v3(Math.cos(a) * cr, -0.0072 - t * 0.0021, 0.003 + Math.sin(a) * cr - t * 0.0001));
  }
  put(out, tube(new THREE.CatmullRomCurve3(coil), 280, 0.00022, 6), "main", 0.7);
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Drop & charm ----------

const DROP_CHARMS = ["pearl", "gem", "disc", "heart", "star", "moon", "teardrop", "tassel"];
const CHARM_SHAPES = ["heart", "star", "moon", "disc", "initial", "shell", "flower"];

export const drop: Builder = (p) => {
  const out: Items = [];
  const rj = p.loop / 2, wj = clamp(p.loop * 0.11, 0.00022, 0.0005);
  // The host wire passes through the origin; the ring hangs with its inner top resting on it.
  const cJ = -Math.min(0.0004, rj * 0.4);
  put(out, ring(rj, wj, "x", v3(0, cJ, 0), 10, 40), "main", 0.7);
  const kind = DROP_CHARMS[p.charm] ?? "pearl";
  const cs = p.charm_size;
  const mats: CharmMats = { metal: "main", stone: STONE[p.stone] ?? STONE[0], pearl: PEARL };
  const charm: Items = [];
  const low = charmBody(kind, cs, charm, mats);
  const { rl } = charmLoop(cs);
  const Ll = clamp(cs * 0.3, 0.0016, 0.0028), dl = Ll * 0.17, pitch = Ll - 2 * dl;
  const ringBottom = cJ - rj - wj;
  const room = p.length - (-ringBottom) - (rl - low);
  let n = Math.max(0, Math.floor(room / pitch));
  n -= n % 2; // the last link must lie in the YZ plane for the charm loop (XY) to hang from it
  let elemBottom = ringBottom, wElem = wj;
  if (n) {
    const proto = linkLoop(Ll, Ll * 0.7, dl, { radial: 8, segs: 24 }).rotateZ(Math.PI / 2);
    let c = ringBottom + wj - (Ll / 2 - dl);
    for (let i = 0; i < n; i++) {
      const g = proto.clone();
      if (i % 2) g.rotateY(Math.PI / 2);
      put(out, g.translate(0, c, 0), "main");
      if (i < n - 1) c -= pitch;
    }
    proto.dispose();
    elemBottom = c - Ll / 2 + dl / 2;
    wElem = dl / 2;
  }
  out.push(...moveItems(charm, T4(0, elemBottom + wElem - rl, 0)));
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

export const charm: Builder = (p) => {
  const out: Items = [];
  const size = p.size;
  const rj = clamp(size * 0.09, 0.0008, 0.0022), wj = clamp(size * 0.03, 0.00024, 0.0006);
  const cJ = -rj * 0.6;
  put(out, ring(rj, wj, "x", v3(0, cJ, 0), 10, 40), "main", 0.7);
  const items: Items = [];
  charmBody(CHARM_SHAPES[p.shape] ?? "heart", size, items, { metal: "main", stone: STONE[0], pearl: PEARL }, Math.round(p.letter));
  const { rl } = charmLoop(size);
  out.push(...moveItems(items, T4(0, cJ - rj - wj + wj - rl, 0)));
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

// ---------- Clasp ----------

export const clasp: Builder = (p) => {
  const L = p.size;
  const out: Items = [];
  const style = p.style;
  if (style === 0) {
    // Lobster: swivel eye, neck, claw body (thick spine on the left), sprung gate and trigger on the right.
    put(out, ring(L * 0.07, L * 0.032, "z", v3(0, -L * 0.07, 0), 10, 32), "main", 0.7);
    put(out, latheDown([[L * 0.045, -L * 0.13], [L * 0.06, -L * 0.15], [L * 0.07, -L * 0.2], [L * 0.0, -L * 0.21]], 24), "main", 0.7);
    put(out, lathe([[0, -L * 0.13], [L * 0.04, -L * 0.13], [L * 0.04, -L * 0.1], [0, -L * 0.1]], 16), "main", 0.7);
    const body: V2[] = [[0.1, -0.26], [0.02, -0.22], [-0.1, -0.25], [-0.2, -0.36], [-0.25, -0.55], [-0.23, -0.74], [-0.13, -0.9], [0.02, -0.96], [0.15, -0.9], [0.22, -0.78], [0.2, -0.68], [0.12, -0.64]];
    const bp = new THREE.CatmullRomCurve3(body.map(([x, y]) => v3(x * L, y * L, 0)), false, "centripetal").getSpacedPoints(80);
    put(out, sweep(bp, circleProfile(L * 0.075, 20, 1.3, 1), v3(0, 0, 1), { scale: (t) => { const k = 0.75 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.15)); return [k, k]; } }), "main", 0.75);
    for (const q of [bp[0], bp[bp.length - 1]]) put(out, new THREE.SphereGeometry(L * 0.058, 16, 12).scale(1.3, 1, 1).translate(q.x, q.y, q.z), "main");
    const gate = new THREE.CatmullRomCurve3([v3(0.11, -0.27, 0), v3(0.15, -0.42, 0), v3(0.15, -0.55, 0), v3(0.125, -0.65, 0)].map((q) => q.multiplyScalar(L)), false).getSpacedPoints(30);
    put(out, sweep(gate, circleProfile(L * 0.034, 14, 1.4, 1), v3(0, 0, 1)), "main", 0.75);
    put(out, extrude(polyShape(chaikin([[0.12, -0.3], [0.27, -0.33], [0.29, -0.38], [0.15, -0.4]].map(([x, y]) => [x * L, y * L] as V2), 2)), L * 0.09, L * 0.02, { z0: -L * 0.045 }), "main", 0.7);
    for (let i = 0; i < 3; i++) put(out, new THREE.BoxGeometry(L * 0.012, L * 0.05, L * 0.095).translate(L * (0.2 + i * 0.03), -L * (0.345 + i * 0.008), 0), "main", 0.5);
  } else if (style === 1) {
    // Spring ring: round tube ring with a seam, a tiny trigger knob, attachment eye on top.
    const R = L * 0.33, w = L * 0.07, cy = -L * 0.14 - R;
    put(out, ring(R - w, w, "z", v3(0, cy, 0), 16, 64), "main", 0.7);
    const a = 52 * D2R;
    put(out, new THREE.BoxGeometry(L * 0.012, w * 2.1, w * 2.1).rotateZ(-a + Math.PI / 2).translate(Math.cos(a) * R, cy + Math.sin(a) * R, 0), DARK, 0.4);
    const kp = v3(Math.cos(a + 0.25) * (R + w * 1.2), cy + Math.sin(a + 0.25) * (R + w * 1.2), 0);
    put(out, new THREE.CylinderGeometry(w * 0.55, w * 0.7, w * 1.6, 14).rotateZ(-(a + 0.25) + Math.PI / 2).translate(kp.x, kp.y, kp.z), "main", 0.7);
    put(out, ring(L * 0.05, L * 0.03, "x", v3(0, -L * 0.075, 0), 10, 28), "main", 0.7);
  } else {
    // Toggle: flat ring hanging from a jump ring, the T-bar laid across it as when closed.
    const R = L * 0.42, w = L * 0.09, cy = -L * 0.16 - R;
    put(out, ring(L * 0.05, L * 0.028, "x", v3(0, -L * 0.06, 0), 10, 28), "main", 0.7);
    put(out, ring(L * 0.04, L * 0.03, "z", v3(0, -L * 0.13, 0), 10, 28), "main", 0.7);
    const pts: V[] = [];
    for (let i = 0; i < 96; i++) pts.push(v3(Math.cos((i / 96) * TAU) * (R - w / 2), cy + Math.sin((i / 96) * TAU) * (R - w / 2), 0));
    put(out, sweep(pts, rrectProfile(w * 0.8, w, w * 0.3, 4), v3(0, 0, 1), { closed: true }), "main", 0.7);
    const bl = R * 2.5, br = L * 0.05;
    put(out, new THREE.CylinderGeometry(br, br, bl, 20).rotateZ(Math.PI / 2).translate(0, cy - R * 0.1, w * 0.75), "main", 0.7);
    for (const sx of [-1, 1]) put(out, new THREE.SphereGeometry(br * 1.45, 18, 12).translate((sx * bl) / 2, cy - R * 0.1, w * 0.75), "main");
    put(out, ring(L * 0.035, L * 0.022, "x", v3(0, cy - R * 0.1 + br + L * 0.035, w * 0.75), 8, 24), "main", 0.7);
  }
  const acc = new Acc();
  flush(acc, out);
  return acc.finish();
};

export const JEWELRY_BUILDERS: Record<string, Builder> = {
  hoop,
  huggie,
  stud,
  gem,
  pearl,
  pave,
  chain,
  ear_wire: earWire,
  drop,
  charm,
  clasp,
  ear_back: earBack,
};
