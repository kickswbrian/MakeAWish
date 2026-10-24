import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: convertible satin midi dress on a dress form. The demo's hero wish: "a midi dress that
 * turns into a skirt, with pockets that fit my phone".
 *
 * Frame: the root is the A-line skirt (a lathe, waist at y = 0, hem at y = -0.72). The root carries a
 * Z scale of SZ so every revolved part reads as a body-shaped oval instead of a cylinder; children
 * live in that squashed frame (a point on a lathe stays on its surface). The bodice zips off at the
 * waistband seam (gold zipper ring at y = 0.026), leaving a skirt. Slant pockets sit on both hips.
 * The dress form (linen torso, wood neck cap, pole and tripod) is inside and below.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const geo = (type: Geometry["type"], params: Record<string, unknown>) => ({ type, params }) as unknown as Geometry;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>, scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

/** Euler XYZ (degrees) that turns a kit part's +Z to `normal` and its +Y toward `up`. */
function mount(normal: V3, up: V3): V3 {
  const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
  const n = normal.map((c) => c / len(normal)) as V3;
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  const u0 = [up[0] - d * n[0], up[1] - d * n[1], up[2] - d * n[2]] as V3;
  const u = u0.map((c) => c / len(u0)) as V3;
  const x: V3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
  const deg = (a: number) => r4((a * 180) / Math.PI);
  const m13 = Math.max(-1, Math.min(1, n[0]));
  if (Math.abs(m13) < 0.9999) return [deg(Math.atan2(-n[1], n[2])), deg(Math.asin(m13)), deg(Math.atan2(-u[0], x[0]))];
  return [deg(Math.atan2(u[2], u[1])), deg(Math.asin(m13)), 0];
}

/** Dense Catmull-Rom samples through 2D control points (ends kept). */
function smooth(ctrl: V2[], per = 4): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([r4(f(p0[0], p1[0], p2[0], p3[0])), r4(f(p0[1], p1[1], p2[1], p3[1]))]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** Radius of a [r, y] profile at height y (linear between samples). */
function radiusAt(profile: V2[], y: number): number {
  const p = [...profile].sort((a, b) => a[1] - b[1]);
  if (y <= p[0][1]) return p[0][0];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][1]) {
      const t = (y - p[i - 1][1]) / (p[i][1] - p[i - 1][1]);
      return p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
    }
  }
  return p[p.length - 1][0];
}

/** A point on a revolved surface at azimuth `deg` (0 = front, +90 = viewer's right), pushed out by `out`. */
const onSurface = (profile: V2[], y: number, deg: number, out = 0): V3 => {
  const r = radiusAt(profile, y) + out, a = (deg * Math.PI) / 180;
  return v([Math.sin(a) * r, y, Math.cos(a) * r]);
};

// Palette: emerald satin, gold hardware, linen dress form, walnut and bronze stand.
const MAIN: PartMaterial = { preset: "satin", color: "#1F8A5B" };
const THREAD: PartMaterial = { preset: "cotton", color: "#166B46" };
const GOLD: PartMaterial = { preset: "metal_polished", color: "#D2AE62" };
const LINEN: PartMaterial = { preset: "cotton", color: "#E9E0CF" };
const WOOD: PartMaterial = { preset: "wood", color: "#7A5235" };
const BRONZE: PartMaterial = { preset: "metal_brushed", color: "#6B5A48" };

const SZ = 0.76; // front-to-back squash of the whole dress (torso depth / width)

// ---- Profiles ([radius, y], bottom to top) ----
const SKIRT: V2[] = smooth([[0.322, -0.72], [0.305, -0.655], [0.274, -0.55], [0.24, -0.42], [0.206, -0.29], [0.176, -0.17], [0.148, -0.075], [0.126, -0.02], [0.117, 0.012]], 3);
const BODICE: V2[] = smooth([[0.114, 0.012], [0.118, 0.06], [0.132, 0.112], [0.152, 0.17], [0.157, 0.21], [0.152, 0.252], [0.155, 0.29], [0.147, 0.324], [0.12, 0.349], [0.082, 0.366], [0.057, 0.377]], 3);
const FORM: V2[] = [[0, -0.21], [0.11, -0.205], [0.138, -0.16], [0.13, -0.09], [0.114, -0.03], [0.109, 0.02], [0.115, 0.06], [0.129, 0.112], [0.149, 0.17], [0.154, 0.21], [0.149, 0.252], [0.152, 0.29], [0.143, 0.324], [0.116, 0.347], [0.077, 0.363], [0.052, 0.374], [0.046, 0.4], [0.045, 0.448], [0, 0.45]];
const WALL = 0.0026;
/** Closed shell: outer profile up, inner profile (inset by WALL) back down. */
const shell = (outer: V2[]): V2[] => [...outer, ...outer.slice().reverse().map(([r, y]) => [r4(r - WALL), y] as V2), outer[0]];

const ZIP_Y = 0.027;
const HEM_Y = -0.72;
const V_TIP = 0.215;

// Slant pocket opening on the hip (s = -1 left, +1 right).
const pocketPath = (s: number, out = 0.002, shift = 0): V3[] => ([[44, -0.03], [52, -0.085], [60, -0.145], [66, -0.2]] as V2[]).map(([deg, y]) => onSurface(SKIRT, y, s * (deg + shift), out));

// V-neck edge on the bodice surface, from the left shoulder slope down to the tip and back up.
const vEdge = (): V3[] => {
  const half = (y: number) => (0.075 * (y - V_TIP)) / (0.4 - V_TIP);
  const ys = [0.36, 0.33, 0.3, 0.27, 0.245, 0.228];
  const side = (s: number) => ys.map((y) => {
    const x = s * half(y), r = radiusAt(BODICE, y) + 0.0012;
    return v([x, y, Math.sqrt(Math.max(0, r * r - x * x))]);
  });
  return [...side(-1), v([0, V_TIP + 0.003, radiusAt(BODICE, V_TIP) + 0.0012]), ...side(1).reverse()];
};

// Tripod legs, in the squashed root frame (z values divided by SZ to stay round in the world).
const LEG_TOP = -0.86, FLOOR = -0.95;
const legPath = (deg: number): V3[] => {
  const a = (deg * Math.PI) / 180;
  const at = (r: number, y: number): V3 => v([Math.sin(a) * r, y, (Math.cos(a) * r) / SZ]);
  return [at(0.008, LEG_TOP), at(0.08, LEG_TOP - 0.022), at(0.18, FLOOR + 0.03), at(0.22, FLOOR + 0.012)];
};

const parts: Part[] = [
  prim("skirt", "Dress skirt", null, geo("lathe", { points: SKIRT, flutes: 13, fluteDepth: 0.075, fluteFade: "bottom" }), MAIN, [0, 0, 0], [0, 0, 0], [1, 1, SZ]),
  // Soft folds come from the skirt's own flutes (deepest at the hem, flat at the hip pockets).

  // ---- The convertible waist: waistband + a gold zipper ring where the bodice detaches ----
  prim("waistband", "Waistband", "skirt", geo("lathe", { points: [[0.112, -0.016], [0.1205, -0.016], [0.1215, -0.004], [0.1215, ZIP_Y - 0.002], [0.112, ZIP_Y - 0.002]], sharp: true }), MAIN),
  prim("waist_zipper", "Waist zipper", "skirt", geo("torus", { radius: 0.1205, tube: 0.0034 }), GOLD, [0, ZIP_Y, 0], [90, 0, 0]),
  kit("waist_zip_pull", "Waist zipper pull", "skirt", "zipper_pull", GOLD, [0.1238, ZIP_Y - 0.002, 0], [0, 90, 0]),
  prim("waist_seam", "Waist seam", "skirt", geo("torus", { radius: 0.1218, tube: 0.0022 }), MAIN, [0, -0.0165, 0], [90, 0, 0]),

  // ---- Pockets: slant openings on both hips, deep enough for a phone ----
  ...([-1, 1] as const).flatMap((s) => {
    const side = s < 0 ? "Left" : "Right", k = s < 0 ? "l" : "r";
    const path = pocketPath(s);
    return [
      prim(`pocket_${k}`, `${side} pocket`, "skirt", geo("tube", { points: path, radius: 0.0022, width: 0.016, faceNormal: [s * Math.sin((56 * Math.PI) / 180), 0, Math.cos((56 * Math.PI) / 180)] }), MAIN),
      prim(`pocket_opening_${k}`, `${side} pocket opening`, "skirt", geo("tube", { points: pocketPath(s, 0.0062, -6), radius: 0.0021 }), THREAD),
    ];
  }),

  // ---- Bodice: fitted shell with a V-neck cut, cap sleeves, darts and neckline piping ----
  prim("bodice", "Bodice", "skirt", geo("lathe", { points: shell(BODICE) }), MAIN),
  {
    ...prim("v_neck_cut", "V-neck", "bodice", geo("extrude", { shape: [[0, V_TIP], [0.075, 0.4], [0.075, 0.45], [-0.075, 0.45], [-0.075, 0.4]], depth: 0.2, bevel: 0 }), MAIN, [0, 0, 0.12]),
    csg: { op: "subtract", withPartId: "bodice" },
  },
  prim("neckline_piping", "Neckline piping", "bodice", geo("tube", { points: vEdge(), radius: 0.0028 }), MAIN),
  prim("back_neck_piping", "Back neckline", "bodice", geo("torus", { radius: 0.0565, tube: 0.0028, arc: 180 }), MAIN, [0, 0.3772, 0], [-90, 0, 0]),
  ...([-1, 1] as const).flatMap((s) => {
    const side = s < 0 ? "Left" : "Right", k = s < 0 ? "l" : "r";
    const dart = onSurface(BODICE, 0.085, s * 24, 0.0003);
    return [
      prim(`sleeve_${k}`, `${side} sleeve`, "bodice", geo("lathe", { points: smooth([[0.061, -0.085], [0.067, -0.066], [0.066, -0.04], [0.056, -0.016], [0.036, 0]], 3) }), MAIN, [s * 0.138, 0.322, 0], [0, 0, s * 34]),
      prim(`sleeve_hem_${k}`, `${side} sleeve hem`, `sleeve_${k}`, geo("torus", { radius: 0.0612, tube: 0.0026 }), MAIN, [0, -0.0848, 0], [90, 0, 0]),
      kit(`dart_${k}`, `${side} bodice dart`, "bodice", "stitching", THREAD, dart, mount([dart[0], 0, dart[2]], [0, 1, 0]).map((a, i) => (i === 2 ? a + 90 : a)) as V3, { length: 0.1 }),
    ];
  }),

  // ---- Dress form and stand ----
  prim("dress_form", "Dress form", "skirt", geo("lathe", { points: FORM }), LINEN),
  prim("neck_cap", "Neck cap", "dress_form", geo("lathe", { points: [[0, 0.445], [0.044, 0.445], [0.048, 0.452], [0.045, 0.461], [0.036, 0.466], [0, 0.467]] }), WOOD),
  prim("finial", "Finial", "dress_form", geo("sphere", { radius: 0.014 }), WOOD, [0, 0.476, 0], [0, 0, 0], [1, 1, 1 / SZ]),
  prim("stand_pole", "Stand pole", "dress_form", geo("capsule", { radius: 0.011, length: 0.66 }), BRONZE, [0, -0.535, 0], [0, 0, 0], [1, 1, 1 / SZ]),
  prim("stand_hub", "Stand hub", "dress_form", geo("lathe", { points: [[0, -0.026], [0.02, -0.026], [0.024, -0.016], [0.021, 0.006], [0.016, 0.024], [0, 0.026]] }), WOOD, [0, LEG_TOP + 0.012, 0], [0, 0, 0], [1, 1, 1 / SZ]),
  ...[0, 120, 240].flatMap((deg, i) => {
    const path = legPath(deg + 60);
    const end = path[path.length - 1];
    return [
      prim(`stand_leg_${i + 1}`, `Stand leg ${i + 1}`, "dress_form", geo("tube", { points: path, radius: 0.0085 }), WOOD),
      prim(`stand_foot_${i + 1}`, `Stand foot ${i + 1}`, "dress_form", geo("sphere", { radius: 0.013, angle: 90 }), BRONZE, [end[0], FLOOR, end[2]], [0, 0, 0], [1, 1, 1 / SZ]),
    ];
  }),
];

export const convertibleDress: Template | null = {
  id: "convertible_dress",
  name: "Convertible satin midi dress",
  keywords: ["dress", "gown", "sundress", "midi dress", "maxi dress", "mini dress", "skirt", "midi skirt", "cocktail dress", "slip dress", "frock"],
  category: "dress",
  description: "Emerald satin midi dress with a V-neck, cap sleeves and phone-sized hip pockets; the bodice zips off at the waist to turn it into a skirt",
  targetPriceUsd: 140,
  parts,
};
