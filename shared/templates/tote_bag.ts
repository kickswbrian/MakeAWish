import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: structured canvas tote with leather trim, ~0.42 wide at the rim (0.34 at the base),
 * 0.32 tall, 0.15 deep (meters). The body is a tapered extrusion (front face at z = +0.075, rim at
 * y = +0.16, base at y = -0.16) hollowed by an invisible cutter, leaving 6 mm walls and an open top.
 * A leather band wraps the rim, a leather base wraps the bottom, and two riveted leather strap
 * handles arch over the top (front and back). Inside: a zip pocket on the back wall and a snap.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const geo = (type: Geometry["type"], params: Record<string, unknown>) => ({ type, params }) as unknown as Geometry;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

/** An invisible cutter carved out of `target` (positioned in the target's frame). */
function cutter(id: string, name: string, target: string, geometry: Geometry, position: V3 = [0, 0, 0]): Part {
  return { ...prim(id, name, target, geometry, { preset: "plastic_matte", color: "#888888" }, position), csg: { op: "subtract", withPartId: target } };
}

/** Polygon with every corner rounded by a quadratic fillet of size d[i] (counter-clockwise in, out). */
function fillet(poly: V2[], d: number[]): V2[] {
  const out: V2[] = [];
  poly.forEach((p, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length], b = poly[(i + 1) % poly.length];
    const toward = (q: V2, k: number): V2 => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return [p[0] + ((q[0] - p[0]) / len) * k, p[1] + ((q[1] - p[1]) / len) * k];
    };
    const p1 = toward(a, d[i]), p2 = toward(b, d[i]);
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      out.push([
        r4((1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * p[0] + t * t * p2[0]),
        r4((1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * p[1] + t * t * p2[1]),
      ]);
    }
  });
  return out;
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

// Palette: slate-navy canvas, cognac leather, ecru lining, brass hardware.
const MAIN: PartMaterial = { preset: "canvas", color: "#2F3B52" };
const LEATHER: PartMaterial = { preset: "leather", color: "#9C5B32" };
const LINING: PartMaterial = { preset: "canvas", color: "#E4D8C0" };
const BRASS: PartMaterial = { preset: "metal_polished", color: "#C9A45C" };

// Tapered front profile: half-width grows from HB at the base to HT at the rim.
const H = 0.32, D = 0.15, WALL = 0.006, HB = 0.17, HT = 0.21;
const YB = -H / 2, YT = H / 2, FRONT = D / 2;
const hw = (y: number) => HB + ((y - YB) * (HT - HB)) / (YT - YB);
const SLANT = (Math.atan((HT - HB) / H) * 180) / Math.PI;

/** The tapered profile between y0 and y1, grown outward by `grow` (negative = inset). */
function slice(y0: number, y1: number, grow: number, rb: number, rt: number): V2[] {
  const g = grow / Math.cos((SLANT * Math.PI) / 180);
  return fillet([[-(hw(y0) + g), y0], [hw(y0) + g, y0], [hw(y1) + g, y1], [-(hw(y1) + g), y1]], [rb, rb, rt, rt]);
}

const SKIN = 0.002; // leather trims stand this far proud of the canvas
const TRIM_H = 0.034, BASE_H = 0.056;
const IN_D = D - 2 * WALL;

// Handle: a flat leather strap attached at x = +-HX on the front (s = 1) or back (s = -1).
const HX = 0.085;
const handlePath = (s: number): V3[] => {
  const z = (d: number) => s * (FRONT + d);
  const half: V3[] = [
    [-HX, 0.066, z(0.0034)], [-HX, 0.105, z(0.0036)], [-HX, 0.13, z(0.0054)], [-HX + 0.001, 0.17, z(0.0062)],
    [-0.07, 0.228, z(0.0052)], [-0.036, 0.266, z(0.0042)],
  ];
  return [...half, [0, 0.276, z(0.004)] as V3, ...half.slice().reverse().map(([x, y, zz]) => [-x, y, zz] as V3)].map(v);
};

const sides = [
  { s: 1, side: "Front", k: "f" },
  { s: -1, side: "Back", k: "b" },
] as const;

const KEY_Y = 0.105;

const parts: Part[] = [
  prim("tote_body", "Tote body", null, geo("extrude", { shape: slice(YB, YT, 0, 0.03, 0.008), depth: D, bevel: 0.012 }), MAIN),
  cutter("interior_cut", "Interior", "tote_body", geo("extrude", { shape: slice(YB + WALL, YT + 0.06, -WALL, 0.024, 0.004), depth: IN_D, bevel: 0.008 })),

  // ---- Leather rim band (hollowed with the opening, so it also lines the inside of the rim) ----
  prim("rim_trim", "Leather rim trim", "tote_body", geo("extrude", { shape: slice(YT - TRIM_H, YT + 0.0012, SKIN, 0.003, 0.006), depth: D + 2 * SKIN, bevel: 0.005 }), LEATHER),
  cutter("rim_trim_cut", "Rim opening", "rim_trim", geo("extrude", { shape: slice(YT - TRIM_H - 0.01, YT + 0.04, -WALL - 0.001, 0.003, 0.003), depth: IN_D - 0.002, bevel: 0.006 })),
  kit("rim_stitching", "Rim seam", "rim_trim", "stitching", LINING, [0, YT - TRIM_H + 0.0065, FRONT + SKIN - 0.0002], [0, 0, 0], { length: 0.38 }),

  // ---- Leather base wrap ----
  prim("base_panel", "Leather base", "tote_body", geo("extrude", { shape: slice(YB - 0.0012, YB + BASE_H, SKIN, 0.031, 0.003), depth: D + 2 * SKIN, bevel: 0.013 }), LEATHER),
  cutter("base_cut", "Base inside", "base_panel", geo("extrude", { shape: slice(YB + WALL + 0.001, YB + BASE_H + 0.02, -WALL - 0.001, 0.023, 0.003), depth: IN_D - 0.002, bevel: 0.007 })),
  kit("base_stitching", "Base seam", "base_panel", "stitching", LINING, [0, YB + BASE_H - 0.0065, FRONT + SKIN - 0.0002], [0, 0, 0], { length: 0.32 }),

  // ---- Handles with riveted leather tabs ----
  ...sides.flatMap(({ s, side, k }) => [
    prim(`handle_${k}`, `${side} handle`, "tote_body", geo("tube", { points: handlePath(s), radius: 0.0022, width: 0.026, faceNormal: [0, 0, s] }), LEATHER),
    ...([-1, 1] as const).flatMap((x) => {
      const xs = x < 0 ? "left" : "right";
      const rot: V3 = s > 0 ? [0, 0, 0] : [0, 180, 0];
      return [
        prim(`handle_tab_${k}_${xs[0]}`, `${side} ${xs} handle tab`, "tote_body", geo("roundedBox", { width: 0.036, height: 0.056, depth: 0.003, radius: 0.0014 }), LEATHER, [x * HX, 0.086, s * (FRONT + 0.0012)]),
        kit(`rivet_${k}_${xs[0]}`, `${side} ${xs} lower rivet`, "tote_body", "rivet", BRASS, [x * HX, 0.08, s * (FRONT + 0.0056)], rot),
        kit(`rivet_${k}_${xs[0]}2`, `${side} ${xs} upper rivet`, "tote_body", "rivet", BRASS, [x * HX, 0.1, s * (FRONT + 0.0057)], rot),
      ];
    }),
  ]),

  // ---- Front: leather brand patch ----
  kit("brand_patch", "Brand patch", "tote_body", "brand_patch", LEATHER, [0, -0.028, FRONT - 0.0002], [0, 0, 0], { width: 0.07, height: 0.04 }),

  // ---- Inside: zip pocket on the back wall, magnetic snap on the rim ----
  prim("inner_pocket", "Inner pocket", "tote_body", geo("roundedBox", { width: 0.2, height: 0.1, depth: 0.004, radius: 0.0018 }), LINING, [0, 0.03, -FRONT + WALL + 0.0015]),
  kit("inner_pocket_zipper", "Inner pocket zipper", "inner_pocket", "zipper", LINING, [0, 0.036, 0.0019], [0, 0, 0], { length: 0.17 }),
  kit("magnetic_snap", "Magnetic snap", "rim_trim", "snap_button", BRASS, [0, YT - TRIM_H / 2, IN_D / 2 - 0.001], [0, 180, 0]),

  // ---- Side: key D-ring on the tapered right gusset ----
  kit("key_ring", "Key D-ring", "tote_body", "d_ring", BRASS, [hw(KEY_Y) - 0.0002, KEY_Y, 0], mount([1, -Math.tan((SLANT * Math.PI) / 180), 0], [0, 1, 0])),
];

export const toteBag: Template | null = {
  id: "tote_bag",
  name: "Structured canvas tote",
  keywords: ["tote", "tote bag", "shopping bag", "beach bag", "market bag", "shoulder bag", "carryall", "handbag", "purse"],
  category: "tote bag",
  description: "Structured canvas tote with a leather-bound rim, leather base, riveted leather handles and an inner zip pocket",
  targetPriceUsd: 85,
  parts,
};
