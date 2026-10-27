import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Knit cardigan over the bomber base (its flight pockets and tabs dropped in prep): its rib collar, cuffs and waistband are already separate
 * pieces, and the two front edges become the rib button bands. Worn open on the form, buttons on
 * the right band, patch pockets at the hips.
 */

// Sleeve axis from the shoulder toward the cuff (model frame, meters); same base as jacket_bomber.
const SLEEVE = { r: { o: [0.2, 0.52, 0], d: [0.667, -0.745, 0] }, l: { o: [-0.2, 0.52, 0], d: [-0.667, -0.745, 0] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.72 };
const LENGTH_K: Record<string, number> = { cropped: 0.72, regular: 1, long: 1.45 };
const FIT: Record<string, [number, number]> = { fitted: [0.93, 0.93], regular: [1, 1], oversized: [1.12, 1.1] };
const SLEEVE_NODES: Record<string, "r" | "l"> = { sleeve_r: "r", cuff_r: "r", sleeve_l: "l", cuff_l: "l" };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  const side = SLEEVE_NODES[node];
  if (side) {
    const s = SLEEVE[side];
    // Oversized knits have longer, slouchier sleeves.
    const sk = (SLEEVE_K[c.sleeves] ?? 1) * (c.fit === "oversized" ? 1.07 : 1);
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.06, sk });
  } else if (node !== "collar") {
    // The bomber base blouses out like a balloon; a knit hangs straight, so taper most of the body.
    Object.assign(p, { ly: 0.33, lk: LENGTH_K[c.length] ?? 1, lgx: 0, lgz: 0, lgy0: 0.08, lgy1: 0.46, lgk0: c.fit === "oversized" ? 0.86 : 0.8, lgk1: 1 });
  }
  return p;
}

export const cardiganKnit = meshTemplate({
  id: "cardigan_knit",
  model: "cardigan_knit",
  name: "Cardigan",
  category: "cardigan",
  kind: "outerwear",
  keywords: ["cardigan", "cardi", "knit cardigan", "cable knit cardigan", "sweater jacket", "knit jacket", "grandpa cardigan", "boyfriend cardigan"],
  description: "Button-front knit cardigan: knit body and sleeves, rib button bands, rib neckband, cuffs and hem, patch pockets",
  targetPriceUsd: 75,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (cropped ends at the waist, long reaches the hips)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through body and sleeves" },
    sleeves: { options: ["long", "three_quarter"], default: "long", description: "sleeve length" },
    neckband: { options: ["rib", "none"], default: "rib", description: "rib neckband or a plain neck" },
  },
  slots: {
    shell: { description: "knit body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r"], default: { preset: "knit", color: "#D9CDB8" } },
    trim: { description: "rib bands: neckband, button bands, cuffs and hem", nodes: ["collar", "zipper", "cuff_l", "cuff_r", "hem_band"], default: { preset: "rib_knit", color: "#D9CDB8" }, follows: ["shell"] },
    hardware: { description: "buttons", nodes: [], default: { preset: "horn", color: "#6B4A32" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#CBBFA8" } },
    lining: { description: "inside facings", nodes: [], default: { preset: "knit", color: "#D9CDB8" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "suede", color: "#8A6A4A" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#EFE9DD" } },
  },
  root: "body",
  deform,
  hide: (c) => (c.neckband === "none" ? ["collar"] : []),
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Rib neckband", cuff_l: "Left cuff", cuff_r: "Right cuff", hem_band: "Rib hem", zipper: "Button bands" },
  modules: [
    { module: "button", zone: "placket", params: { count: 5, style: "horn_rim", radius: 0.0085 }, name: "Front buttons" },
    { module: "patch_pocket", zone: "hip_*", params: { width: 0.11, height: 0.12, corner: "rounded", stitch: "single", thread: "tonal" }, material: "shell", name: "Patch pocket" },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
});
