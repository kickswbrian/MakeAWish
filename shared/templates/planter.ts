import type { Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a self-watering desk planter. A sage stoneware pot rests in a clear glass water
 * reservoir; a cotton wick hangs from the pot into the water, a float gauge pokes up through the
 * soil, and the whole thing sits on an oak base. Planted with a Pilea (coin plant).
 * Pot origin sits on the axis at the pot's underside; the reservoir and base hang below it.
 */

type V3 = [number, number, number];
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const ID = { rotation: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 };

const SAGE: PartMaterial = { preset: "ceramic", color: "#9CAF88" };
const OAK: PartMaterial = { preset: "wood", color: "#C29464" };
const GLASS: PartMaterial = { preset: "glass", color: "#EEF6F4" };
const LEAF_COLORS = ["#4F8A3C", "#5A9444", "#4A7F37", "#62994A"];
const SOIL_Y = 0.104;

/** Pilea leaves: [angle around the stem (deg), height on the stem, petiole length, leaf radius, outward tilt (deg)]. */
const LEAVES: [number, number, number, number, number][] = [
  [10, 0.006, 0.066, 0.027, 14],
  [147, 0.009, 0.068, 0.028, 12],
  [285, 0.013, 0.064, 0.026, 16],
  [62, 0.021, 0.058, 0.025, 20],
  [200, 0.026, 0.057, 0.0245, 18],
  [330, 0.032, 0.052, 0.023, 22],
  [105, 0.04, 0.046, 0.021, 26],
  [245, 0.046, 0.042, 0.0195, 28],
  [20, 0.053, 0.036, 0.018, 30],
  [160, 0.06, 0.03, 0.016, 34],
  [290, 0.066, 0.024, 0.0135, 38],
];

const STEM_TOP = 0.072;

/** A round Pilea leaf with a small drip tip, outline in XY (tip toward -Y = outward once laid flat). */
const leafOutline = (R: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * Math.PI * 2;
    const tip = i === 0 ? 1.12 : 1;
    pts.push([r4(Math.cos(a) * R * tip), r4(Math.sin(a) * R * tip)]);
  }
  return pts;
};

function leaf(i: number): Part[] {
  const [deg, h, L, R, tilt] = LEAVES[i];
  const n = i + 1;
  // Petiole frame: rotated about Y so the petiole runs out along local +Z.
  const petiole: Part = {
    id: `petiole_${n}`, name: `Leaf stalk ${n}`, kind: "primitive", parent: "stem",
    geometry: {
      type: "tube",
      params: { points: [[0, h, 0], [0, r4(h + L * 0.32), r4(L * 0.35)], [0, r4(h + L * 0.36), r4(L * 0.75)], [0, r4(h + L * 0.3), r4(L)]], radius: 0.0014, closed: false, sharp: false },
    },
    transform: { position: [0, 0, 0], rotation: [0, deg, 0], scale: [1, 1, 1] },
    material: { preset: "plastic_matte", color: "#7FA35A", roughness: 0.6 },
  };
  const blade: Part = {
    id: `leaf_${n}`, name: `Leaf ${n}`, kind: "primitive", parent: `petiole_${n}`,
    geometry: { type: "extrude", params: { shape: leafOutline(R), depth: 0.0014, bevel: 0.0006, smooth: true } },
    transform: { position: [0, r4(h + L * 0.3 + 0.0008), r4(L)], rotation: [-90 + tilt, 0, 0], scale: [1, 1, 1] },
    material: { preset: "plastic_matte", color: LEAF_COLORS[i % LEAF_COLORS.length], roughness: 0.45 },
  };
  return [petiole, blade];
}

const pebble = (id: string, x: number, z: number, r: number, rot: number): Part => ({
  id, name: "Pebble", kind: "primitive", parent: "soil",
  geometry: { type: "sphere", params: { radius: r, angle: 180 } },
  transform: { position: [x, 0.0012, z], rotation: [0, rot, 0], scale: [1.25, 0.6, 1] },
  material: { preset: "marble", color: "#E6E1D8" },
});

export const planter: Template = {
  id: "planter",
  name: "Self-Watering Desk Planter",
  keywords: ["self watering planter", "planter", "plant pot", "flower pot", "succulent pot", "herb planter", "self watering pot"],
  category: "planter",
  description: "Sage stoneware desk planter nested in a glass water reservoir with a cotton wick, float water gauge and oak base, planted with a Pilea.",
  targetPriceUsd: 48,
  parts: [
    {
      id: "pot", name: "Ceramic pot", kind: "primitive", parent: null,
      geometry: {
        type: "lathe",
        params: {
          // Outer wall up, rolled rim, inner wall down to the inner floor.
          points: [
            [0, 0], [0.0472, 0], [0.0498, 0.0022], [0.0512, 0.012], [0.054, 0.04], [0.0582, 0.07], [0.0628, 0.098], [0.0648, 0.1115],
            [0.0646, 0.1158], [0.0632, 0.1172], [0.0614, 0.1155], [0.0604, 0.11], [0.0588, 0.098], [0.0544, 0.07], [0.0504, 0.04],
            [0.0478, 0.016], [0.044, 0.0085], [0, 0.0082],
          ],
          angle: 360, segments: 128, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: SAGE,
    },
    {
      id: "pot_band", name: "Glaze band", kind: "primitive", parent: "pot",
      geometry: { type: "torus", params: { radius: 0.0553, tube: 0.0011, arc: 360 } },
      transform: { position: [0, 0.048, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "ceramic", color: "#7F9470" },
    },
    {
      id: "soil", name: "Soil", kind: "primitive", parent: "pot",
      geometry: { type: "cylinder", params: { radiusTop: 0.0599, radiusBottom: 0.0592, height: 0.006, bevel: 0.0015, open: false } },
      transform: { position: [0, SOIL_Y - 0.003, 0], ...ID },
      material: { preset: "concrete", color: "#3E2C20", roughness: 0.95 },
    },
    pebble("pebble_1", 0.03, 0.03, 0.0068, 20),
    pebble("pebble_2", -0.038, 0.022, 0.006, 70),
    pebble("pebble_3", 0.008, 0.045, 0.0058, 130),
    pebble("pebble_4", -0.024, -0.04, 0.0065, 200),
    pebble("pebble_5", 0.044, -0.012, 0.0055, 300),
    {
      id: "gauge_tube", name: "Water gauge", kind: "primitive", parent: "soil",
      geometry: { type: "cylinder", params: { radiusTop: 0.0052, radiusBottom: 0.0052, height: 0.022, bevel: 0.001, open: false } },
      transform: { position: [-0.043, 0.008, 0.026], ...ID },
      material: { preset: "glass", color: "#F2F7F6" },
    },
    {
      id: "gauge_float", name: "Water level float", kind: "primitive", parent: "gauge_tube",
      geometry: { type: "capsule", params: { radius: 0.0033, length: 0.012 } },
      transform: { position: [0, 0.0105, 0], ...ID },
      material: { preset: "plastic_gloss", color: "#E9763A" },
    },
    {
      id: "gauge_cap", name: "Gauge collar", kind: "primitive", parent: "gauge_tube",
      geometry: { type: "torus", params: { radius: 0.0052, tube: 0.0014, arc: 360 } },
      transform: { position: [0, 0.011, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "plastic_matte", color: "#F3EFE6" },
    },
    {
      id: "reservoir", name: "Glass water reservoir", kind: "primitive", parent: "pot",
      geometry: {
        type: "lathe",
        params: {
          points: [
            [0, -0.056], [0.0505, -0.056], [0.0546, -0.0528], [0.0556, -0.046], [0.0556, 0.006], [0.0549, 0.0104], [0.0532, 0.0108],
            [0.0522, 0.0075], [0.0521, -0.045], [0.05, -0.0518], [0, -0.0522],
          ],
          angle: 360, segments: 128, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: GLASS,
    },
    {
      id: "water", name: "Water", kind: "primitive", parent: "reservoir",
      geometry: { type: "cylinder", params: { radiusTop: 0.0516, radiusBottom: 0.0505, height: 0.036, bevel: 0.0015, open: false } },
      transform: { position: [0, -0.0338, 0], ...ID },
      material: { preset: "plastic_gloss", color: "#8CCBE2", roughness: 0.08 },
    },
    {
      id: "wick", name: "Cotton wick", kind: "primitive", parent: "pot",
      geometry: {
        type: "tube",
        params: {
          points: [[0, 0.004, 0], [0.002, -0.012, 0.004], [-0.003, -0.028, 0.008], [-0.014, -0.043, 0.006], [-0.026, -0.0485, -0.004], [-0.022, -0.049, -0.019], [-0.006, -0.049, -0.026]],
          radius: 0.0026, closed: false, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: { preset: "cotton", color: "#EFE6D2" },
    },
    {
      id: "base", name: "Oak base", kind: "primitive", parent: "pot",
      geometry: { type: "cylinder", params: { radiusTop: 0.0605, radiusBottom: 0.0625, height: 0.014, bevel: 0.003, open: false } },
      transform: { position: [0, -0.0628, 0], ...ID },
      material: OAK,
    },
    {
      id: "base_groove", name: "Base groove", kind: "primitive", parent: "base",
      geometry: { type: "torus", params: { radius: 0.0562, tube: 0.0013, arc: 360 } },
      transform: { position: [0, 0.0068, 0], rotation: [90, 0, 0], scale: [1, 1, 1] },
      material: { preset: "wood", color: "#8C6239" },
    },
    {
      id: "cork_pad", name: "Cork foot pad", kind: "primitive", parent: "base",
      geometry: { type: "cylinder", params: { radiusTop: 0.055, radiusBottom: 0.055, height: 0.002, bevel: 0.0005, open: false } },
      transform: { position: [0, -0.0075, 0], ...ID },
      material: { preset: "cork", color: "#B98E5E" },
    },
    {
      id: "stem", name: "Plant stem", kind: "primitive", parent: "soil",
      geometry: {
        type: "tube",
        params: { points: [[0, -0.002, 0], [0.001, 0.02, 0.001], [-0.001, 0.045, 0], [0.001, STEM_TOP, -0.001]], radius: 0.0032, closed: false, sharp: false },
      },
      transform: { position: [0, 0.003, 0], ...ID },
      material: { preset: "plastic_matte", color: "#6C8B4A", roughness: 0.6 },
    },
    ...LEAVES.flatMap((_, i) => leaf(i)),
  ],
};
