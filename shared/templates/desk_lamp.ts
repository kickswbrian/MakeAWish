import type { Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a spring-balanced architect's task lamp.
 * The arm works in the XY plane (side profile faces the viewer); the root is the weighted base,
 * origin on the axis at its underside. Arms, springs and cords are tubes written in base coordinates.
 */

type V3 = [number, number, number];
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const v3 = (x: number, y: number, z: number): V3 => [r4(x), r4(y), r4(z)];
const ID = { rotation: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 };

const PAINT: PartMaterial = { preset: "metal_brushed", color: "#C4583A", roughness: 0.55, metalness: 0.35 };
const BRASS: PartMaterial = { preset: "metal_polished", color: "#C9A15A" };
const RUBBER: PartMaterial = { preset: "rubber", color: "#2B2B2D" };
const CORD: PartMaterial = { preset: "cotton", color: "#EDE5D6" };

// Joint centers (base frame, meters).
const P0: [number, number] = [0, 0.064]; // base pivot
const P1: [number, number] = [-0.075, 0.33]; // elbow
const P2: [number, number] = [0.17, 0.4]; // head
// Shade orientation: leans back toward the arm (Z) and turns its glowing mouth toward the viewer (X).
const SHADE_ROT: V3 = [-55, 0, 30];
const NECK = 0.115; // neck pivot height in the shade's frame
/** Rotate v by Euler XYZ degrees (three.js order: R = Rx * Ry * Rz). */
function rotate([x, y, z]: V3, [ax, ay, az]: V3): V3 {
  const [a, b, c] = [ax, ay, az].map((d) => (d * Math.PI) / 180);
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  return [x, y, z];
}
const neckDir = rotate([0, NECK, 0], SHADE_ROT);
const SHADE_AT: V3 = v3(P2[0] - neckDir[0], P2[1] - neckDir[1], -neckDir[2]);

const rod = (id: string, name: string, a: [number, number], b: [number, number], z: number, radius: number): Part => ({
  id, name, kind: "primitive", parent: "lamp_base",
  geometry: { type: "tube", params: { points: [v3(a[0], a[1], z), v3(b[0], b[1], z)], radius, closed: false, sharp: true } },
  transform: { position: [0, 0, 0], ...ID },
  material: PAINT,
});

const hub = (id: string, name: string, at: [number, number], radius: number, length: number, material: PartMaterial): Part => ({
  id, name, kind: "primitive", parent: "lamp_base",
  geometry: { type: "cylinder", params: { radiusTop: radius, radiusBottom: radius, height: length, bevel: 0.0015, open: false } },
  transform: { position: v3(at[0], at[1], 0), rotation: [90, 0, 0], scale: [1, 1, 1] },
  material,
});

const knob = (id: string, name: string, at: [number, number], z: number, radius: number, back = false): Part => ({
  id, name, kind: "kit", kitAsset: "knob", kitParams: { radius }, parent: "lamp_base",
  transform: { position: v3(at[0], at[1], z), rotation: [0, back ? 180 : 0, 0], scale: [1, 1, 1] },
  material: BRASS,
});

/** A closed-coil tension spring running from t0 to t1 along the lower arm, centered at depth z. */
function spring(id: string, name: string, z: number): Part {
  const dx = P1[0] - P0[0], dy = P1[1] - P0[1];
  const len = Math.hypot(dx, dy);
  const u = [dx / len, dy / len];
  const v = [-u[1], u[0]];
  const t0 = 0.016, t1 = 0.118, coils = 13, per = 6, r = 0.0042;
  const pts: V3[] = [v3(P0[0] + u[0] * 0.004, P0[1] + u[1] * 0.004, z)];
  for (let i = 0; i <= coils * per; i++) {
    const t = t0 + ((t1 - t0) * i) / (coils * per);
    const a = (i / per) * Math.PI * 2;
    pts.push(v3(P0[0] + u[0] * t + v[0] * Math.cos(a) * r, P0[1] + u[1] * t + v[1] * Math.cos(a) * r, z + Math.sin(a) * r));
  }
  pts.push(v3(P0[0] + u[0] * 0.128, P0[1] + u[1] * 0.128, z));
  return {
    id, name, kind: "primitive", parent: "lamp_base",
    geometry: { type: "tube", params: { points: pts, radius: 0.00085, closed: false, sharp: false } },
    transform: { position: [0, 0, 0], ...ID },
    material: { preset: "metal_polished", color: "#D5D8DD" },
  };
}

const along = (t: number): [number, number] => {
  const dx = P1[0] - P0[0], dy = P1[1] - P0[1];
  const len = Math.hypot(dx, dy);
  return [P0[0] + (dx / len) * t, P0[1] + (dy / len) * t];
};
const SPRING_TOP = along(0.128);

export const deskLamp: Template = {
  id: "desk_lamp",
  name: "Architect Desk Lamp",
  keywords: ["desk lamp", "lamp", "table lamp", "reading lamp", "task lamp", "architect lamp", "nightlight", "night light", "study lamp"],
  category: "desk lamp",
  description: "Spring-balanced architect's task lamp with a weighted base, twin-rod arms, brass tension knobs, a dome shade and a warm dimmable bulb.",
  targetPriceUsd: 129,
  parts: [
    {
      id: "lamp_base", name: "Lamp base", kind: "primitive", parent: null,
      geometry: {
        type: "lathe",
        params: { points: [[0, 0], [0.068, 0], [0.0735, 0.0025], [0.0752, 0.009], [0.0737, 0.0175], [0.0665, 0.0232], [0.03, 0.0258], [0, 0.026]], angle: 360, segments: 128, sharp: false },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: PAINT,
    },
    {
      id: "base_foot", name: "Rubber foot ring", kind: "primitive", parent: "lamp_base",
      geometry: { type: "cylinder", params: { radiusTop: 0.069, radiusBottom: 0.0675, height: 0.003, bevel: 0.001, open: false } },
      transform: { position: [0, -0.0012, 0], ...ID },
      material: RUBBER,
    },
    {
      id: "base_ring", name: "Brass base ring", kind: "primitive", parent: "lamp_base",
      geometry: { type: "torus", params: { radius: 0.0745, tube: 0.0013, arc: 360 } },
      transform: { position: [0, 0.009, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    {
      id: "base_badge", name: "Brand badge", kind: "primitive", parent: "lamp_base",
      geometry: { type: "roundedBox", params: { width: 0.02, height: 0.006, depth: 0.0016, radius: 0.0007 } },
      transform: { position: [0, 0.0115, 0.0753], rotation: [-6, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    {
      id: "power_switch", name: "Power switch", kind: "kit", kitAsset: "toggle_switch", parent: "lamp_base",
      transform: { position: [0, 0.0251, 0.044], rotation: [-90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "plastic_gloss", color: "#2B2B2D" },
    },
    {
      id: "swivel", name: "Swivel turret", kind: "primitive", parent: "lamp_base",
      geometry: { type: "cylinder", params: { radiusTop: 0.0155, radiusBottom: 0.018, height: 0.018, bevel: 0.002, open: false } },
      transform: { position: [0, 0.033, 0], ...ID },
      material: PAINT,
    },
    {
      id: "swivel_collar", name: "Swivel collar", kind: "primitive", parent: "lamp_base",
      geometry: { type: "torus", params: { radius: 0.018, tube: 0.0018, arc: 360 } },
      transform: { position: [0, 0.0262, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    {
      id: "yoke", name: "Pivot yoke", kind: "primitive", parent: "lamp_base",
      geometry: { type: "roundedBox", params: { width: 0.024, height: 0.034, depth: 0.036, radius: 0.007 } },
      transform: { position: [0, 0.0555, 0], ...ID },
      material: PAINT,
    },
    {
      id: "base_pivot", name: "Base pivot pin", kind: "primitive", parent: "lamp_base",
      geometry: { type: "cylinder", params: { radiusTop: 0.006, radiusBottom: 0.006, height: 0.05, bevel: 0.0015, open: false } },
      transform: { position: v3(P0[0], P0[1], 0), rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    rod("lower_arm", "Lower arm", P0, P1, 0.008, 0.0048),
    rod("lower_arm_rear", "Lower arm rear rod", P0, P1, -0.008, 0.0048),
    spring("spring_front", "Front tension spring", 0.0195),
    spring("spring_rear", "Rear tension spring", -0.0195),
    {
      id: "spring_pin", name: "Spring anchor pin", kind: "primitive", parent: "lamp_base",
      geometry: { type: "cylinder", params: { radiusTop: 0.0026, radiusBottom: 0.0026, height: 0.05, bevel: 0.0008, open: false } },
      transform: { position: v3(SPRING_TOP[0], SPRING_TOP[1], 0), rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    hub("elbow", "Elbow joint", P1, 0.0125, 0.03, PAINT),
    knob("elbow_knob", "Elbow tension knob", P1, 0.0149, 0.0105),
    knob("elbow_knob_rear", "Elbow rear knob", P1, -0.0149, 0.0085, true),
    rod("upper_arm", "Upper arm", P1, P2, 0.008, 0.0042),
    rod("upper_arm_rear", "Upper arm rear rod", P1, P2, -0.008, 0.0042),
    hub("head_joint", "Head joint", P2, 0.0105, 0.028, PAINT),
    knob("head_knob", "Head tilt knob", P2, 0.0139, 0.009),
    {
      id: "shade", name: "Lamp shade", kind: "primitive", parent: "lamp_base",
      geometry: {
        type: "lathe",
        params: {
          // Inner surface out to the rolled rim, then the outer dome back up to the neck.
          points: [
            [0, 0.074], [0.018, 0.0733], [0.032, 0.0668], [0.048, 0.0528], [0.0618, 0.0332], [0.0698, 0.0142], [0.0722, 0.0035],
            [0.0732, -0.0004], [0.0746, 0.0012], [0.0747, 0.004], [0.0724, 0.0155], [0.0645, 0.0355], [0.0505, 0.0565],
            [0.0345, 0.0705], [0.0225, 0.0775], [0.0178, 0.0828], [0.0168, 0.0925], [0.0155, 0.0975], [0, 0.0985],
          ],
          angle: 360, segments: 128, sharp: false,
        },
      },
      transform: { position: SHADE_AT, rotation: SHADE_ROT, scale: [1, 1, 1] },
      material: PAINT,
    },
    {
      id: "shade_lining", name: "Shade lining", kind: "primitive", parent: "shade",
      geometry: {
        type: "lathe",
        params: { points: [[0.0712, 0.0042], [0.0688, 0.0145], [0.0607, 0.0335], [0.0471, 0.0526], [0.0316, 0.0656], [0.0178, 0.0719], [0.0125, 0.0722]], angle: 360, segments: 128, sharp: false },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: { preset: "plastic_matte", color: "#FFF6E8", emissive: "#FFD9A8", emissiveIntensity: 0.9 },
    },
    {
      id: "shade_rim", name: "Shade rim", kind: "primitive", parent: "shade",
      geometry: { type: "torus", params: { radius: 0.0739, tube: 0.0016, arc: 360 } },
      transform: { position: [0, 0.0006, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: BRASS,
    },
    {
      id: "shade_neck", name: "Shade neck", kind: "primitive", parent: "shade",
      geometry: { type: "cylinder", params: { radiusTop: 0.0085, radiusBottom: 0.0118, height: 0.024, bevel: 0.0015, open: false } },
      transform: { position: [0, 0.105, 0], ...ID },
      material: BRASS,
    },
    {
      id: "bulb_socket", name: "Bulb socket", kind: "primitive", parent: "shade",
      geometry: { type: "cylinder", params: { radiusTop: 0.0125, radiusBottom: 0.0115, height: 0.022, bevel: 0.0015, open: false } },
      transform: { position: [0, 0.064, 0], ...ID },
      material: { preset: "plastic_matte", color: "#2B2B2D" },
    },
    {
      id: "bulb", name: "Light bulb", kind: "kit", kitAsset: "bulb", parent: "shade",
      transform: { position: [0, 0.0535, 0], rotation: [180, 0, 0], scale: [0.48, 0.48, 0.48] },
      material: { preset: "glass", color: "#FFD49A", emissive: "#FFC27A", emissiveIntensity: 2.5 },
    },
    {
      id: "arm_cord", name: "Fabric cord", kind: "primitive", parent: "lamp_base",
      geometry: {
        type: "tube",
        params: {
          points: [
            v3(P2[0] - 0.004, P2[1] - 0.006, -0.012), [0.112, 0.37, -0.0145], [0.04, 0.352, -0.0155], [-0.04, 0.33, -0.0155],
            [-0.084, 0.316, -0.0165], [-0.074, 0.27, -0.0165], [-0.052, 0.19, -0.0165], [-0.026, 0.11, -0.0155], [-0.008, 0.058, -0.0145],
          ],
          radius: 0.0021, closed: false, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: CORD,
    },
    {
      id: "power_cord", name: "Power cord", kind: "primitive", parent: "lamp_base",
      geometry: {
        type: "tube",
        params: { points: [[0, 0.0075, -0.07], [0, 0.0045, -0.084], [0.004, -0.0006, -0.104], [0.024, -0.0006, -0.142], [0.064, -0.0006, -0.17], [0.11, -0.0006, -0.18]], radius: 0.0021, closed: false, sharp: false },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: CORD,
    },
    {
      id: "cord_grommet", name: "Cord strain relief", kind: "primitive", parent: "lamp_base",
      geometry: { type: "cylinder", params: { radiusTop: 0.0034, radiusBottom: 0.0044, height: 0.012, bevel: 0.001, open: false } },
      transform: { position: [0, 0.0085, -0.0735], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: RUBBER,
    },
  ],
};
