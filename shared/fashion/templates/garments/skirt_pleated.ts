import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Pleated (tennis / school) skirt over a cloth-simulated base: knife pleats all round from a straight
 * waistband, with a self-fabric hem facing. Waistband topstitching, the side zip, its waist button and
 * the inside label are modules.
 */

// Length stretches the pleats below the hip line (y 0.3): mini as modeled, then knee, midi, maxi.
const HIP = 0.3;
const LENGTH_K: Record<string, number> = { mini: 1, knee: 1.45, midi: 1.95, maxi: 2.6 };
// Radial scale at the hem relative to the hip (about the skirt's vertical axis).
const FLARE_K: Record<string, number> = { straight: 0.9, a_line: 1, full: 1.3 };
const FIT: Record<string, number> = { fitted: 0.96, regular: 1, oversized: 1.07 };

function deform(c: Record<string, string>, _node: string): DeformParams {
  const lk = LENGTH_K[c.length] ?? 1;
  const hem = HIP - HIP * lk;
  const f = FIT[c.fit] ?? 1;
  // Fit is the overall size; flare only changes the sweep of the pleats.
  return { ly: HIP, lk, lgx: 0, lgz: 0.01, lgy0: HIP, lgy1: hem, lgk0: 1, lgk1: FLARE_K[c.flare] ?? 1, fx: f, fz: f };
}

export const skirtPleated = meshTemplate({
  id: "skirt_pleated",
  model: "skirt_pleated",
  name: "Pleated skirt",
  category: "skirt",
  kind: "skirt",
  keywords: ["pleated skirt", "tennis skirt", "skirt", "school skirt"],
  description: "Knife-pleated skirt on a straight waistband with a side zip and button, pleats pressed all the way round",
  targetPriceUsd: 55,
  controls: {
    length: { options: ["mini", "knee", "midi", "maxi"], default: "mini", description: "hem length (mini sits mid-thigh)" },
    flare: { options: ["straight", "a_line", "full"], default: "a_line", description: "how far the pleats fan out at the hem" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "overall ease: waist, hip and hem scale together" },
  },
  slots: {
    shell: { description: "skirt body and hem facing", nodes: ["body", "hem_band"], default: { preset: "wool_suiting", color: "#26334D" } },
    trim: { description: "waistband", nodes: ["waistband"], default: { preset: "wool_suiting", color: "#26334D" }, follows: ["shell"] },
    thread: { description: "topstitching", nodes: [], default: { preset: "cotton", color: "#1E2638" } },
    hardware: { description: "zip and button", nodes: [], default: { preset: "metal_brushed", color: "#B8BBC2" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "satin", color: "#F1EEE7" } },
    lining: { description: "inside details", nodes: [], default: { preset: "satin", color: "#26334D" } },
    accent: { description: "contrast details (bows, embroidery, trims)", nodes: [], default: { preset: "satin", color: "#F1EEE7" } },
  },
  root: "body",
  deform,
  names: { body: "Skirt", waistband: "Waistband", hem_band: "Hem facing" },
  modules: [
    { module: "topstitch", zone: "waistband_top", params: { rows: 1, pitch: 0.003, weight: "fine", offset: 0.003 }, name: "Waistband edge stitch" },
    { module: "topstitch", zone: "waistband", params: { rows: 1, pitch: 0.003, weight: "fine", offset: 0.019 }, name: "Waistband seam stitch" },
    { module: "zipper_path", zone: "side_zip", params: { style: "invisible" }, material: "shell", name: "Side zip" },
    { module: "button", zone: "waistband@0.75", params: { style: "flat4", radius: 0.0065 }, name: "Waistband button" },
    { module: "woven_label", zone: "waistband_label", params: { width: 0.035, height: 0.015 }, name: "Waistband label" },
  ],
  display: "form",
  // Hip form slim enough to stay inside the waistband at every fit; a tall stand so the maxi clears the floor.
  form: { width: 0.3, depth: 0.18, z: 0.015, lift: 0.58 },
});
