import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Tailored double-breasted blazer (Style3D suit set, blazer only): body, two-piece sleeves, peak
 * lapels with collar, hip pocket flaps and the inside lining. The baked pattern normals keep the
 * seams, darts and lapel roll; the six front buttons and four-button cuffs are horn button modules
 * on the spots the original buttons sat.
 */

// Sleeve axis from the shoulder toward the cuff (model frame, meters): blazer sleeves hang nearly straight.
const SLEEVE = { r: { o: [0.17, 0.62, 0], d: [0.086, -0.996, 0] }, l: { o: [-0.17, 0.62, 0], d: [-0.086, -0.996, 0] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.74, short: 0.36 };
const LENGTH_K: Record<string, number> = { cropped: 0.56, regular: 1, long: 1.25 };
const FIT: Record<string, [number, number]> = { fitted: [0.95, 0.96], regular: [1, 1], oversized: [1.1, 1.08] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  if (node === "sleeve_r" || node === "sleeve_l") {
    const s = SLEEVE[node === "sleeve_r" ? "r" : "l"];
    const sk = (SLEEVE_K[c.sleeves] ?? 1) * (c.fit === "oversized" ? 1.03 : 1);
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.08, sk });
  } else {
    // Body, lapels, lining and flaps share one length stretch below the waist so they stay stacked.
    Object.assign(p, { ly: 0.42, lk: LENGTH_K[c.length] ?? 1 });
  }
  return p;
}

export const blazerClassic = meshTemplate({
  id: "blazer_classic",
  model: "blazer_classic",
  name: "Tailored blazer",
  category: "blazer",
  kind: "outerwear",
  keywords: ["blazer", "suit jacket", "tailored blazer", "sport coat", "office blazer", "double breasted blazer", "tuxedo jacket"],
  description: "Tailored double-breasted blazer: peak lapels, six horn buttons, flap hip pockets, four-button cuffs, fully lined",
  targetPriceUsd: 180,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (cropped ends at the waist, long is a longline blazer)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through body and sleeves" },
    sleeves: { options: ["long", "three_quarter", "short"], default: "long", description: "sleeve length" },
    flaps: { options: ["flap", "none"], default: "flap", description: "hip pocket flaps or plain jetted pockets" },
  },
  slots: {
    shell: { description: "body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r", "pocket_flaps"], default: { preset: "wool_suiting", color: "#1E1E21" } },
    lapel: { description: "lapels and collar (satin for a tuxedo look)", nodes: ["lapels"], default: { preset: "wool_suiting", color: "#1E1E21" }, follows: ["shell"] },
    lining: { description: "inside lining", nodes: ["lining"], default: { preset: "satin", color: "#2B2A30" } },
    hardware: { description: "buttons", nodes: [], default: { preset: "horn", color: "#2A221D" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#26262A" } },
    trim: { description: "piping, bands and trims", nodes: [], default: { preset: "satin", color: "#1E1E21" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "metal_polished", color: "#C9A86A" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#1A1A1C" } },
  },
  root: "body",
  deform,
  hide: (c) => (c.flaps === "none" ? ["pocket_flaps"] : []),
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", lapels: "Lapels and collar", pocket_flaps: "Pocket flaps", lining: "Lining" },
  modules: [
    { module: "button", zone: "front_button_*", params: { style: "horn_rim", radius: 0.0105 }, name: "Front button" },
    { module: "button", zone: "cuff_button_*", params: { style: "horn_rim", radius: 0.0062, count: 4, inset: 0 }, name: "Cuff button" },
    { module: "welt_pocket", zone: "chest_right", params: { lips: "single", width: 0.1, height: 0.022 }, name: "Breast pocket", material: "shell" },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
});
