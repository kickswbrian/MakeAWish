import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: premium everyday commuter backpack, ~0.30 wide x 0.44 tall x 0.15 deep (meters).
 * The body is a soft "tombstone" extrusion (big top radii, beveled edges): front face at z = +0.075,
 * back face at z = -0.075, flat sides at x = +-0.15. On the front: a layered panel with a U-shaped
 * main zipper, a zipped pocket and a leather brand patch; mesh bottle pockets on the sides; a padded
 * back panel with S-curve shoulder straps, sternum strap and webbing adjusters; a contrast base.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const geo = (type: Geometry["type"], params: Record<string, unknown>) => ({ type, params }) as unknown as Geometry;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation, scale: [1, 1, 1] }, material };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation, scale: [1, 1, 1] }, material };
}

/** A mirrored pair: s = -1 (viewer's left) then +1 (viewer's right). */
const pair = (fn: (s: 1 | -1, side: "Left" | "Right", k: "l" | "r") => Part[]) => [...fn(-1, "Left", "l"), ...fn(1, "Right", "r")];

/**
 * Counter-clockwise outline of a rectangle (half-width hw, from y = yb to y = yt) with bottom corner
 * radius rb and top corner radius rt, starting at the bottom center. Straight runs are subdivided so
 * swept paths through these points stay straight.
 */
function outline(hw: number, yb: number, yt: number, rb: number, rt: number): V2[] {
  const out: V2[] = [];
  const line = (a: V2, b: V2) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04));
    for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  const arc = (cx: number, cy: number, r: number, a0: number) => {
    for (let i = 0; i < 6; i++) {
      const a = ((a0 + (90 * i) / 6) * Math.PI) / 180;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  line([0, yb], [hw - rb, yb]);
  arc(hw - rb, yb + rb, rb, -90);
  line([hw, yb + rb], [hw, yt - rt]);
  arc(hw - rt, yt - rt, rt, 0);
  line([hw - rt, yt], [-(hw - rt), yt]);
  arc(-(hw - rt), yt - rt, rt, 90);
  line([-hw, yt - rt], [-hw, yb + rb]);
  arc(-(hw - rb), yb + rb, rb, 180);
  line([-(hw - rb), yb], [0, yb]);
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6).map(([x, y]) => [r4(x), r4(y)]);
}

/** The part of an outline above yCut, running left to right over the top, at depth z. */
function overTop(o: V2[], yCut: number, z: number): V3[] {
  const up = o.filter(([, y]) => y > yCut + 1e-4).reverse();
  const hwAt = Math.abs(up[0][0]);
  return ([[-hwAt, yCut, z], ...up.map(([x, y]) => [x, y, z] as V3), [hwAt, yCut, z]] as V3[]).map(v);
}

// Palette: deep sage nylon, cognac leather accents, charcoal trims, gunmetal hardware.
const MAIN: PartMaterial = { preset: "nylon", color: "#4C5A4E" };
const TRIM: PartMaterial = { preset: "nylon", color: "#26282B" };
const BASE: PartMaterial = { preset: "leather", color: "#2E2A27" };
const LEATHER: PartMaterial = { preset: "leather", color: "#A5683A" };
const MESH: PartMaterial = { preset: "knit", color: "#34373B" };
const METAL: PartMaterial = { preset: "metal_brushed", color: "#7A7E85" };
const BUCKLE: PartMaterial = { preset: "plastic_matte", color: "#1E1F22" };

// Body: tombstone outline, depth D, generous bevel so every edge is soft.
const HW = 0.15, YB = -0.22, YT = 0.22, D = 0.15, BEVEL = 0.034;
const body = (inset: number, yb = YB + inset, rb = Math.max(0.012, 0.045 - inset)) => outline(HW - inset, yb, YT - inset, rb, Math.max(0.02, 0.09 - inset));

// Front panel: inset onto the flat front face, cut off above the base.
const PANEL_D = 0.014;
const PANEL_Z = D / 2 + PANEL_D / 2 - 0.003;
const PANEL_FACE = PANEL_Z + PANEL_D / 2;
const panelOutline = body(0.03, -0.165, 0.014);
const zipLine = body(0.046, -0.15, 0.012);
const ZIP_TOP = YT - 0.046;

// Back panel: same tombstone, on the back face.
const BACK_D = 0.022;
const BACK_Z = -D / 2 - BACK_D / 2 + 0.003;
const BACK_FACE = BACK_Z - BACK_D / 2;

// Base wrap.
const BASE_H = 0.075, BASE_D = D + 0.018, BASE_Y = YB + BASE_H / 2 - 0.002;

// Shoulder strap center line (s = -1 left, +1 right), in body coordinates.
const strapPath = (s: number): V3[] => [
  [s * 0.044, 0.172, BACK_FACE + 0.004],
  [s * 0.056, 0.152, BACK_FACE - 0.026],
  [s * 0.07, 0.095, BACK_FACE - 0.054],
  [s * 0.083, 0.005, BACK_FACE - 0.064],
  [s * 0.093, -0.075, BACK_FACE - 0.054],
  [s * 0.1, -0.115, BACK_FACE - 0.038],
].map((p) => v(p as V3));
const STRAP_T = 0.0065;
const STERNUM_Y = 0.03;

const parts: Part[] = [
  prim("main_body", "Main body", null, geo("extrude", { shape: body(0), depth: D, bevel: BEVEL }), MAIN),

  // ---- Front: layered panel with a U-zip, zipped pocket, brand patch ----
  prim("front_panel", "Front panel", "main_body", geo("extrude", { shape: panelOutline, depth: PANEL_D, bevel: 0.005 }), MAIN, [0, 0, PANEL_Z]),
  prim("main_zip_tape", "Main zipper tape", "main_body", geo("tube", { points: overTop(zipLine, -0.105, PANEL_FACE + 0.0008), radius: 0.0012, width: 0.022, faceNormal: [0, 0, 1] }), TRIM),
  prim("main_zip_teeth", "Main zipper teeth", "main_body", geo("tube", { points: overTop(zipLine, -0.105, PANEL_FACE + 0.0021), radius: 0.0021 }), METAL),
  ...pair((s, side, k) => [
    kit(`main_zip_pull_${k}`, `${side} main zipper pull`, "main_body", "zipper_pull", METAL, [s * 0.016, ZIP_TOP, PANEL_FACE + 0.003]),
  ]),
  ...pair((s, side, k) => [
    kit(`panel_stitch_${k}`, `${side} panel seam`, "front_panel", "stitching", MAIN, [s * (HW - 0.03 - 0.006), -0.03, PANEL_D / 2 - 0.0002], [0, 0, 90], { length: 0.2 }),
  ]),
  prim("front_pocket", "Front pocket", "main_body", geo("extrude", { shape: outline(0.11, -0.075, 0.075, 0.04, 0.016), depth: 0.042, bevel: 0.015 }), MAIN, [0, -0.115, PANEL_FACE + 0.021 - 0.006]),
  kit("pocket_zipper", "Front pocket zipper", "front_pocket", "zipper", TRIM, [0, 0.05, 0.0208], [0, 0, 0], { length: 0.17 }),
  kit("brand_patch", "Brand patch", "front_pocket", "brand_patch", LEATHER, [0, -0.012, 0.0208], [0, 0, 0], { width: 0.056, height: 0.032 }),

  // ---- Base: contrast wrap around the bottom ----
  prim("base_panel", "Base panel", "main_body", geo("roundedBox", { width: HW * 2 + 0.008, height: BASE_H, depth: BASE_D, radius: 0.03 }), BASE, [0, BASE_Y, 0]),
  kit("base_stitching", "Base seam", "base_panel", "stitching", MAIN, [0, BASE_H / 2 - 0.012, BASE_D / 2 - 0.0003], [0, 0, 0], { length: 0.24 }),

  // ---- Sides: stretch mesh bottle pockets ----
  ...pair((s, side, k) => [
    kit(`side_pocket_${k}`, `${side} bottle pocket`, "main_body", "mesh_pocket", MESH, [s * (HW + 0.0015), -0.085, 0], [0, s * 90, 0], { width: 0.1, height: 0.15 }),
  ]),
  kit("laptop_zipper", "Side laptop zipper", "main_body", "zipper", TRIM, [HW - 0.0002, 0.085, 0.004], [0, 90, 90], { length: 0.19 }),

  // ---- Top: leather grab handle ----
  kit("grab_handle", "Top grab handle", "main_body", "handle_grip", LEATHER, [0, YT - 0.001, -0.03], [-90, 0, 0], { length: 0.11 }),

  // ---- Back: padded panel, yoke, shoulder straps, sternum strap ----
  prim("back_panel", "Back panel", "main_body", geo("extrude", { shape: body(0.03, -0.16, 0.014), depth: BACK_D, bevel: 0.008 }), MESH, [0, 0, BACK_Z]),
  ...pair((s, side, k) => [
    prim(`back_pad_${k}`, `${side} back pad`, "back_panel", geo("roundedBox", { width: 0.088, height: 0.24, depth: 0.016, radius: 0.0078 }), MESH, [s * 0.056, -0.025, -BACK_D / 2 - 0.006]),
  ]),
  prim("strap_yoke", "Strap yoke", "back_panel", geo("roundedBox", { width: 0.12, height: 0.042, depth: 0.01, radius: 0.005 }), LEATHER, [0, 0.165, -BACK_D / 2 - 0.004]),
  ...pair((s, side, k) => {
    const path = strapPath(s);
    const end = path[path.length - 1];
    const anchor: V3 = [s * 0.122, BASE_Y + 0.005, -BASE_D / 2 - 0.007];
    return [
      prim(`shoulder_strap_${k}`, `${side} shoulder strap`, "main_body", geo("tube", { points: path, radius: STRAP_T, width: 0.062, faceNormal: [0, 0, -1] }), MAIN),
      prim(`strap_webbing_${k}`, `${side} strap webbing`, "main_body", geo("tube", {
        points: [v([end[0], end[1] + 0.01, end[2] - 0.004]), v([end[0] + s * 0.006, end[1] - 0.03, end[2] + 0.012]), v([anchor[0] - s * 0.005, anchor[1] + 0.03, anchor[2] - 0.004]), anchor],
        radius: 0.0016, width: 0.025, faceNormal: [0, 0, -1],
      }), TRIM),
      kit(`strap_adjuster_${k}`, `${side} strap buckle`, "main_body", "buckle_side_release", BUCKLE, [end[0] + s * 0.003, end[1] - 0.012, end[2] - 0.006], [-24, 180, s * -6]),
      prim(`anchor_tab_${k}`, `${side} strap anchor`, "base_panel", geo("roundedBox", { width: 0.04, height: 0.042, depth: 0.008, radius: 0.004 }), LEATHER, [s * 0.122, 0.004, -BASE_D / 2 - 0.002]),
    ];
  }),
  prim("sternum_strap", "Sternum strap", "main_body", geo("tube", {
    points: [[-0.09, STERNUM_Y + 0.002, BACK_FACE - 0.0697], [0, STERNUM_Y, BACK_FACE - 0.0704], [0.09, STERNUM_Y + 0.002, BACK_FACE - 0.0697]].map((p) => v(p as V3)),
    radius: 0.0012, width: 0.02, faceNormal: [0, 0, -1],
  }), TRIM),
  kit("sternum_buckle", "Sternum buckle", "main_body", "buckle_side_release", BUCKLE, [0, STERNUM_Y, BACK_FACE - 0.072], [0, 180, 90]),
];

export const backpack: Template | null = {
  id: "backpack",
  name: "Everyday commuter backpack",
  keywords: ["backpack", "rucksack", "daypack", "bookbag", "book bag", "school bag", "schoolbag", "knapsack", "commuter bag", "hiking pack"],
  category: "backpack",
  description: "Everyday commuter backpack with a U-zip front panel, zipped front pocket, mesh bottle pockets, padded back and S-curve shoulder straps",
  targetPriceUsd: 120,
  parts,
};
