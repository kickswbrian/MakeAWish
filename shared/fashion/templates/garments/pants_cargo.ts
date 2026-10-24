import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { pantsDeform, type PantsShape } from "./pants-deform.ts";

/**
 * Utility cargo pants: waistband, belt loops, two legs and the sewn-on pieces (thigh cargo flaps,
 * back flap pockets, side hip pockets, knee strap) as one "pockets" part, with the baked seams, seat
 * panel and topstitching kept as fold normals. Flap buttons, fly, waist button and stitching are modules.
 */

const SHAPE: PantsShape = {
  waist: 0.99,
  crotch: 0.687,
  knee: 0.33,
  hem: 0,
  legs: {
    leg_l: { x: -0.17, z: -0.005, inner: -0.11 },
    leg_r: { x: 0.18, z: -0.005, inner: 0.115 },
    // The cargo flaps and knee strap sit on the legs: they follow their leg's shape.
    pockets_l: { x: -0.17, z: -0.005, inner: -0.11 },
    pockets_r: { x: 0.18, z: -0.005, inner: 0.115 },
  },
};
const LENGTH_K: Record<string, number> = { cropped: 0.8, ankle: 0.92, regular: 1, long: 1.05 };
const RISE_K: Record<string, number> = { low: 0.86, mid: 1, high: 1.1 };
const LEG_K: Record<string, number> = { skinny: 0.72, straight: 1, wide: 1.3, baggy: 1.5 };
const FIT: Record<string, [number, number]> = { fitted: [0.95, 0.96], regular: [1, 1], oversized: [1.1, 1.08] };

function look(c: Record<string, string>) {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  // Baggy cargos sit looser through the seat too.
  const loose = c.leg === "baggy" ? 1.05 : 1;
  return { rise: RISE_K[c.rise] ?? 1, length: LENGTH_K[c.length] ?? 1, hemWidth: LEG_K[c.leg] ?? 1, fx: fx * loose, fz: fz * loose };
}

function deform(c: Record<string, string>, node: string): DeformParams {
  return pantsDeform(SHAPE, look(c), node);
}

export const pantsCargo = meshTemplate({
  id: "pants_cargo",
  model: "pants_cargo",
  name: "Cargo pants",
  category: "pants",
  kind: "bottom",
  keywords: ["cargo pants", "cargos", "utility pants", "combat pants", "work pants", "tactical pants"],
  description: "Utility cargo pants: thigh cargo pockets with button flaps, back flap pockets, side hip pockets, knee strap, belt loops, seat panel",
  targetPriceUsd: 70,
  controls: {
    leg: { options: ["skinny", "straight", "wide", "baggy"], default: "straight", description: "leg shape from the knee to the hem" },
    rise: { options: ["low", "mid", "high"], default: "mid", description: "where the waistband sits" },
    length: { options: ["cropped", "ankle", "regular", "long"], default: "regular", description: "inseam length" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through the hips and thighs" },
  },
  slots: {
    shell: { description: "body, waistband and belt loops", nodes: ["waistband", "leg_l", "leg_r", "belt_loops"], default: { preset: "canvas", color: "#5B5A3E" } },
    accent: { description: "pocket flaps, hip pockets and knee strap (contrast them)", nodes: ["pockets_l", "pockets_r"], default: { preset: "canvas", color: "#5B5A3E" } },
    hardware: { description: "buttons", nodes: [], default: { preset: "metal_brushed", color: "#4A4A48" } },
    thread: { description: "topstitching", nodes: [], default: { preset: "cotton", color: "#3F3E2A" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "leather", color: "#5A4030" } },
    trim: { description: "bands, cords and trims", nodes: [], default: { preset: "nylon", color: "#2B2B28" } },
  },
  root: "waistband",
  deform,
  names: { waistband: "Waistband", leg_l: "Left leg", leg_r: "Right leg", belt_loops: "Belt loops", pockets_l: "Left pockets", pockets_r: "Right pockets" },
  modules: [
    { module: "button", zone: "waistband@0.5", params: { style: "shank_dome", radius: 0.0085 }, material: "hardware", name: "Waist button" },
    { module: "button", zone: "flap_button_*", params: { style: "shank_dome", radius: 0.0065 }, material: "hardware", name: "Flap button" },
    { module: "topstitch", zone: "waistband", params: { rows: 2, weight: "regular", offset: 0.006 }, material: "thread", name: "Waistband stitching" },
    { module: "topstitch", zone: "waistband_top", params: { rows: 1, weight: "regular", offset: 0.003 }, material: "thread", name: "Waistband top stitching" },
    { module: "topstitch", zone: "fly", params: { rows: 2, weight: "regular" }, material: "thread", name: "Fly stitching" },
    { module: "bar_tack", zone: "fly@1", material: "thread", name: "Fly bar tack" },
    { module: "seam_welt", zone: "outseam_*", params: { thread: "tonal", weight: "regular", rows: 2 }, name: "Outseam" },
    { module: "topstitch", zone: "hem_*", params: { rows: 2, weight: "regular" }, material: "thread", name: "Hem stitching" },
    { module: "woven_label", zone: "back_patch", params: { width: 0.05, height: 0.02 }, material: "label", name: "Back label" },
  ],
  display: "form",
  form: { width: 0.27, depth: 0.2, z: 0.01, top: 1.0, bottom: 0.85 },
});
