import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: classic plush teddy bear sitting on the floor, facing +Z, ~0.30 m tall.
 * The body (root) is a pear-shaped lathe with its base on the floor (y = 0); the head is a sphere
 * (radius 0.068) centered 0.232 up. Features on the head are placed by azimuth/elevation on its
 * surface and turned to face along the surface normal. Only leaf parts are scaled, so children
 * never inherit a squash.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const D = Math.PI / 180;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

const FUR: PartMaterial = { preset: "suede", color: "#B5794A" };
const LIGHT: PartMaterial = { preset: "suede", color: "#EBD3AE" };
const NOSE: PartMaterial = { preset: "plastic_gloss", color: "#3B2419" };
const EYE: PartMaterial = { preset: "plastic_gloss", color: "#17120F" };
const BOW: PartMaterial = { preset: "satin", color: "#B8323F" };
const BLUSH: PartMaterial = { preset: "suede", color: "#E3A29C" };
const THREAD: PartMaterial = { preset: "cotton", color: "#6B4529" };

const sphere = (radius: number): Geometry => ({ type: "sphere", params: { radius, angle: 180 } });

// ---------- Head ----------

const HR = 0.072;
const HEAD: V3 = [0, 0.236, 0.006];
/** Unit direction from azimuth (around Y, 0 = front, + = viewer's right) and elevation, degrees. */
const dir = (az: number, el: number): V3 => [Math.sin(az * D) * Math.cos(el * D), Math.sin(el * D), Math.cos(az * D) * Math.cos(el * D)];
/** Euler XYZ (degrees) that turns +Z onto unit vector n. */
const face = (n: V3): V3 => [Math.atan2(-n[1], n[2]) / D, Math.asin(n[0]) / D, 0];
const onHead = (az: number, el: number, lift = 0): { p: V3; r: V3 } => {
  const n = dir(az, el);
  return { p: [n[0] * (HR + lift), n[1] * (HR + lift), n[2] * (HR + lift)], r: face(n) };
};

// Muzzle: a squashed sphere on the lower front of the head (head frame).
const MZ: V3 = [0, -0.017, 0.06];
const MA: V3 = [0.038, 0.028, 0.03];
/** A point on the muzzle's front surface (head frame), lifted slightly. */
const onMuzzle = (x: number, y: number): V3 => {
  const k = 1 - (x / MA[0]) ** 2 - ((y - MZ[1]) / MA[1]) ** 2;
  return [x, y, MZ[2] + MA[2] * Math.sqrt(Math.max(0, k)) + 0.0006];
};

// ---------- Body ----------

const BODY: V2[] = [[0, 0.002], [0.05, 0.004], [0.071, 0.017], [0.082, 0.045], [0.084, 0.075], [0.079, 0.106], [0.068, 0.135], [0.052, 0.16], [0.034, 0.178], [0, 0.186]];

function arm(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const L = sx > 0 ? "Right" : "Left";
  return [
    prim(`arm_${k}`, `${L} arm`, "body", { type: "capsule", params: { radius: 0.0225, length: 0.052 } }, FUR, [sx * 0.077, 0.108, 0.045], [-42, 0, sx * 13]),
    prim(`paw_${k}`, `${L} paw pad`, `arm_${k}`, sphere(0.016), LIGHT, [0, -0.0425, 0], [0, 0, 0], [1, 0.42, 1]),
  ];
}

function leg(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const L = sx > 0 ? "Right" : "Left";
  const parts: Part[] = [
    prim(`leg_${k}`, `${L} leg`, "body", { type: "capsule", params: { radius: 0.03, length: 0.046 } }, FUR, [sx * 0.05, 0.03, 0.07], [90, 0, -sx * 10]),
    prim(`foot_pad_${k}`, `${L} foot pad`, `leg_${k}`, sphere(0.02), LIGHT, [0, 0.0455, 0], [0, 0, 0], [1, 0.42, 1.1]),
  ];
  // Three toe beans above the pad, on the rounded end of the leg (leg frame: +Y out of the sole, -Z is up).
  for (const [i, a] of [[0, -40], [1, 0], [2, 40]] as const) {
    const ang = (90 - a) * D;
    const rr = 0.0235;
    const n: V3 = [Math.cos(ang) * rr, Math.sqrt(0.03 ** 2 - rr ** 2), -Math.sin(ang) * rr];
    parts.push(prim(`toe_${k}_${i}`, `${L} toe pad`, `leg_${k}`, sphere(0.0055), LIGHT, [n[0] * 0.97, 0.023 + n[1] * 0.97, n[2] * 0.97]));
  }
  return parts;
}

function ear(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const L = sx > 0 ? "Right" : "Left";
  return [
    prim(`ear_${k}`, `${L} ear`, "head", sphere(0.026), FUR, [sx * 0.053, 0.053, -0.006], [0, 0, -sx * 22], [1, 1, 0.48]),
    prim(`inner_ear_${k}`, `${L} inner ear`, "head", sphere(0.0165), LIGHT, [sx * 0.054, 0.051, 0.0025], [0, 0, -sx * 22], [1, 1, 0.42]),
  ];
}

const eye = (sx: 1 | -1): Part => {
  const m = onHead(sx * 24, 13, -0.0004);
  return kit(`eye_${sx > 0 ? "r" : "l"}`, `${sx > 0 ? "Right" : "Left"} eye`, "head", "button_sewn", EYE, m.p, m.r, { radius: 0.0078 });
};

const cheek = (sx: 1 | -1): Part => {
  const m = onHead(sx * 40, -10, -0.0025);
  return prim(`cheek_${sx > 0 ? "r" : "l"}`, `${sx > 0 ? "Right" : "Left"} cheek`, "head", sphere(0.012), BLUSH, m.p, m.r, [1, 0.8, 0.25]);
};

const WING: V2[] = [[0.004, 0.0045], [0.02, 0.012], [0.036, 0.017], [0.043, 0.006], [0.043, -0.006], [0.036, -0.017], [0.02, -0.012], [0.004, -0.0045]];
const NECK_Y = 0.174;

// ---------- Assembly ----------

const parts: Part[] = [
  prim("body", "Body", null, { type: "lathe", params: { points: BODY, angle: 360, segments: 96, sharp: false } }, FUR, [0, 0, 0], [0, 0, 0]),
  prim("tummy", "Tummy patch", "body", sphere(0.05), LIGHT, [0, 0.078, 0.07], [-8, 0, 0], [0.92, 1.08, 0.3]),
  kit("tummy_seam", "Tummy seam", "body", "stitching", THREAD, [0, 0.082, 0.0855], [-8, 0, 90], { length: 0.064 }),
  prim("tail", "Tail", "body", sphere(0.02), FUR, [0, 0.035, -0.08], [0, 0, 0], [1, 0.95, 0.8]),
  ...arm(-1),
  ...arm(1),
  ...leg(-1),
  ...leg(1),

  prim("head", "Head", "body", sphere(HR), FUR, HEAD),
  prim("muzzle", "Muzzle", "head", sphere(1), LIGHT, MZ, [0, 0, 0], MA),
  prim("nose", "Nose", "head", sphere(0.0105), NOSE, onMuzzle(0, -0.004).map((c, i) => (i === 2 ? c - 0.004 : c)) as V3, [12, 0, 0], [1.45, 0.92, 0.85]),
  prim("nose_stitch", "Nose stitch", "head", { type: "tube", params: { points: [onMuzzle(0, -0.012), onMuzzle(0, -0.017), onMuzzle(0, -0.0215)].map(v), radius: 0.0011, closed: false, sharp: false } }, THREAD),
  prim("mouth", "Mouth", "head", { type: "tube", params: { points: [onMuzzle(-0.012, -0.0185), onMuzzle(-0.0065, -0.0245), onMuzzle(0, -0.0215), onMuzzle(0.0065, -0.0245), onMuzzle(0.012, -0.0185)].map(v), radius: 0.0011, closed: false, sharp: false } }, THREAD),
  eye(-1),
  eye(1),
  cheek(-1),
  cheek(1),
  ...ear(-1),
  ...ear(1),

  // Satin ribbon around the neck, tied in a bow at the front.
  prim("ribbon", "Neck ribbon", "body", { type: "torus", params: { radius: 0.041, tube: 0.0045, arc: 360 } }, BOW, [0, NECK_Y, 0.003], [90, 0, 0], [1, 1, 1.6]),
  prim("bow_knot", "Bow knot", "body", sphere(0.0105), BOW, [0, NECK_Y, 0.05], [0, 0, 0], [1, 1.05, 0.75]),
  prim("bow_right", "Right bow loop", "body", { type: "extrude", params: { shape: WING, depth: 0.011, bevel: 0.004, smooth: true } }, BOW, [0, NECK_Y, 0.045], [0, 0, -8]),
  prim("bow_left", "Left bow loop", "body", { type: "extrude", params: { shape: WING, depth: 0.011, bevel: 0.004, smooth: true } }, BOW, [0, NECK_Y, 0.045], [0, 180, 8]),
];

export const teddyBear: Template | null = {
  id: "teddy_bear",
  name: "Classic Plush Teddy Bear",
  keywords: ["teddy bear", "teddy", "plush", "plushie", "stuffed animal", "stuffed bear", "toy bear", "soft toy", "bear"],
  category: "teddy bear",
  description: "Classic 30 cm plush teddy bear with soft caramel fur, cream muzzle and paw pads, button eyes, a stitched nose and a satin bow tie",
  targetPriceUsd: 39,
  parts,
};
