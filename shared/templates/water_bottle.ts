import type { Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a 750 ml vacuum-insulated stainless bottle with a powder-coated body, silicone boot,
 * brushed-steel collar and a ribbed screw cap with a carry loop.
 * Body origin sits on the axis at the bottom of the steel can (inside the boot).
 */

type V3 = [number, number, number];
const ID = { rotation: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 };

const POWDER: PartMaterial = { preset: "plastic_matte", color: "#2F5D7C", roughness: 0.7 };
const STEEL: PartMaterial = { preset: "metal_brushed", color: "#C9CDD2" };
const CAP: PartMaterial = { preset: "plastic_matte", color: "#EFEBE3" };
const BOOT: PartMaterial = { preset: "rubber", color: "#E9E4DA" };

const NECK_Y = 0.2265; // top of the powder-coated shoulder
const CAP_Y = 0.2315; // cap's bottom rim (on the steel collar)
const CAP_R = 0.0248;
const CAP_H = 1.2 * CAP_R;

const ringOn = (id: string, name: string, parent: string, y: number, radius: number, tube: number, material: PartMaterial, squash = 1): Part => ({
  id, name, kind: "primitive", parent,
  geometry: { type: "torus", params: { radius, tube, arc: 360 } },
  transform: { position: [0, y, 0], rotation: [90, 0, 0], scale: [1, 1, squash] },
  material,
});

const loopFoot = (id: string, name: string, x: number): Part => ({
  id, name, kind: "primitive", parent: "cap",
  geometry: { type: "roundedBox", params: { width: 0.0095, height: 0.0065, depth: 0.0135, radius: 0.0028 } },
  transform: { position: [x, CAP_H + 0.0012, 0], ...ID },
  material: CAP,
});

/** Four-point sparkle, the brand mark laser-etched on the front. */
const sparkle = (s: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 2;
    const r = i % 2 === 0 ? s : s * 0.26;
    pts.push([Math.round(Math.cos(a) * r * 10000) / 10000, Math.round(Math.sin(a) * r * 10000) / 10000]);
  }
  return pts;
};

export const waterBottle: Template = {
  id: "water_bottle",
  name: "Insulated Water Bottle",
  keywords: ["water bottle", "bottle", "flask", "thermos", "tumbler", "hydro flask", "insulated bottle", "drink bottle", "canteen"],
  category: "water bottle",
  description: "750 ml double-wall vacuum-insulated stainless bottle with powder-coat finish, silicone grip boot, ribbed screw cap and carry loop.",
  targetPriceUsd: 42,
  parts: [
    {
      id: "bottle_body", name: "Bottle body", kind: "primitive", parent: null,
      geometry: {
        type: "lathe",
        params: {
          points: [
            [0, 0], [0.0335, 0], [0.0362, 0.0022], [0.037, 0.008], [0.037, 0.06], [0.037, 0.12], [0.037, 0.178],
            [0.0366, 0.191], [0.0346, 0.2025], [0.0302, 0.2125], [0.0252, 0.2195], [0.0222, 0.2245], [0.0216, NECK_Y], [0, NECK_Y],
          ],
          angle: 360, segments: 128, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: POWDER,
    },
    {
      id: "steel_collar", name: "Steel neck collar", kind: "primitive", parent: "bottle_body",
      geometry: {
        type: "lathe",
        params: { points: [[0, 0.2235], [0.0218, 0.2235], [0.0226, 0.2248], [0.0226, 0.2295], [0.0219, 0.2312], [0.0205, CAP_Y + 0.001], [0, CAP_Y + 0.001]], angle: 360, segments: 128, sharp: false },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: { preset: "metal_polished", color: "#D6D9DE" },
    },
    {
      id: "cap", name: "Screw cap", kind: "kit", kitAsset: "screw_cap", kitParams: { radius: CAP_R }, parent: "bottle_body",
      transform: { position: [0, CAP_Y, 0], ...ID },
      material: CAP,
    },
    ringOn("cap_seal", "Cap seal", "bottle_body", CAP_Y + 0.0004, 0.0236, 0.0009, { preset: "rubber", color: "#8E959C" }),
    {
      id: "cap_top", name: "Cap top insert", kind: "primitive", parent: "cap",
      geometry: { type: "cylinder", params: { radiusTop: 0.0178, radiusBottom: 0.0182, height: 0.0016, bevel: 0.0006, open: false } },
      transform: { position: [0, CAP_H - 0.0004, 0], ...ID },
      material: STEEL,
    },
    loopFoot("loop_foot_left", "Left loop hinge", -0.0155),
    loopFoot("loop_foot_right", "Right loop hinge", 0.0155),
    {
      id: "carry_loop", name: "Carry loop", kind: "primitive", parent: "cap",
      geometry: { type: "torus", params: { radius: 0.0155, tube: 0.0046, arc: 180 } },
      transform: { position: [0, CAP_H + 0.003, 0], rotation: [0, 0, 0], scale: [1, 1.12, 1.25] },
      material: CAP,
    },
    {
      id: "boot", name: "Silicone boot", kind: "primitive", parent: "bottle_body",
      geometry: {
        type: "lathe",
        params: {
          points: [[0, -0.0028], [0.0328, -0.0028], [0.0372, -0.0005], [0.0386, 0.004], [0.0389, 0.016], [0.0388, 0.028], [0.0383, 0.0318], [0.0374, 0.0326], [0.0369, 0.031], [0, 0.031]],
          angle: 360, segments: 128, sharp: false,
        },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: BOOT,
    },
    ringOn("boot_grip_1", "Boot grip rib", "bottle_body", 0.0085, 0.0388, 0.0009, BOOT),
    ringOn("boot_grip_2", "Boot grip rib 2", "bottle_body", 0.0135, 0.0389, 0.0009, BOOT),
    ringOn("boot_grip_3", "Boot grip rib 3", "bottle_body", 0.0185, 0.0389, 0.0009, BOOT),
    {
      id: "sleeve_band", name: "Silicone grip band", kind: "primitive", parent: "bottle_body",
      geometry: {
        type: "lathe",
        params: { points: [[0.0368, 0.103], [0.0377, 0.1036], [0.0381, 0.1058], [0.0381, 0.1132], [0.0377, 0.1154], [0.0368, 0.116]], angle: 360, segments: 128, sharp: false },
      },
      transform: { position: [0, 0, 0], ...ID },
      material: BOOT,
    },
    ringOn("engraved_ring", "Engraved ring", "bottle_body", 0.1865, 0.0367, 0.0005, STEEL),
    ringOn("engraved_ring_low", "Lower engraved ring", "bottle_body", 0.04, 0.037, 0.0005, STEEL),
    {
      id: "logo", name: "Etched logo", kind: "primitive", parent: "bottle_body",
      geometry: { type: "extrude", params: { shape: sparkle(0.0072), depth: 0.0012, bevel: 0.0003, smooth: false } },
      transform: { position: [0, 0.158, 0.0367], ...ID },
      material: STEEL,
    },
    {
      id: "capacity_mark", name: "Capacity mark", kind: "primitive", parent: "bottle_body",
      geometry: { type: "roundedBox", params: { width: 0.012, height: 0.0018, depth: 0.0012, radius: 0.0005 } },
      transform: { position: [0, 0.1455, 0.0367], ...ID },
      material: STEEL,
    },
  ],
};
