import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: modern three-seat sofa, facing +Z, 2.14 m wide, 0.92 m deep, 0.84 m tall.
 * The base frame (root) is the upholstered plinth between the arms; its origin is its center,
 * BASE_Y above the floor, and every child is placed in floor coordinates via F(). Three seat
 * cushions sit on the base, three loose back cushions lean on the back frame, and each cushion has a
 * tonal welt (piping) running around its seam. Two throw pillows rest in the corners; tapered
 * walnut legs with brass ferrules stand under the arms.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

const FABRIC: PartMaterial = { preset: "knit", color: "#5F6B5A" };
const PILLOW_CREAM: PartMaterial = { preset: "cotton", color: "#E8DFCC" };
const PILLOW_RUST: PartMaterial = { preset: "suede", color: "#B4643C" };
const WALNUT: PartMaterial = { preset: "wood", color: "#5C3A21" };
const BRASS: PartMaterial = { preset: "metal_polished", color: "#C9A66B" };
const SHADOW: PartMaterial = { preset: "plastic_matte", color: "#1E1F21" };

// ---------- Dimensions (floor coordinates, meters) ----------

const LEG_H = 0.15;
const BASE_W = 1.8, BASE_H = 0.15, BASE_D = 0.9;
const BASE_Y = LEG_H + BASE_H / 2;
const DECK = LEG_H + BASE_H; // top of the base, where the seat cushions rest
const ARM_W = 0.16, ARM_H = 0.47, ARM_D = 0.92, ARM_R = 0.065;
const ARM_X = BASE_W / 2 + ARM_W / 2;
const SEAT_W = 0.594, SEAT_H = 0.16, SEAT_D = 0.72, SEAT_R = 0.045;
const SEAT_Z = 0.11;
const BACK_W = 0.594, BACK_H = 0.43, BACK_D = 0.2, BACK_R = 0.075;
const BACK_TILT = -11;

/** Floor coordinates -> the base frame's local frame. */
const F = (x: number, y: number, z: number): V3 => [x, y - BASE_Y, z];

/** Closed rounded-rectangle loop in a plane: `a` and `b` are the half extents along two axes. */
function loop(a: number, b: number, r: number, map: (u: number, w: number) => V3): V3[] {
  const out: V3[] = [];
  const corners: [number, number, number][] = [[a - r, b - r, 0], [-(a - r), b - r, 90], [-(a - r), -(b - r), 180], [a - r, -(b - r), 270]];
  for (const [cu, cw, a0] of corners)
    for (let i = 0; i <= 4; i++) {
      const t = ((a0 + (90 * i) / 4) * Math.PI) / 180;
      out.push(v(map(cu + Math.cos(t) * r, cw + Math.sin(t) * r)));
    }
  return out;
}

/** Welt running along a roundedBox's rounded edge (the seam where the top panel meets the boxing). */
const EDGE = (r: number) => r * (1 - Math.SQRT1_2);

/** Puffy square pillow outline: slightly pinched edges between plump corners. */
function pillowOutline(s: number): V2[] {
  const out: V2[] = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), sn = Math.sin(t);
    // Superellipse, pinched in the middle of each edge.
    const e = 2 / 3.4;
    const x = Math.sign(c) * Math.abs(c) ** e;
    const y = Math.sign(sn) * Math.abs(sn) ** e;
    const pinch = 1 - 0.05 * (1 - Math.abs(Math.sin(2 * t)));
    out.push([r4((x * s * pinch) / 2), r4((y * s * pinch) / 2)]);
  }
  return out;
}

// ---------- Cushions ----------

function seatCushion(i: number): Part[] {
  const x = (i - 1) * (SEAT_W + 0.006);
  const id = `seat_cushion_${i + 1}`;
  const label = ["Left", "Middle", "Right"][i];
  const e = EDGE(SEAT_R);
  return [
    prim(id, `${label} seat cushion`, "base", { type: "roundedBox", params: { width: SEAT_W, height: SEAT_H, depth: SEAT_D, radius: SEAT_R } }, FABRIC, F(x, DECK + SEAT_H / 2 - 0.004, SEAT_Z)),
    prim(`${id}_welt`, `${label} seat welt`, id, { type: "tube", params: { points: loop(SEAT_W / 2 - e, SEAT_D / 2 - e, SEAT_R * 0.75, (u, w) => [u, SEAT_H / 2 - e, w]), radius: 0.0045, closed: true, sharp: false } }, FABRIC),
  ];
}

function backCushion(i: number): Part[] {
  const x = (i - 1) * (BACK_W + 0.006);
  const id = `back_cushion_${i + 1}`;
  const label = ["Left", "Middle", "Right"][i];
  const e = EDGE(BACK_R);
  return [
    prim(id, `${label} back cushion`, "base", { type: "roundedBox", params: { width: BACK_W, height: BACK_H, depth: BACK_D, radius: BACK_R } }, FABRIC, F(x, DECK + SEAT_H + BACK_H / 2 - 0.035, -0.17), [BACK_TILT, 0, 0]),
    prim(`${id}_welt`, `${label} back welt`, id, { type: "tube", params: { points: loop(BACK_W / 2 - e, BACK_H / 2 - e, BACK_R * 0.75, (u, w) => [u, w, BACK_D / 2 - e]), radius: 0.0045, closed: true, sharp: false } }, FABRIC),
  ];
}

function arm(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "right" : "left";
  const L = sx > 0 ? "Right" : "Left";
  const e = EDGE(ARM_R);
  return [
    prim(`arm_${k}`, `${L} arm`, "base", { type: "roundedBox", params: { width: ARM_W, height: ARM_H, depth: ARM_D, radius: ARM_R } }, FABRIC, F(sx * ARM_X, LEG_H + ARM_H / 2, 0)),
    // Welt around the arm's outside panel.
    prim(`arm_${k}_welt`, `${L} arm welt`, `arm_${k}`, { type: "tube", params: { points: loop(ARM_D / 2 - e, ARM_H / 2 - e, ARM_R * 0.75, (u, w) => [sx * (ARM_W / 2 - e), w, u]), radius: 0.0045, closed: true, sharp: false } }, FABRIC),
  ];
}

const SPLAY = 7; // degrees the legs lean out
function leg(id: string, name: string, x: number, z: number): Part[] {
  const ax = -Math.sign(z) * SPLAY, az = Math.sign(x) * SPLAY;
  const len = LEG_H / Math.cos((SPLAY * Math.PI) / 180) + 0.006;
  // Top of the leg at the base underside; the leg leans out so its foot lands further out.
  const dx = Math.sin((az * Math.PI) / 180) * len / 2, dz = -Math.sin((ax * Math.PI) / 180) * len / 2;
  return [
    prim(id, name, "base", { type: "cylinder", params: { radiusTop: 0.021, radiusBottom: 0.0125, height: len, bevel: 0.002, open: false } }, WALNUT, F(x + dx, LEG_H + 0.004 - len / 2, z + dz), [ax, 0, az]),
    prim(`${id}_cap`, `${name} ferrule`, id, { type: "cylinder", params: { radiusTop: 0.0133, radiusBottom: 0.0128, height: 0.02, bevel: 0.0015, open: false } }, BRASS, [0, -len / 2 + 0.0095, 0]),
  ];
}

function pillow(sx: 1 | -1, mat: PartMaterial): Part {
  const k = sx > 0 ? "right" : "left";
  return prim(`pillow_${k}`, `${sx > 0 ? "Right" : "Left"} throw pillow`, "base", { type: "extrude", params: { shape: pillowOutline(0.47), depth: 0.17, bevel: 0.07, smooth: true } }, mat, F(sx * 0.64, DECK + SEAT_H + 0.2, 0.0), [-14, -sx * 14, sx * 4]);
}

// ---------- Assembly ----------

const parts: Part[] = [
  prim("base", "Base frame", null, { type: "roundedBox", params: { width: BASE_W, height: BASE_H, depth: BASE_D, radius: 0.025 } }, FABRIC, [0, BASE_Y, 0]),
  prim("back_frame", "Back frame", "base", { type: "roundedBox", params: { width: BASE_W + 0.02, height: 0.38, depth: 0.18, radius: 0.05 } }, FABRIC, F(0, DECK + 0.19, -BASE_D / 2 + 0.09)),
  ...arm(-1),
  ...arm(1),
  ...seatCushion(0),
  ...seatCushion(1),
  ...seatCushion(2),
  ...backCushion(0),
  ...backCushion(1),
  ...backCushion(2),
  pillow(-1, PILLOW_CREAM),
  pillow(1, PILLOW_RUST),
  ...leg("leg_front_left", "Front left leg", -ARM_X + 0.01, 0.38),
  ...leg("leg_front_right", "Front right leg", ARM_X - 0.01, 0.38),
  ...leg("leg_back_left", "Back left leg", -ARM_X + 0.01, -0.38),
  ...leg("leg_back_right", "Back right leg", ARM_X - 0.01, -0.38),
  prim("center_leg_front", "Center support leg", "base", { type: "cylinder", params: { radiusTop: 0.016, radiusBottom: 0.014, height: LEG_H, bevel: 0.002, open: false } }, SHADOW, F(0, LEG_H / 2, 0.16)),
  prim("center_leg_back", "Center support leg", "base", { type: "cylinder", params: { radiusTop: 0.016, radiusBottom: 0.014, height: LEG_H, bevel: 0.002, open: false } }, SHADOW, F(0, LEG_H / 2, -0.25)),
];

export const sofa: Template | null = {
  id: "sofa",
  name: "Modern Three-Seat Sofa",
  keywords: ["sofa", "couch", "loveseat", "love seat", "sectional", "settee", "three seater sofa", "3 seater sofa", "sofa couch"],
  category: "sofa",
  description: "Modern three-seat sofa in sage knit upholstery with piped seat and back cushions, track arms, two throw pillows and tapered walnut legs with brass caps",
  targetPriceUsd: 1499,
  parts,
};
