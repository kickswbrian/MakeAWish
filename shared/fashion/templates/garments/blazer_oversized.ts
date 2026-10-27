import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Oversized power-shoulder blazer worn open (Style3D ensemble, blazer only): long boxy body with
 * wide padded shoulders and notch lapels, a breast welt with a pocket square, double flap pockets
 * on the right hip. The two front buttons and four-button cuffs are horn button modules where the
 * originals sat.
 */

// Sleeve axis from the padded shoulder toward the cuff (model frame, meters): nearly straight down.
const SLEEVE = { r: { o: [0.23, 0.66, -0.04], d: [-0.036, -0.996, 0.084] }, l: { o: [-0.23, 0.66, -0.04], d: [0.036, -0.996, 0.084] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.74, short: 0.38 };
const LENGTH_K: Record<string, number> = { cropped: 0.6, regular: 1, long: 1.25 };
const FIT: Record<string, [number, number]> = { fitted: [0.9, 0.93], regular: [1, 1], oversized: [1.08, 1.06] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  // Slouchy narrows the padded shoulder line; the same field runs on every node so seams stay closed.
  if (c.shape === "slouchy") Object.assign(p, { lgx: 0, lgz: -0.02, lgy0: 0.5, lgy1: 0.72, lgk0: 1, lgk1: 0.88 });
  if (node === "sleeve_r" || node === "sleeve_l") {
    const s = SLEEVE[node === "sleeve_r" ? "r" : "l"];
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.06, sk: SLEEVE_K[c.sleeves] ?? 1 });
  } else if (node !== "collar") {
    Object.assign(p, { ly: 0.45, lk: LENGTH_K[c.length] ?? 1 });
  }
  return p;
}

export const blazerOversized = meshTemplate({
  id: "blazer_oversized",
  model: "blazer_oversized",
  name: "Oversized blazer",
  category: "blazer",
  kind: "outerwear",
  keywords: ["oversized blazer", "boyfriend blazer", "power shoulder blazer", "wide shoulder blazer", "longline blazer", "slouchy blazer"],
  description: "Oversized single-breasted blazer: wide padded shoulders, notch lapels, two horn buttons, double flap pockets and a pocket square",
  targetPriceUsd: 160,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (regular sits at the upper thigh)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through body and sleeves (regular is already roomy)" },
    shape: { options: ["structured", "slouchy"], default: "structured", description: "padded power shoulders or a softer, narrower shoulder" },
    sleeves: { options: ["long", "three_quarter", "short"], default: "long", description: "sleeve length" },
  },
  slots: {
    shell: { description: "body, sleeves and flaps", nodes: ["body", "sleeve_l", "sleeve_r", "pocket_flaps"], default: { preset: "wool_suiting", color: "#3A3A3F" } },
    collar: { description: "upper collar (velvet or satin for contrast)", nodes: ["collar"], default: { preset: "wool_suiting", color: "#3A3A3F" }, follows: ["shell"] },
    accent: { description: "pocket square", nodes: ["pocket_square"], default: { preset: "satin", color: "#EDE7DC" } },
    hardware: { description: "buttons", nodes: [], default: { preset: "horn", color: "#2E241E" } },
    lining: { description: "lining", nodes: [], default: { preset: "satin", color: "#2F2E33" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#2C2C30" } },
    trim: { description: "piping, bands and trims", nodes: [], default: { preset: "satin", color: "#3A3A3F" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#1A1A1C" } },
  },
  root: "body",
  deform,
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Collar", pocket_flaps: "Pocket flaps", pocket_square: "Pocket square" },
  modules: [
    { module: "button", zone: "front_button_*", params: { style: "horn_rim", radius: 0.011 }, name: "Front button" },
    { module: "button", zone: "cuff_button_*", params: { style: "horn_rim", radius: 0.006, count: 4, inset: 0 }, name: "Cuff button" },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
  // The open left front drapes in over the chest: a slimmer form set back keeps it from poking through.
  form: { width: 0.28, depth: 0.16, z: -0.025 },
});
