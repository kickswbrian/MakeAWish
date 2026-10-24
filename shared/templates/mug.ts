import type { Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a premium stoneware mug (~350 ml) on a walnut coaster.
 * Mug body origin sits on the axis at the top of the unglazed foot; the handle is on +X.
 */

const CLAY: PartMaterial = { preset: "ceramic", color: "#ECE4D4" };
const ACCENT: PartMaterial = { preset: "ceramic", color: "#2F5D57" };
const RAW: PartMaterial = { preset: "concrete", color: "#C7B193" };
const WALNUT: PartMaterial = { preset: "wood", color: "#7A5133" };
const T0 = { rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };

const ring = (id: string, name: string, y: number, radius: number, tube: number, material: PartMaterial): Part => ({
  id, name, kind: "primitive", parent: "mug_body",
  geometry: { type: "torus", params: { radius, tube, arc: 360 } },
  transform: { position: [0, y, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
  material,
});

/** A glaze drip running down from the dipped rim, at angle deg around the mug (0 = front). */
const drip = (n: number, deg: number, len: number): Part => {
  const a = (deg * Math.PI) / 180;
  const r = 0.0419;
  return {
    id: `glaze_drip_${n}`, name: "Glaze drip", kind: "primitive", parent: "mug_body",
    geometry: { type: "capsule", params: { radius: 0.0023, length: len } },
    transform: { position: [Math.round(Math.sin(a) * r * 10000) / 10000, 0.0752 - len / 2, Math.round(Math.cos(a) * r * 10000) / 10000], rotation: [0, deg, 0], scale: [1, 1, 0.55] },
    material: ACCENT,
  };
};

const join = (id: string, name: string, pos: [number, number, number], rz: number): Part => ({
  id, name, kind: "primitive", parent: "mug_body",
  geometry: { type: "sphere", params: { radius: 0.0072, angle: 180 } },
  transform: { position: pos, rotation: [0, 0, rz], scale: [0.6, 1.3, 1.05] },
  material: CLAY,
});

export const mug: Template = {
  id: "mug",
  name: "Stoneware Mug",
  keywords: ["mug", "coffee mug", "cup", "coffee cup", "teacup", "tea cup", "latte mug", "espresso cup"],
  category: "mug",
  description: "Hand-thrown 350 ml stoneware mug with a pulled handle, rolled lip, glaze accents, raw clay foot and a walnut coaster.",
  targetPriceUsd: 34,
  parts: [
    {
      id: "mug_body", name: "Mug body", kind: "primitive", parent: null,
      geometry: {
        type: "lathe",
        params: {
          // Up the outside, over the lip, down the inside wall to the inner floor.
          points: [
            [0, 0], [0.0372, 0], [0.0392, 0.0018], [0.0408, 0.008], [0.0419, 0.025], [0.0425, 0.05], [0.0426, 0.075],
            [0.0421, 0.0905], [0.0410, 0.0925], [0.0396, 0.0905], [0.0394, 0.075], [0.0392, 0.05], [0.0385, 0.025],
            [0.0365, 0.0115], [0.03, 0.0088], [0, 0.0085],
          ],
          angle: 360,
          segments: 128,
          sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...T0 },
      material: CLAY,
    },
    {
      id: "foot_ring", name: "Unglazed foot", kind: "primitive", parent: "mug_body",
      geometry: { type: "lathe", params: { points: [[0, -0.0055], [0.0345, -0.0055], [0.0362, -0.0048], [0.0372, -0.003], [0.0377, 0.0005], [0, 0.0005]], angle: 360, segments: 128, sharp: false } },
      transform: { position: [0, 0, 0], ...T0 },
      material: RAW,
    },
    {
      id: "foot_groove", name: "Foot groove", kind: "primitive", parent: "mug_body",
      geometry: { type: "torus", params: { radius: 0.0374, tube: 0.0009, arc: 360 } },
      transform: { position: [0, 0.0004, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "ceramic", color: "#8E7A62" },
    },
    ring("rim", "Rolled lip", 0.0912, 0.0408, 0.0017, ACCENT),
    {
      id: "rim_dip", name: "Dipped glaze", kind: "primitive", parent: "mug_body",
      geometry: { type: "lathe", params: { points: [[0.04265, 0.0905], [0.04275, 0.083], [0.04285, 0.077], [0.04272, 0.0745]], angle: 360, segments: 128, sharp: false } },
      transform: { position: [0, 0, 0], ...T0 },
      material: ACCENT,
    },
    drip(1, -38, 0.0058),
    drip(2, 12, 0.0092),
    drip(3, 47, 0.0036),
    drip(4, 160, 0.0055),
    drip(5, 215, 0.0035),
    ring("glaze_band", "Glaze band", 0.0262, 0.0416, 0.001, ACCENT),
    ring("glaze_band_thin", "Thin glaze line", 0.0228, 0.0414, 0.0006, ACCENT),
    {
      id: "handle", name: "Handle", kind: "primitive", parent: "mug_body",
      geometry: {
        type: "tube",
        params: {
          points: [[0.0458, 0.0772], [0.0555, 0.0792], [0.0668, 0.0762], [0.0738, 0.0638], [0.074, 0.046], [0.0684, 0.0318], [0.0565, 0.0235], [0.0458, 0.0222]].map(([x, y]) => [x, y, 0] as [number, number, number]),
          radius: 0.0058,
          closed: false,
          sharp: false,
        },
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1.35] },
      material: CLAY,
    },
    join("handle_join_top", "Handle top join", [0.0447, 0.0772, 0], 8),
    join("handle_join_bottom", "Handle bottom join", [0.0444, 0.0222, 0], -8),
    {
      id: "coaster", name: "Walnut coaster", kind: "primitive", parent: "mug_body",
      geometry: { type: "cylinder", params: { radiusTop: 0.0545, radiusBottom: 0.0525, height: 0.009, bevel: 0.0022, open: false } },
      transform: { position: [0, -0.0099, 0], ...T0 },
      material: WALNUT,
    },
    {
      id: "coaster_inlay", name: "Cork inlay", kind: "primitive", parent: "coaster",
      geometry: { type: "cylinder", params: { radiusTop: 0.0465, radiusBottom: 0.0465, height: 0.0012, bevel: 0.0004, open: false } },
      transform: { position: [0, 0.0041, 0], ...T0 },
      material: { preset: "cork", color: "#B98E5E" },
    },
    {
      id: "coaster_groove", name: "Coaster groove", kind: "primitive", parent: "coaster",
      geometry: { type: "torus", params: { radius: 0.0478, tube: 0.0008, arc: 360 } },
      transform: { position: [0, 0.0043, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "wood", color: "#4E321F" },
    },
  ],
};
