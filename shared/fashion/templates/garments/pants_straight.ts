import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { pantsDeform, type PantsShape } from "./pants-deform.ts";

/**
 * Baggy parachute pants: wide straight legs gathered into bunched hems, a strap wrapped around each
 * lower leg, bellows cargo pockets on the thighs and flap pockets at the back, high waistband. The
 * pieces are split along the real pattern seams; the drape and gathers are baked fold normals. The
 * dropped buttons come back as button modules at the same spots.
 */

const SHAPE: PantsShape = {
  waist: 0.975,
  crotch: 0.7,
  knee: 0.36,
  hem: 0,
  legs: {
    leg_l: { x: -0.09, z: -0.005, inner: -0.02 },
    leg_r: { x: 0.1, z: -0.005, inner: 0.02 },
    pockets_l: { x: -0.09, z: -0.005, inner: -0.02 },
    pockets_r: { x: 0.1, z: -0.005, inner: 0.02 },
    straps_l: { x: -0.09, z: -0.005, inner: -0.02 },
    straps_r: { x: 0.1, z: -0.005, inner: 0.02 },
  },
};
const LENGTH_K: Record<string, number> = { cropped: 0.8, regular: 1, long: 1.05 };
const RISE_K: Record<string, number> = { low: 0.84, mid: 0.93, high: 1 };
const LEG_K: Record<string, number> = { straight: 0.8, wide: 1, baggy: 1.18 };
const FIT: Record<string, [number, number]> = { fitted: [0.94, 0.95], regular: [1, 1], oversized: [1.1, 1.08] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  return pantsDeform(SHAPE, { rise: RISE_K[c.rise] ?? 1, length: LENGTH_K[c.length] ?? 1, hemWidth: LEG_K[c.leg] ?? 1, fx, fz }, node);
}

export const pantsStraight = meshTemplate({
  id: "pants_straight",
  model: "pants_straight",
  name: "Parachute pants",
  category: "pants",
  kind: "bottom",
  keywords: ["parachute pants", "baggy pants", "wide leg pants", "balloon pants", "nylon pants", "satin pants", "streetwear pants"],
  description: "Baggy parachute pants: wide legs gathered at the ankle, wrap straps on the lower legs, bellows thigh pockets, back flap pockets, high waistband",
  targetPriceUsd: 65,
  controls: {
    leg: { options: ["straight", "wide", "baggy"], default: "wide", description: "how full the legs are" },
    rise: { options: ["low", "mid", "high"], default: "high", description: "where the waistband sits" },
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "inseam length (regular bunches at the ankle)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through the hips and thighs" },
    straps: { options: ["on", "none"], default: "on", description: "wrap straps around the lower legs" },
  },
  slots: {
    shell: { description: "body, waistband and pockets", nodes: ["waistband", "leg_l", "leg_r", "pockets_l", "pockets_r"], default: { preset: "nylon", color: "#1D1E21" } },
    accent: { description: "lower leg straps (contrast them)", nodes: ["straps_l", "straps_r"], default: { preset: "nylon", color: "#1D1E21" } },
    hardware: { description: "buttons", nodes: [], default: { preset: "metal_brushed", color: "#3A3A3C" } },
    thread: { description: "topstitching", nodes: [], default: { preset: "cotton", color: "#2A2B2E" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "cotton", color: "#D8D3C8" } },
    trim: { description: "cords, bands and trims", nodes: [], default: { preset: "nylon", color: "#1D1E21" } },
  },
  root: "waistband",
  deform,
  hide: (c) => (c.straps === "none" ? ["straps_l", "straps_r"] : []),
  names: { waistband: "Waistband", leg_l: "Left leg", leg_r: "Right leg", pockets_l: "Left pockets", pockets_r: "Right pockets", straps_l: "Left strap", straps_r: "Right strap" },
  modules: [
    { module: "button", zone: "button_waist", params: { style: "shank_dome", radius: 0.009 }, material: "hardware", name: "Waist button" },
    { module: "button", zone: "flap_button_*", params: { style: "shank_dome", radius: 0.0065 }, material: "hardware", name: "Flap button" },
    { module: "topstitch", zone: "waistband", params: { rows: 2, weight: "regular", offset: 0.008 }, material: "thread", name: "Waistband stitching" },
    { module: "topstitch", zone: "fly", params: { rows: 1, weight: "regular" }, material: "thread", name: "Fly stitching" },
    { module: "bar_tack", zone: "fly@1", material: "thread", name: "Fly bar tack" },
    { module: "woven_label", zone: "back_patch", params: { width: 0.045, height: 0.018 }, material: "label", name: "Back label" },
  ],
  display: "form",
  form: { width: 0.24, depth: 0.15, z: 0.0, top: 1.0, bottom: 0.9 },
});
