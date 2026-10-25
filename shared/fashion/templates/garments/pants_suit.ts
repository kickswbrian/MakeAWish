import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { pantsDeform, type PantsShape } from "./pants-deform.ts";

/**
 * Tailored trousers: the pattern-built five-pocket base with its coin pocket and patch back pockets
 * taken off, restyled with slant front pockets, jetted back welt pockets, a hook-and-eye plus button
 * waist and a pressed front crease (a fine tonal welt down each leg). Wool suiting by default; the
 * leg control goes from a slim cigarette leg to a wide-leg trouser.
 */

const SHAPE: PantsShape = {
  waist: 0.995,
  crotch: 0.705,
  knee: 0.33,
  hem: 0,
  legs: { leg_l: { x: -0.175, z: -0.035, inner: -0.135 }, leg_r: { x: 0.175, z: -0.035, inner: 0.135 } },
};
const LENGTH_K: Record<string, number> = { cropped: 0.86, ankle: 0.94, regular: 1, long: 1.04 };
const RISE_K: Record<string, number> = { low: 0.86, mid: 1, high: 1.12 };
const LEG_K: Record<string, number> = { slim: 0.86, straight: 1, wide: 1.5, flare: 1.45 };
const FIT: Record<string, [number, number]> = { fitted: [0.96, 0.96], regular: [1.02, 1.02], relaxed: [1.08, 1.06] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? FIT.regular;
  return pantsDeform(SHAPE, {
    rise: RISE_K[c.rise] ?? 1,
    length: LENGTH_K[c.length] ?? 1,
    hemWidth: LEG_K[c.leg] ?? 1,
    flare: c.leg === "flare",
    fx,
    fz,
  }, node);
}

export const pantsSuit = meshTemplate({
  id: "pants_suit",
  model: "pants_suit",
  name: "Tailored trousers",
  category: "pants",
  kind: "bottom",
  keywords: ["trousers", "suit pants", "tailored trousers", "slacks", "dress pants", "wide leg trousers", "work pants women", "office pants"],
  description: "Tailored trousers: pressed front creases, slant front pockets, jetted back welt pockets, hook-and-eye and button waistband, belt loops",
  targetPriceUsd: 95,
  controls: {
    leg: { options: ["slim", "straight", "wide", "flare"], default: "straight", description: "leg shape (wide = wide-leg trouser, flare = bootcut)" },
    rise: { options: ["low", "mid", "high"], default: "mid", description: "where the waistband sits" },
    length: { options: ["cropped", "ankle", "regular", "long"], default: "regular", description: "inseam length (long breaks over the shoe)" },
    fit: { options: ["fitted", "regular", "relaxed"], default: "regular", description: "fit through the hips and thighs" },
  },
  slots: {
    shell: { description: "trouser body, waistband and belt loops", nodes: ["waistband", "leg_l", "leg_r", "belt_loops"], default: { preset: "wool_suiting", color: "#202227" } },
    hardware: { description: "button and hook-and-eye", nodes: [], default: { preset: "horn", color: "#2A2522" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#1B1C20" } },
    lining: { description: "pocketing and inside facings", nodes: [], default: { preset: "satin", color: "#2B2D33" } },
    label: { description: "labels", nodes: [], default: { preset: "satin", color: "#1A1A1C" } },
    trim: { description: "bands and trims", nodes: [], default: { preset: "satin", color: "#16171A" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "satin", color: "#16171A" } },
  },
  root: "waistband",
  deform,
  names: { waistband: "Waistband", leg_l: "Left leg", leg_r: "Right leg", belt_loops: "Belt loops" },
  modules: [
    { module: "button", zone: "button_waist", params: { style: "horn_rim", radius: 0.0075 }, material: "hardware", name: "Waist button" },
    { module: "hook_eye", zone: "waistband@0.5", material: { preset: "metal_polished", color: "#9A9CA0" }, name: "Waist hook and eye" },
    { module: "topstitch", zone: "fly", params: { rows: 1, weight: "fine", offset: 0.003 }, material: "thread", name: "Fly stitching" },
    { module: "bar_tack", zone: "fly@1", params: { length: 0.008 }, material: "thread", name: "Fly bar tack" },
    { module: "slash_pocket", zone: "pocket_front_left", params: { side: "left", shape: "slant", stitch: "single", rivet: "none", thread: "tonal", width: 0.1, height: 0.12 }, name: "Left front pocket" },
    { module: "slash_pocket", zone: "pocket_front_right", params: { side: "right", shape: "slant", stitch: "single", rivet: "none", thread: "tonal", width: 0.1, height: 0.12 }, name: "Right front pocket" },
    { module: "welt_pocket", zone: "pocket_back_*", params: { width: 0.12, height: 0.01, lips: "double", thread: "tonal" }, name: "Back welt pocket" },
    { module: "seam_welt", zone: "crease_*", params: { width: 0.004, height: 0.0007, rows: 1, thread: "tonal", weight: "fine" }, name: "Pressed crease" },
    { module: "woven_label", zone: "back_patch", params: { width: 0.04, height: 0.016 }, material: "label", name: "Back label" },
  ],
  display: "form",
  form: { width: 0.26, depth: 0.17, z: 0.008, top: 1.008, bottom: 0.85 },
});
