import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: complete popsicle skateboard, deck long axis along X (nose at +X), width along Z.
 * The deck (root) is its side profile (x, y) extruded across the width; the flat middle has its
 * mid-thickness at y = 0, and the nose and tail kick up ~5 cm. Invisible cutters trim the rounded
 * nose and tail in plan view. Trucks sit at x = +-0.18 under the deck (bottom face y = -0.0055),
 * axles at y = -0.0555, 54 mm urethane wheels (lathes, axis along Z), floor at y = -0.0825.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

const DECK: PartMaterial = { preset: "wood", color: "#E4683C" };
const GRIP: PartMaterial = { preset: "rubber", color: "#232427" };
const TRUCK: PartMaterial = { preset: "metal_brushed", color: "#C9CDD3" };
const STEEL: PartMaterial = { preset: "metal_polished", color: "#DADDE2" };
const URETHANE: PartMaterial = { preset: "rubber", color: "#F3E7CB" };
const BUSHING: PartMaterial = { preset: "rubber", color: "#F2B33D" };
const INK_CREAM: PartMaterial = { preset: "plastic_matte", color: "#F4E3C1" };
const INK_NAVY: PartMaterial = { preset: "plastic_matte", color: "#1F2A44" };

// ---------- Deck profile ----------

const T = 0.011; // deck thickness
const W = 0.205; // deck width
const FLAT = 0.235; // half-length of the flat section
const RK = 0.15; // kick bend radius
const KICK = (20 * Math.PI) / 180; // kick angle
const TIP = 0.4; // plan-view half-length
const BEND = RK * Math.sin(KICK);

/** Center line height and slope at |x|. */
function center(ax: number): { y: number; slope: number } {
  if (ax <= FLAT) return { y: 0, slope: 0 };
  const d = ax - FLAT;
  if (d <= BEND) {
    const y = RK - Math.sqrt(RK * RK - d * d);
    return { y, slope: d / Math.sqrt(RK * RK - d * d) };
  }
  return { y: RK * (1 - Math.cos(KICK)) + (d - BEND) * Math.tan(KICK), slope: Math.tan(KICK) };
}

/** Sample x stations (dense in the bends), from tail to nose. */
function stations(): number[] {
  const half: number[] = [0, 0.12, FLAT - 0.04];
  for (let i = 0; i <= 8; i++) half.push(FLAT + (BEND * i) / 8);
  for (let i = 1; i <= 6; i++) half.push(FLAT + BEND + ((TIP + 0.006 - FLAT - BEND) * i) / 6);
  const neg = half.slice(1).map((x) => -x).reverse();
  return [...neg, ...half];
}

/** A strip offset from the deck's center line between normal offsets a (below) and b (above). */
function strip(a: number, b: number): V2[] {
  const xs = stations();
  const at = (x: number, off: number): V2 => {
    const { y, slope } = center(Math.abs(x));
    const s = Math.sign(x) * slope;
    const l = Math.hypot(1, s);
    return [r4(x - (s / l) * off), r4(y + off / l)];
  };
  const bottom = xs.map((x) => at(x, a));
  const top = xs.map((x) => at(x, b)).reverse();
  return [...bottom, ...top];
}

/** U-shaped plan-view cutter around one end: removes everything outside the rounded nose. */
function endCutter(inset: number): V2[] {
  const w = W / 2 - inset;
  const x0 = 0.29;
  const ax = TIP - inset - x0;
  const curve: V2[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (Math.PI / 2) * (1 - i / 14); // from the side (+z) round to the tip
    curve.push([r4(x0 + Math.sin(Math.PI / 2 - a) * ax), r4(Math.sin(a) * w)]);
  }
  const mirrored = curve.slice(0, -1).map(([x, z]): V2 => [x, -z]).reverse();
  return [[0.27, 0.16], [0.27, r4(w + 0.002)], [x0, r4(w + 0.002)], ...curve, ...mirrored, [x0, r4(-w - 0.002)], [0.27, r4(-w - 0.002)], [0.27, -0.16], [0.47, -0.16], [0.47, 0.16]];
}

const cutter = (id: string, name: string, target: string, inset: number, nose: boolean): Part => ({
  ...prim(id, name, "deck", { type: "extrude", params: { shape: endCutter(inset), depth: 0.24, bevel: 0, smooth: false } }, GRIP, [0, 0.05, 0], [90, nose ? 0 : 180, 0]),
  csg: { op: "subtract", withPartId: target },
});

// ---------- Trucks ----------

const AXLE_Y = -0.0555;
const DECK_BOTTOM = -T / 2;
const HANGER: V2[] = [
  [-0.066, -0.008], [0.066, -0.008], [0.069, -0.004], [0.069, 0.006], [0.064, 0.0095], [0.03, 0.017], [0.015, 0.026], [0, 0.028],
  [-0.015, 0.026], [-0.03, 0.017], [-0.064, 0.0095], [-0.069, 0.006], [-0.069, -0.004],
];

/** Urethane wheel profile [r, y]: rounded lips, flat contact patch, recessed bearing seats. */
const WHEEL: V2[] = (() => {
  const half: V2[] = [[0.0102, 0.0122], [0.0112, 0.0158], [0.0125, 0.0172], [0.0205, 0.0174]];
  for (let i = 1; i <= 5; i++) {
    const a = (Math.PI / 2) * (i / 5);
    half.push([r4(0.0205 + Math.sin(a) * 0.0065), r4(0.0174 - (1 - Math.cos(a)) * 0.0065 - Math.sin(a) * 0.001)]);
  }
  half.push([0.027, 0.006]);
  const top = half.reverse();
  const bottom = top.map(([r, y]): V2 => [r, r4(-y)]).reverse();
  return [[0, -0.0122], ...bottom, ...top, [0, 0.0122]];
})();

function truck(s: 1 | -1): Part[] {
  const k = s > 0 ? "front" : "back";
  const L = s > 0 ? "Front" : "Back";
  const x0 = s * 0.18;
  const tilt = -s * 35;
  const ax = Math.sin((35 * Math.PI) / 180), ay = Math.cos((35 * Math.PI) / 180);
  const bx = x0 - s * 0.011, by = -0.023;
  const out: Part[] = [
    prim(`baseplate_${k}`, `${L} truck baseplate`, "deck", { type: "roundedBox", params: { width: 0.07, height: 0.008, depth: 0.056, radius: 0.0035 } }, TRUCK, [x0, DECK_BOTTOM - 0.0038, 0]),
    prim(`hanger_${k}`, `${L} truck hanger`, "deck", { type: "extrude", params: { shape: HANGER, depth: 0.026, bevel: 0.005, smooth: false } }, TRUCK, [x0, AXLE_Y, 0], [0, 90, 0]),
    prim(`pivot_${k}`, `${L} truck pivot`, "deck", { type: "capsule", params: { radius: 0.0055, length: 0.016 } }, TRUCK, [x0 + s * 0.012, -0.022, 0], [0, 0, s * 30]),
    prim(`bushing_${k}`, `${L} truck bushing`, "deck", { type: "cylinder", params: { radiusTop: 0.0115, radiusBottom: 0.0125, height: 0.024, bevel: 0.003, open: false } }, BUSHING, [bx, by, 0], [0, 0, tilt]),
    prim(`kingpin_nut_${k}`, `${L} kingpin nut`, "deck", { type: "cylinder", params: { radiusTop: 0.0068, radiusBottom: 0.0068, height: 0.006, bevel: 0.0008, open: false, segments: 6 } }, STEEL, [bx - s * ax * 0.0145, by - ay * 0.0145, 0], [0, 0, tilt]),
    prim(`axle_${k}`, `${L} axle`, "deck", { type: "cylinder", params: { radiusTop: 0.004, radiusBottom: 0.004, height: 0.204, bevel: 0.001, open: false } }, STEEL, [x0, AXLE_Y, 0], [90, 0, 0]),
  ];
  for (const sz of [1, -1] as const) {
    const side = sz > 0 ? "right" : "left";
    const wz = sz * 0.082;
    out.push(
      // Lathe axis (Y) turned onto the axle (Z); +Y faces away from the board on both sides.
      prim(`wheel_${k}_${side}`, `${L} ${side} wheel`, "deck", { type: "lathe", params: { points: WHEEL, angle: 360, segments: 72, sharp: true } }, URETHANE, [x0, AXLE_Y, wz], [sz * 90, 0, 0]),
      prim(`bearing_${k}_${side}`, `${L} ${side} bearing`, `wheel_${k}_${side}`, { type: "cylinder", params: { radiusTop: 0.0105, radiusBottom: 0.0105, height: 0.002, bevel: 0.0005, open: false } }, STEEL, [0, 0.0128, 0]),
      prim(`axle_nut_${k}_${side}`, `${L} ${side} axle nut`, `wheel_${k}_${side}`, { type: "cylinder", params: { radiusTop: 0.0048, radiusBottom: 0.0048, height: 0.006, bevel: 0.0007, open: false, segments: 6 } }, STEEL, [0, 0.016, 0]),
    );
  }
  // Mounting bolts through the grip tape.
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const id = `bolt_${k}_${dx > 0 ? "n" : "t"}${dz > 0 ? "r" : "l"}`;
    out.push(kit(id, `${L} truck bolt`, "deck", "screw", STEEL, [x0 + dx * 0.027, T / 2 + 0.0009, dz * 0.0205], [-90, 0, 0]));
  }
  return out;
}

// ---------- Assembly ----------

const parts: Part[] = [
  prim("deck", "Deck", null, { type: "extrude", params: { shape: strip(-T / 2, T / 2), depth: W, bevel: 0.0042, smooth: false } }, DECK, [0, 0, 0], [0, 0, 0]),
  cutter("deck_nose_cut", "Deck nose cut", "deck", 0, true),
  cutter("deck_tail_cut", "Deck tail cut", "deck", 0, false),
  prim("grip_tape", "Grip tape", "deck", { type: "extrude", params: { shape: strip(T / 2 - 0.0002, T / 2 + 0.0008), depth: W - 0.009, bevel: 0.0003, smooth: false } }, GRIP),
  cutter("grip_nose_cut", "Grip nose cut", "grip_tape", 0.0045, true),
  cutter("grip_tail_cut", "Grip tail cut", "grip_tape", 0.0045, false),

  // Printed graphic on the underside, between the trucks.
  prim("graphic_sun", "Graphic sun", "deck", { type: "cylinder", params: { radiusTop: 0.052, radiusBottom: 0.052, height: 0.0006, bevel: 0.0002, open: false } }, INK_CREAM, [0, DECK_BOTTOM - 0.0002, 0]),
  prim("graphic_stripe_top", "Graphic stripe", "deck", { type: "roundedBox", params: { width: 0.25, height: 0.0006, depth: 0.012, radius: 0.0002 } }, INK_NAVY, [0, DECK_BOTTOM - 0.0004, 0.034]),
  prim("graphic_stripe_bottom", "Graphic stripe", "deck", { type: "roundedBox", params: { width: 0.25, height: 0.0006, depth: 0.012, radius: 0.0002 } }, INK_NAVY, [0, DECK_BOTTOM - 0.0004, -0.034]),

  ...truck(1),
  ...truck(-1),
];

export const skateboard: Template | null = {
  id: "skateboard",
  name: "Street Skateboard Complete",
  keywords: ["skateboard", "skate board", "longboard", "penny board", "cruiser board"],
  category: "skateboard",
  description: "Complete 8-inch popsicle skateboard with a maple deck, black grip tape, printed underside graphic, brushed aluminium trucks and 54 mm urethane wheels",
  targetPriceUsd: 119,
  parts,
};
