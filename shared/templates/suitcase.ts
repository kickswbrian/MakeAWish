import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: hard-shell carry-on spinner suitcase.
 * The shell (root) is a rounded-rectangle outline extruded front-to-back: 0.36 wide, 0.52 tall,
 * 0.22 deep (front face at z = 0.11, top at y = 0.26, right side at x = 0.18). The zipper seam
 * runs around the middle at z = 0. Telescoping handle sits on top toward the back, casters at
 * the four bottom corners.
 */

type V3 = [number, number, number];

const SHELL: PartMaterial = { preset: "plastic_gloss", color: "#8FB1CC" };
const TRIM: PartMaterial = { preset: "plastic_matte", color: "#26282C" };
const ZIP: PartMaterial = { preset: "nylon", color: "#2B2D31" };
const METAL: PartMaterial = { preset: "metal_brushed", color: "#C9CCD2" };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

const r4 = (v: number) => +v.toFixed(4);

/** Rounded-rectangle outline (counter-clockwise) centered on the origin. */
function rrect(w: number, h: number, r: number, seg = 6): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([r4(cx + Math.cos(a) * r), r4(cy + Math.sin(a) * r)]);
    }
  return out;
}

const W = 0.36, H = 0.52, D = 0.22, CR = 0.05;

const rib = (id: string, name: string, x: number, front: boolean): Part =>
  prim(id, name, "shell", { type: "roundedBox", params: { width: 0.03, height: 0.41, depth: 0.009, radius: 0.0042 } }, SHELL, [x, -0.008, front ? D / 2 + 0.0012 : -D / 2 - 0.0012]);

function corner(sx: number, sz: number): Part[] {
  const k = `${sz > 0 ? "front" : "back"}_${sx > 0 ? "right" : "left"}`;
  const label = `${sz > 0 ? "Front" : "Back"} ${sx > 0 ? "right" : "left"}`;
  return [
    prim(`housing_${k}`, `${label} wheel housing`, "shell", { type: "roundedBox", params: { width: 0.078, height: 0.036, depth: 0.07, radius: 0.013 } }, TRIM, [sx * 0.132, -H / 2 + 0.006, sz * 0.066]),
    kit(`caster_${k}`, `${label} caster`, `housing_${k}`, "wheel_caster", TRIM, [0, -0.0175, 0], [0, 0, 0], [1.25, 1.25, 1.25]),
  ];
}

const parts: Part[] = [
  prim("shell", "Shell", null, { type: "extrude", params: { shape: rrect(W, H, CR), depth: D, bevel: 0.032, smooth: false } }, SHELL),

  // Zipper seam band around the middle.
  prim("zipper_seam", "Zipper seam", "shell", { type: "extrude", params: { shape: rrect(W + 0.006, H + 0.006, CR + 0.003), depth: 0.016, bevel: 0.0035, smooth: false } }, ZIP),

  // Ribbed polycarbonate: raised vertical ribs on the front and back shells.
  rib("rib_front_1", "Front rib 1", -0.115, true),
  rib("rib_front_2", "Front rib 2", -0.047, true),
  rib("rib_front_3", "Front rib 3", 0.047, true),
  rib("rib_front_4", "Front rib 4", 0.115, true),
  rib("rib_back_1", "Back rib 1", -0.115, false),
  rib("rib_back_2", "Back rib 2", 0.115, false),
  prim("logo_badge", "Logo badge", "shell", { type: "roundedBox", params: { width: 0.05, height: 0.013, depth: 0.003, radius: 0.0013 } }, METAL, [0, 0.19, D / 2 + 0.0008]),

  // Telescoping handle on top toward the back, in a recessed housing.
  prim("handle_housing", "Handle housing", "shell", { type: "roundedBox", params: { width: 0.29, height: 0.01, depth: 0.046, radius: 0.0045 } }, TRIM, [0, H / 2 + 0.002, -0.06]),
  kit("telescoping_handle", "Telescoping handle", "handle_housing", "handle_telescoping", METAL, [0, 0.0045, 0], [0, 0, 0], [1, 1, 1], { height: 0.24 }),

  // Grab handles: top (front of the trolley) and right side.
  prim("top_handle_base", "Top handle base", "shell", { type: "roundedBox", params: { width: 0.19, height: 0.008, depth: 0.04, radius: 0.0038 } }, TRIM, [0, H / 2 + 0.0015, 0.045]),
  kit("top_handle", "Top handle", "top_handle_base", "handle_grip", TRIM, [0, 0.0035, 0], [-90, 0, 0], [1, 1, 1], { length: 0.15 }),
  prim("side_handle_base", "Side handle base", "shell", { type: "roundedBox", params: { width: 0.008, height: 0.19, depth: 0.04, radius: 0.0038 } }, TRIM, [W / 2 + 0.0015, 0.04, -0.05]),
  kit("side_handle", "Side handle", "side_handle_base", "handle_grip", TRIM, [0.0035, 0, 0], [0, 90, 90], [1, 1, 1], { length: 0.15 }),

  // TSA combination lock on the right side, straddling the seam, with both zipper pulls docked.
  prim("tsa_lock", "TSA lock", "shell", { type: "roundedBox", params: { width: 0.014, height: 0.078, depth: 0.05, radius: 0.005 } }, TRIM, [W / 2 + 0.004, 0.15, 0]),
  prim("lock_dial_1", "Lock dial 1", "tsa_lock", { type: "cylinder", params: { radiusTop: 0.0065, radiusBottom: 0.0065, height: 0.009, bevel: 0.0012, open: false } }, METAL, [0.0045, 0.022, 0.006], [90, 0, 0]),
  prim("lock_dial_2", "Lock dial 2", "tsa_lock", { type: "cylinder", params: { radiusTop: 0.0065, radiusBottom: 0.0065, height: 0.009, bevel: 0.0012, open: false } }, METAL, [0.0045, 0.008, 0.006], [90, 0, 0]),
  prim("lock_dial_3", "Lock dial 3", "tsa_lock", { type: "cylinder", params: { radiusTop: 0.0065, radiusBottom: 0.0065, height: 0.009, bevel: 0.0012, open: false } }, METAL, [0.0045, -0.006, 0.006], [90, 0, 0]),
  prim("tsa_keyhole", "TSA keyhole", "tsa_lock", { type: "cylinder", params: { radiusTop: 0.0042, radiusBottom: 0.0042, height: 0.003, bevel: 0.0008, open: false } }, METAL, [0.0072, 0.022, -0.012], [0, 0, 90]),
  prim("tsa_indicator", "TSA indicator", "tsa_lock", { type: "roundedBox", params: { width: 0.002, height: 0.008, depth: 0.008, radius: 0.0009 } }, { preset: "plastic_gloss", color: "#D7263D" }, [0.0072, 0.006, -0.012], [45, 0, 0]),
  kit("zipper_pull_front", "Front zipper pull", "tsa_lock", "zipper_pull", METAL, [0.007, -0.024, 0.01], [0, 90, 0]),
  kit("zipper_pull_back", "Back zipper pull", "tsa_lock", "zipper_pull", METAL, [0.007, -0.024, -0.01], [0, 90, 0]),

  ...corner(1, 1),
  ...corner(-1, 1),
  ...corner(1, -1),
  ...corner(-1, -1),
];

export const suitcase: Template | null = {
  id: "suitcase",
  name: "Hard-Shell Carry-On Spinner",
  keywords: ["suitcase", "luggage", "carry on", "carry-on", "carryon", "trolley", "roller bag", "rolling suitcase", "spinner"],
  category: "suitcase",
  description: "Carry-on hard-shell spinner suitcase with ribbed polycarbonate shell, telescoping handle, four spinner wheels and a TSA lock",
  targetPriceUsd: 179,
  parts,
};
