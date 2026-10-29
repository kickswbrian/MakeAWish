import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Tailored suit skirt (the skirt of a blazer-and-skirt ensemble) over a cloth-simulated base:
 * straight waistband, front darts and a front slit, fully lined. The back zip, its hook-and-eye,
 * back darts, the slit's bar tack and the label are modules; the fabric's baked seams and darts are
 * kept as fold normals.
 */

// Length moves everything below the hip line (y 0.36): the model as cut is knee length.
const HIP = 0.36;
const LENGTH_K: Record<string, number> = { mini: 0.6, knee: 1, midi: 1.45 };
// Radial scale at the hem relative to the hip, about the skirt's vertical axis.
const FLARE_K: Record<string, number> = { straight: 1, a_line: 1.12, full: 1.25 };
const FIT: Record<string, number> = { fitted: 0.96, regular: 1, oversized: 1.07 };

function deform(c: Record<string, string>, _node: string): DeformParams {
  const lk = LENGTH_K[c.length] ?? LENGTH_K.mini;
  const f = FIT[c.fit] ?? 1;
  // Fit is the overall size; flare fans out from the hip line to the hem.
  return { ly: HIP, lk, lgx: 0, lgz: 0, lgy0: HIP, lgy1: HIP - HIP * lk, lgk0: 1, lgk1: FLARE_K[c.flare] ?? 1, fx: f, fz: f };
}

export const skirtMini = meshTemplate({
  id: "skirt_mini",
  model: "skirt_mini",
  name: "Tailored suit skirt",
  category: "skirt",
  kind: "skirt",
  keywords: ["mini skirt", "suit skirt", "pencil skirt", "office skirt"],
  description: "Tailored suiting skirt with a straight waistband, darts, a front slit and an invisible back zip, fully lined",
  targetPriceUsd: 85,
  controls: {
    length: { options: ["mini", "knee", "midi"], default: "mini", description: "hem length (mini sits mid-thigh, knee is a classic pencil)" },
    flare: { options: ["straight", "a_line", "full"], default: "straight", description: "straight pencil line, A-line, or a full flared hem" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "overall ease: waist, hip and hem scale together" },
  },
  slots: {
    shell: { description: "skirt body", nodes: ["body"], default: { preset: "wool_suiting", color: "#3A3D44" } },
    trim: { description: "waistband", nodes: ["waistband"], default: { preset: "wool_suiting", color: "#3A3D44" }, follows: ["shell"] },
    lining: { description: "lining", nodes: [], default: { preset: "satin", color: "#2B2D33" } },
    thread: { description: "stitching and bar tacks", nodes: [], default: { preset: "cotton", color: "#2A2C31" } },
    hardware: { description: "hook and eye, zip pull", nodes: [], default: { preset: "metal_polished", color: "#BFC3CA" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "satin", color: "#F1EEE7" } },
    accent: { description: "contrast details (bows, buttons, trims)", nodes: [], default: { preset: "leather", color: "#1E1E20" } },
  },
  root: "body",
  deform,
  names: { body: "Skirt", waistband: "Waistband" },
  modules: [
    { module: "zipper_path", zone: "back_center", params: { style: "invisible", tape_width: 0.002 }, material: "shell", name: "Invisible back zip" },
    { module: "hook_eye", zone: "waistband@0", name: "Waistband hook and eye" },
    { module: "dart", zone: "dart_back_*", params: { length: 0.1, width: 0.007 }, name: "Back dart" },
    { module: "bar_tack", zone: "slit_top", params: { length: 0.008, width: 0.0018 }, name: "Slit bar tack" },
    { module: "topstitch", zone: "waistband", params: { rows: 1, pitch: 0.0028, weight: "fine", offset: 0.0135 }, name: "Waistband seam stitch" },
    { module: "woven_label", zone: "waistband_label", params: { width: 0.035, height: 0.015 }, name: "Waistband label" },
  ],
  display: "form",
  // Hip form inside the fitted waistband and hips.
  form: { width: 0.27, depth: 0.17, z: 0.01 },
});
