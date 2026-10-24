import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { pantsDeform, type PantsShape } from "./pants-deform.ts";

/**
 * Baggy carpenter jeans over a scanned pair: waistband (with its inside facing) and two legs split at
 * the center seams, with the baked belt loops, knee seams, thigh cargo pockets and pooled hems kept in
 * the mesh. Button, rivets, pockets, patch and the heavy gold topstitching are detail modules.
 */

/** Model-frame heights (m) and each leg's axis; the legs part below the crotch. */
const SHAPE: PantsShape = {
  waist: 1.04,
  crotch: 0.72,
  knee: 0.34,
  hem: 0,
  legs: { leg_l: { x: -0.125, z: -0.02, inner: -0.012 }, leg_r: { x: 0.115, z: -0.02, inner: 0.012 } },
};
/** Inseam relative to floor length (regular pools on the floor). */
const LENGTH_K: Record<string, number> = { cropped: 0.76, ankle: 0.9, regular: 1, long: 1.05 };
/** Crotch-to-waist depth; the model's dropped crotch is deep, so low takes the most out. */
const RISE_K: Record<string, number> = { low: 0.8, mid: 0.92, high: 1.04 };
/** Hem width relative to the model; flare widens from the knee only. */
const LEG_K: Record<string, number> = { baggy: 1, wide: 0.88, straight: 0.74, skinny: 0.56, flare: 1.16 };
const FIT: Record<string, [number, number]> = { fitted: [0.93, 0.95], regular: [1, 1], oversized: [1.08, 1.06] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  // Skinny and straight legs pull the hips in a little too, or the seat stays baggy over a narrow leg.
  const hip = c.leg === "skinny" ? 0.93 : c.leg === "straight" ? 0.97 : 1;
  return pantsDeform(SHAPE, {
    rise: RISE_K[c.rise] ?? RISE_K.low,
    length: LENGTH_K[c.length] ?? 1,
    hemWidth: LEG_K[c.leg] ?? 1,
    flare: c.leg === "flare",
    fx: fx * hip,
    fz: fz * hip,
  }, node);
}

export const jeansBaggy = meshTemplate({
  id: "jeans_baggy",
  model: "jeans_baggy",
  name: "Baggy jeans",
  category: "jeans",
  kind: "bottom",
  keywords: ["jeans", "baggy jeans", "wide leg jeans", "carpenter jeans", "denim", "boyfriend jeans", "low rise jeans", "y2k jeans"],
  description: "Baggy carpenter jeans: dropped crotch, wide legs pooling at the hem, knee seams, side cargo pockets, five-pocket front and back",
  targetPriceUsd: 85,
  controls: {
    leg: { options: ["baggy", "wide", "straight", "skinny", "flare"], default: "baggy", description: "leg shape from the knee to the hem" },
    rise: { options: ["low", "mid", "high"], default: "low", description: "where the waistband sits (low on the hips to high at the waist)" },
    length: { options: ["cropped", "ankle", "regular", "long"], default: "regular", description: "inseam length (regular pools at the shoe)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through the waist, seat and legs" },
  },
  slots: {
    shell: { description: "denim body", nodes: ["waistband", "leg_l", "leg_r"], default: { preset: "denim", color: "#4A6A8E" } },
    hardware: { description: "button and rivets", nodes: [], default: { preset: "metal_brushed", color: "#A9814F" } },
    thread: { description: "topstitching", nodes: [], default: { preset: "cotton", color: "#C9892E" } },
    label: { description: "back patch and labels", nodes: [], default: { preset: "leather", color: "#7A5236" } },
    trim: { description: "bands and trims", nodes: [], default: { preset: "denim", color: "#4A6A8E" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "leather", color: "#7A5236" } },
  },
  root: "waistband",
  deform,
  names: { waistband: "Waistband", leg_l: "Left leg", leg_r: "Right leg" },
  modules: [
    { module: "button", zone: "waistband@0.5", params: { style: "jeans_tack", radius: 0.0085 }, material: "hardware", name: "Waist button" },
    { module: "topstitch", zone: "waistband", params: { rows: 2, weight: "heavy", offset: 0.004 }, material: "thread", name: "Waistband seam stitching" },
    { module: "topstitch", zone: "waistband_top", params: { rows: 1, weight: "heavy", offset: 0.004 }, material: "thread", name: "Waistband top stitching" },
    { module: "topstitch", zone: "fly", params: { rows: 2, weight: "heavy" }, material: "thread", name: "Fly stitching" },
    { module: "bar_tack", zone: "fly@1", material: "thread", name: "Fly bar tack" },
    { module: "slash_pocket", zone: "pocket_front_left", params: { side: "left", shape: "slant", width: 0.075, height: 0.1, thread: "gold" }, name: "Left front pocket" },
    { module: "slash_pocket", zone: "pocket_front_right", params: { side: "right", shape: "slant", width: 0.075, height: 0.1, thread: "gold" }, name: "Right front pocket" },
    { module: "jeans_back_pocket", zone: "pocket_back_*", params: { width: 0.13, height: 0.155, deco: "arc", thread: "gold" }, name: "Back pocket" },
    { module: "leather_patch", zone: "back_patch", params: { width: 0.07, height: 0.04 }, material: "label", name: "Back patch" },
    { module: "seam_welt", zone: "outseam_*", params: { thread: "gold", weight: "heavy" }, name: "Outseam" },
    { module: "topstitch", zone: "hem_*", params: { rows: 1, weight: "heavy" }, material: "thread", name: "Hem stitching" },
  ],
  display: "form",
  // The waistband's bounds include its flared top edge: a slimmer cap keeps the form inside it.
  form: { width: 0.27, depth: 0.19, z: -0.006, top: 1.05, bottom: 0.88 },
});
