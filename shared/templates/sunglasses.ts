import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: classic acetate wayfarer sunglasses, front toward +Z, temples open and running back
 * along -Z. The root is the front frame: one smooth extruded outline (146 mm wide, 6.5 mm thick,
 * centered on z = 0) with two lens openings centered at x = +-0.035. Lenses sit in the openings,
 * silver rivets dot the front corners, and barrel hinges join the end pieces to the temples.
 */

type V2 = [number, number];
type V3 = [number, number, number];

const ACETATE: PartMaterial = { preset: "plastic_gloss", color: "#1A1A1D", roughness: 0.16 };
// Tinted lenses: the glass preset keeps pale glass clear, so dark sunglass tint is glossy, slightly see-through plastic.
const LENS: PartMaterial = { preset: "plastic_gloss", color: "#1C2621", roughness: 0.05, opacity: 0.9 };
const SILVER: PartMaterial = { preset: "metal_polished", color: "#D9DCE1" };
const PAD: PartMaterial = { preset: "plastic_gloss", color: "#E6E1D6", opacity: 0.75 };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "kit", kitAsset, parent, transform: { position, rotation, scale }, material: { ...material } };
}

const r5 = (v: number) => Math.round(v * 100000) / 100000;
const FD = 0.0072; // frame depth
const FRONT = FD / 2, BACK = -FD / 2;
const LX = 0.035; // lens centers at x = +-LX

// Right lens opening (viewer's right, +X), absolute coordinates: flat brow, rounded outer corner, tapered nose side.
const HOLE_R: V2[] = [
  [0.0128, 0.0158], [0.02, 0.0182], [0.035, 0.0192], [0.05, 0.019], [0.0592, 0.0178], [0.0612, 0.012], [0.06, 0.002],
  [0.056, -0.0095], [0.0485, -0.017], [0.037, -0.0198], [0.0255, -0.0185], [0.0168, -0.0125], [0.0128, -0.003], [0.0115, 0.007],
];
const mirror = (pts: V2[]): V2[] => pts.map(([x, y]) => [r5(-x), y] as V2).reverse();
const HOLE_L = mirror(HOLE_R);

// Outer outline, right half from top center round the end piece and back under the lens to the bridge.
const OUTER_R: V2[] = [
  [0.012, 0.0262], [0.03, 0.0285], [0.05, 0.0289], [0.066, 0.0293], [0.0735, 0.0268], [0.0752, 0.0205], [0.0738, 0.0115],
  [0.0695, -0.002], [0.0625, -0.0155], [0.0515, -0.0248], [0.037, -0.0278], [0.0225, -0.025], [0.0128, -0.0165], [0.0088, -0.005], [0.0066, 0.0055],
];
const OUTER: V2[] = [[0, 0.0245], ...OUTER_R, [0, 0.0098], ...mirror(OUTER_R)];

/** A lens: its opening grown ~1.1 mm so the edge seats in the frame groove. */
const lensShape = (hole: V2[], cx: number): V2[] => hole.map(([x, y]) => [r5(cx + (x - cx) * 1.045), r5(y * 1.055)] as V2);

/** Temple arm: flat acetate strap from the hinge back along -Z, dropping behind the ear. */
const templePath = (s: number): V3[] =>
  ([[0.0703, 0.0145, -0.0068], [0.0703, 0.0146, -0.022], [0.0698, 0.014, -0.06], [0.0692, 0.0124, -0.1], [0.0688, 0.0098, -0.124], [0.0686, 0.003, -0.139], [0.0684, -0.0065, -0.149], [0.0683, -0.0145, -0.1535]] as V3[]).map(([x, y, z]) => [r5(s * x), r5(y + 0.004), z] as V3);

const side = (s: 1 | -1): Part[] => {
  const k = s > 0 ? "right" : "left";
  const K = s > 0 ? "Right" : "Left";
  return [
    prim(`end_piece_${k}`, `${K} end piece`, "frame_front", { type: "roundedBox", params: { width: 0.0062, height: 0.0118, depth: 0.0052, radius: 0.0018 } }, ACETATE, [s * 0.0697, 0.0185, BACK - 0.0016]),
    prim(`hinge_${k}`, `${K} hinge`, "frame_front", { type: "cylinder", params: { radiusTop: 0.0017, radiusBottom: 0.0017, height: 0.0086, bevel: 0.0004, open: false } }, SILVER, [s * 0.0697, 0.0185, BACK - 0.0049]),
    prim(`temple_${k}`, `${K} temple`, "frame_front", { type: "tube", params: { points: templePath(s), radius: 0.0021, width: 0.0098, faceNormal: [1, 0, 0], closed: false, sharp: false } }, ACETATE),
    kit(`temple_rivet_${k}`, `${K} temple rivet`, "frame_front", "rivet", SILVER, [s * 0.0724, 0.0185, -0.0175], [0, s * 90, 0], [0.75, 0.75, 0.75]),
    kit(`rivet_${k}_upper`, `${K} front rivet`, "frame_front", "rivet", SILVER, [s * 0.0672, 0.0228, FRONT - 0.0003], [0, 0, 0], [0.7, 0.7, 0.7]),
    kit(`rivet_${k}_lower`, `${K} front rivet`, "frame_front", "rivet", SILVER, [s * 0.0692, 0.0158, FRONT - 0.0003], [0, 0, 0], [0.7, 0.7, 0.7]),
    prim(`nose_pad_${k}`, `${K} nose pad`, "frame_front", { type: "sphere", params: { radius: 0.0062, angle: 180 } }, PAD, [s * 0.0122, -0.0062, BACK - 0.0012], [0, s * 28, s * -18], [0.32, 1, 0.55]),
    prim(`lens_${k}`, `${K} lens`, "frame_front", { type: "extrude", params: { shape: lensShape(s > 0 ? HOLE_R : HOLE_L, s * LX), depth: 0.0021, bevel: 0.0006, smooth: true } }, LENS, [0, 0, 0.0004]),
  ];
};

const parts: Part[] = [
  prim("frame_front", "Frame", null, { type: "extrude", params: { shape: OUTER, holes: [HOLE_R, HOLE_L], depth: FD, bevel: 0.0019, smooth: true } }, ACETATE),
  ...side(1),
  ...side(-1),
  prim("brand_logo", "Brand logo", "frame_front", { type: "roundedBox", params: { width: 0.0007, height: 0.0032, depth: 0.0135, radius: 0.0003 } }, SILVER, [-0.0726, 0.0185, -0.031]),
];

export const sunglasses: Template | null = {
  id: "sunglasses",
  name: "Wayfarer Sunglasses",
  keywords: ["sunglasses", "sunglass", "glasses", "shades", "eyewear", "spectacles", "sunnies", "eyeglasses", "wayfarers", "aviators"],
  category: "sunglasses",
  description: "Classic acetate wayfarer sunglasses with tinted glass lenses, silver rivets, barrel hinges and sculpted temples",
  targetPriceUsd: 149,
  parts,
};
