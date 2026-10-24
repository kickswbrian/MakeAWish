import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: sculpted aluminium laptop stand with an open laptop resting on it, facing +Z.
 * The platform (root) is a slim plate tilted up 15 degrees at the back; its origin is the plate's
 * center. Two side blades (flat swept bars) swoop from under the front edge down to the desk,
 * run back along it and curl up under the back edge. Blade paths are authored in desk coordinates
 * and converted into the platform's tilted frame with `L()`. The laptop sits on silicone pads, held
 * by two front lips; its lid hinges open to sit just past vertical with a glowing display.
 */

type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const D2R = Math.PI / 180;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

const box = (width: number, height: number, depth: number, radius?: number): Geometry => ({ type: "roundedBox", params: { width, height, depth, ...(radius !== undefined ? { radius } : {}) } });

const ALU: PartMaterial = { preset: "metal_brushed", color: "#C0C4CA", roughness: 0.4 };
const PAD: PartMaterial = { preset: "rubber", color: "#2A2B2E" };
const LAPTOP: PartMaterial = { preset: "metal_brushed", color: "#8E929A" };
const KEYS: PartMaterial = { preset: "plastic_matte", color: "#202124" };
const BEZEL: PartMaterial = { preset: "plastic_gloss", color: "#0B0C0E" };
const TRACKPAD: PartMaterial = { preset: "glass", color: "#5E6268", roughness: 0.25 };
const SCREEN: PartMaterial = { preset: "glass", color: "#0B0C0E", emissive: "#9FC6F0", emissiveIntensity: 1.1 };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#DADDE2" };

// ---------- Platform (desk coordinates) ----------

const TILT = 15; // degrees, back edge raised
const PW = 0.25, PD = 0.235, PT = 0.006;
const PC: V3 = [0, 0.145, -0.006]; // platform center
const ct = Math.cos(TILT * D2R), st = Math.sin(TILT * D2R);
/** Desk coordinates -> the platform's tilted frame (inverse of rotation X by +TILT about PC). */
const L = (x: number, y: number, z: number): V3 => {
  const dy = y - PC[1], dz = z - PC[2];
  return [x - PC[0], dy * ct + dz * st, -dy * st + dz * ct];
};
/** The platform's frame -> desk coordinates. */
const W = (x: number, y: number, z: number): V3 => [x + PC[0], PC[1] + y * ct - z * st, PC[2] + y * st + z * ct];

// Under the front and back edges of the plate, in desk coordinates.
const FRONT_UNDER = W(0, -PT / 2 - 0.009, PD / 2 - 0.016);
const BACK_UNDER = W(0, -PT / 2 - 0.009, -PD / 2 + 0.018);
const BAND = 0.03; // blade band width (in the side profile)
const BT = 0.004; // blade half thickness (along X)

/** Side blade path, desk coordinates (z, y): under the front edge, down to the desk, back, and up. */
const BLADE_ZY: [number, number][] = [
  [FRONT_UNDER[2], FRONT_UNDER[1]],
  [FRONT_UNDER[2] + 0.007, 0.075],
  [0.104, 0.036],
  [0.082, BAND / 2 + 0.001],
  [0.02, BAND / 2],
  [-0.06, BAND / 2],
  [-0.11, 0.026],
  [-0.138, 0.066],
  [-0.141, 0.118],
  [BACK_UNDER[2], BACK_UNDER[1]],
];

function blade(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const N = sx > 0 ? "Right" : "Left";
  const x = sx * 0.1;
  return [
    prim(`blade_${k}`, `${N} side blade`, "platform", { type: "tube", params: { points: BLADE_ZY.map(([z, y]) => v(L(x, y, z))), radius: BT, width: BAND, faceNormal: [1, 0, 0], closed: false, sharp: false } }, ALU),
    // Silicone strip along the floor run so it never scratches the desk.
    prim(`foot_${k}`, `${N} silicone foot`, "platform", box(0.0085, 0.003, 0.13, 0.0013), PAD, L(x, 0.0015, 0.012), [-TILT, 0, 0]),
    // A mount block where the blade meets the plate at the back.
    prim(`mount_${k}`, `${N} rear mount`, "platform", box(0.014, 0.008, 0.03, 0.003), ALU, [x, -PT / 2 - 0.003, -PD / 2 + 0.026]),
  ];
}

// ---------- Laptop (platform frame) ----------

const LW = 0.304, LT = 0.0155, LD = 0.212;
const PAD_H = 0.0022;
const BASE_Y = PT / 2 + PAD_H + LT / 2;
const BASE_Z = 0.0;
const OPEN = 112; // lid opening angle from the deck, degrees
const LID_T = 0.0055, LID_H = 0.208;
const lidRot = -(OPEN - 90);
const lr = lidRot * D2R;
// Lid hinges about the deck's back top edge; its back face sits on the hinge line.
const HINGE: V3 = [0, LT / 2 + 0.001, -LD / 2 + 0.002];
const lidCenter: V3 = [
  0,
  HINGE[1] + (LID_H / 2) * Math.cos(lr) - (-LID_T / 2) * Math.sin(lr),
  HINGE[2] + (LID_H / 2) * Math.sin(lr) + (-LID_T / 2) * Math.cos(lr) + 0.004,
];

const parts: Part[] = [
  prim("platform", "Platform", null, box(PW, PT, PD, 0.0028), ALU, PC, [TILT, 0, 0]),
  ...blade(1),
  ...blade(-1),
  // Front lips that stop the laptop sliding off, and silicone pads it rests on.
  prim("lip_r", "Right front lip", "platform", box(0.05, 0.016, 0.007, 0.0032), ALU, [0.075, PT / 2 + 0.0055, PD / 2 - 0.0045]),
  prim("lip_l", "Left front lip", "platform", box(0.05, 0.016, 0.007, 0.0032), ALU, [-0.075, PT / 2 + 0.0055, PD / 2 - 0.0045]),
  prim("pad_r", "Right silicone pad", "platform", box(0.014, PAD_H + 0.0006, 0.19, 0.001), PAD, [0.075, PT / 2 + PAD_H / 2 - 0.0003, -0.008]),
  prim("pad_l", "Left silicone pad", "platform", box(0.014, PAD_H + 0.0006, 0.19, 0.001), PAD, [-0.075, PT / 2 + PAD_H / 2 - 0.0003, -0.008]),
  prim("pad_lip_r", "Right lip pad", "lip_r", box(0.044, 0.01, 0.0012, 0.0005), PAD, [0, 0.0005, -0.0036]),
  prim("pad_lip_l", "Left lip pad", "lip_l", box(0.044, 0.01, 0.0012, 0.0005), PAD, [0, 0.0005, -0.0036]),
  // Ventilation cut-out through the plate (an invisible cutter).
  { ...prim("vent_cutter", "Vent cutter", "platform", box(0.11, 0.03, 0.06, 0.012), ALU, [0, 0, -0.03]), csg: { op: "subtract", withPartId: "platform" } },

  // The laptop on top.
  prim("laptop_base", "Laptop base", "platform", box(LW, LT, LD, 0.006), LAPTOP, [0, BASE_Y, BASE_Z]),
  prim("keyboard", "Keyboard", "laptop_base", box(0.27, 0.0012, 0.104, 0.0005), KEYS, [0, LT / 2 - 0.0003, -0.035]),
  prim("trackpad", "Trackpad", "laptop_base", box(0.13, 0.0008, 0.08, 0.004), TRACKPAD, [0, LT / 2 - 0.0002, 0.06]),
  prim("hinge", "Hinge", "laptop_base", { type: "cylinder", params: { radiusTop: 0.0055, radiusBottom: 0.0055, height: 0.23, bevel: 0.002, open: false } }, KEYS, [0, LT / 2 - 0.002, -LD / 2 + 0.004], [0, 0, 90]),
  prim("lid", "Laptop lid", "laptop_base", box(LW, LID_H, LID_T, 0.006), LAPTOP, lidCenter, [lidRot, 0, 0]),
  prim("bezel", "Display bezel", "lid", box(LW - 0.003, LID_H - 0.003, 0.0008, 0.005), BEZEL, [0, 0, LID_T / 2 - 0.0002]),
  kit("display", "Display", "lid", "screen", SCREEN, [0, 0.004, LID_T / 2 - 0.0028], [0, 0, 0], { width: 0.286, height: 0.182 }),
  prim("webcam", "Webcam", "lid", { type: "cylinder", params: { radiusTop: 0.0014, radiusBottom: 0.0014, height: 0.0006, bevel: 0.0002, open: false } }, { preset: "glass", color: "#1B2230" }, [0, LID_H / 2 - 0.0055, LID_T / 2 + 0.0004], [90, 0, 0]),
  prim("logo", "Logo", "lid", { type: "cylinder", params: { radiusTop: 0.011, radiusBottom: 0.011, height: 0.0004, bevel: 0.0001, open: false } }, CHROME, [0, 0.004, -LID_T / 2 - 0.0001], [90, 0, 0]),
];

export const laptopStand: Template | null = {
  id: "laptop_stand",
  name: "Aluminium Laptop Stand",
  keywords: ["laptop stand", "laptop riser", "notebook stand", "laptop holder", "macbook stand", "computer stand", "laptop mount"],
  category: "laptop stand",
  description: "Sculpted aluminium laptop stand that lifts the screen to eye level, with sweeping side blades, silicone pads, front lips and a ventilation cut-out",
  targetPriceUsd: 59,
  parts,
};
