import type { DeformParams } from "../../deform.ts";
import type { V3, Zone } from "../../types.ts";
import { meshTemplate } from "../mesh-template.ts";
import { deformedPath } from "./bag-zones.ts";

/**
 * Soft canvas shoulder bag over a scanned-quality base: one unlined, softly crumpled body (its baked
 * normal map keeps the folds, seams and a sewn-on patch outline) and a single long strap sewn into
 * the mouth. The patch, hem stitching and side label are modules.
 */

const TOP = 0.76;
const RIM = 0.435;
const SIZE: Record<string, number> = { mini: 0.62, small: 0.8, medium: 1, large: 1.15 };
const STRAP: Record<string, number> = { short: 0.62, shoulder: 1, long: 1.3 };
const WIDTH: Record<string, number> = { slim: 0.85, regular: 1, wide: 1.22 };

function deform(c: Record<string, string>, node: string): DeformParams {
  const s = SIZE[c.size] ?? 1;
  const w = WIDTH[c.width] ?? 1;
  const p: DeformParams = { ly: TOP, lk: s, fx: s * w, fz: s };
  if (node === "strap") Object.assign(p, { sox: 0, soy: TOP - (TOP - RIM) * s, soz: 0, sdx: 0, sdy: 1, sdz: 0, s0: 0, sk: STRAP[c.strap] ?? 1 });
  return p;
}

// Strap centerline on its front face, right end first (probed from the mesh).
const STRAP_PATH: [V3[], V3[]] = [
  [[0.0771, 0.4471, 0.0065], [0.0751, 0.4794, 0.0102], [0.0732, 0.5079, 0.0132], [0.0716, 0.5312, 0.0155], [0.0703, 0.5496, 0.0169], [0.069, 0.5645, 0.0174], [0.0677, 0.5774, 0.0171], [0.0665, 0.589, 0.0162], [0.0655, 0.5999, 0.0152], [0.0647, 0.6104, 0.0143], [0.0639, 0.621, 0.0137], [0.0632, 0.6323, 0.0134], [0.0625, 0.645, 0.0132], [0.0618, 0.6596, 0.013], [0.0605, 0.6767, 0.0129], [0.0572, 0.6953, 0.0128], [0.0503, 0.7129, 0.0129], [0.039, 0.7266, 0.0135], [0.0239, 0.7351, 0.0145], [0.0065, 0.7394, 0.0156], [-0.0119, 0.7411, 0.0163], [-0.0302, 0.7402, 0.0155], [-0.0473, 0.7354, 0.013], [-0.0616, 0.7251, 0.0095], [-0.0716, 0.7094, 0.0064], [-0.0775, 0.6909, 0.0045], [-0.0805, 0.6726, 0.0038], [-0.082, 0.6566, 0.0036], [-0.0831, 0.6428, 0.0036], [-0.084, 0.6309, 0.0037], [-0.0848, 0.6201, 0.0038], [-0.0854, 0.6099, 0.0039], [-0.086, 0.5999, 0.004], [-0.0868, 0.5896, 0.004], [-0.0878, 0.5786, 0.004], [-0.0891, 0.5662, 0.0038], [-0.0906, 0.5517, 0.0035], [-0.0923, 0.5339, 0.0026], [-0.0942, 0.5111, 0.001], [-0.0963, 0.4828, -0.0016], [-0.0987, 0.4505, -0.0048]],
  [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
];

function extraZones(_zones: Record<string, Zone>, c: Record<string, string>): Record<string, Zone> {
  return { handle_left: deformedPath("strap", "shoulder strap", ...STRAP_PATH, deform(c, "strap")) };
}

export const bagCanvas = meshTemplate({
  id: "bag_canvas",
  model: "bag_canvas",
  name: "Canvas shoulder bag",
  category: "shoulder bag",
  kind: "bag",
  keywords: ["canvas bag", "canvas shoulder bag", "messenger bag", "satchel", "fabric shoulder bag", "cotton bag", "book bag", "slouchy bag"],
  description: "Soft unlined canvas shoulder bag with a long single strap sewn into the mouth, worn-in folds and a sewn-on front patch",
  targetPriceUsd: 45,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size (medium is 43 cm tall, 29 cm wide)" },
    width: { options: ["slim", "regular", "wide"], default: "regular", description: "body width" },
    strap: { options: ["short", "shoulder", "long"], default: "shoulder", description: "strap drop: short hand-carry, shoulder, or long crossbody" },
  },
  slots: {
    shell: { description: "canvas body", nodes: ["body"], default: { preset: "canvas", color: "#D9CCB4" } },
    strap: { description: "strap", nodes: ["strap"], default: { preset: "canvas", color: "#C7AE86" } },
    trim: { description: "bindings and trims", nodes: [], default: { preset: "canvas", color: "#C7AE86" } },
    hardware: { description: "rings and rivets", nodes: [], default: { preset: "metal_brushed", color: "#B08D57" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#B9A684" } },
    lining: { description: "inside", nodes: [], default: { preset: "canvas", color: "#D9CCB4" } },
    accent: { description: "charms, pins, tassels", nodes: [], default: { preset: "cotton", color: "#A63A2E" } },
    label: { description: "patch and labels", nodes: [], default: { preset: "leather", color: "#9A3B2C" } },
  },
  root: "body",
  deform,
  names: { body: "Body", strap: "Strap" },
  extraZones,
  modules: [
    { module: "leather_patch", zone: "front_panel", params: { width: 0.118, height: 0.08, thread: "cream" }, name: "Front patch" },
    { module: "topstitch", zone: "top_edge", params: { rows: 2, gap: 0.006, offset: 0.012, weight: "regular", pitch: 0.0035 }, name: "Hem stitching" },
    { module: "topstitch", zone: "handle_left", params: { rows: 2, gap: 0.009, weight: "regular", pitch: 0.0035 }, name: "Strap stitching" },
    { module: "bar_tack", zone: "strap_anchor_*", params: { length: 0.014, width: 0.002 }, name: "Strap tack" },
    { module: "woven_label", zone: "side_right", params: { fold: "loop", width: 0.022, height: 0.018 }, name: "Side label" },
  ],
  display: "pedestal",
});
