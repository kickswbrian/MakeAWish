import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * MA-1 style bomber worn open: blousy nylon body with hand pockets, a chest zip pocket and a
 * utility pocket on the left sleeve, rib-knit collar, cuffs and waistband as their own pieces, and
 * the zipper's two toothed edges (their teeth are in the baked fold normals). The parked slider at
 * the bottom of the right edge is a zipper module.
 */

// Sleeve axis from the shoulder toward the cuff (model frame, meters): the arms hang out at ~42 degrees.
const SLEEVE = { r: { o: [0.2, 0.52, 0], d: [0.667, -0.745, 0] }, l: { o: [-0.2, 0.52, 0], d: [-0.667, -0.745, 0] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.72 };
const LENGTH_K: Record<string, number> = { cropped: 0.72, regular: 1, long: 1.3 };
const FIT: Record<string, [number, number]> = { fitted: [0.94, 0.94], regular: [1, 1], oversized: [1.1, 1.1] };
const SLEEVE_NODES: Record<string, "r" | "l"> = { sleeve_r: "r", cuff_r: "r", sleeve_l: "l", cuff_l: "l" };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  const side = SLEEVE_NODES[node];
  if (side) {
    const s = SLEEVE[side];
    const sk = (SLEEVE_K[c.sleeves] ?? 1) * (c.fit === "oversized" ? 1.04 : 1);
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.06, sk });
  } else if (node !== "collar") {
    // Body, zipper edges and the waistband move together below the armpits. The source blouses out
    // like a balloon; a radial taper toward the rib waistband (none at the armholes) reads as a real
    // bomber on the form.
    Object.assign(p, { ly: 0.33, lk: LENGTH_K[c.length] ?? 1, lgx: 0, lgz: 0, lgy0: 0.07, lgy1: 0.34, lgk0: 0.8, lgk1: 1 });
  }
  return p;
}

export const jacketBomber = meshTemplate({
  id: "jacket_bomber",
  model: "jacket_bomber",
  name: "Bomber jacket",
  category: "jacket",
  kind: "outerwear",
  keywords: ["bomber", "bomber jacket", "flight jacket", "varsity jacket", "ma-1", "ma1 jacket"],
  description: "Nylon flight bomber: rib-knit collar, cuffs and waistband, open front zip, hand pockets and a utility pocket on the sleeve",
  targetPriceUsd: 110,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (cropped ends at the waist)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit through body and sleeves" },
    sleeves: { options: ["long", "three_quarter"], default: "long", description: "sleeve length" },
    collar: { options: ["rib", "none"], default: "rib", description: "rib-knit stand collar or collarless" },
  },
  slots: {
    shell: { description: "body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r"], default: { preset: "nylon", color: "#4E5738" } },
    trim: { description: "rib-knit collar, cuffs and waistband", nodes: ["collar", "cuff_l", "cuff_r", "hem_band"], default: { preset: "rib_knit", color: "#3F4630" } },
    hardware: { description: "zipper teeth and slider", nodes: ["zipper"], default: { preset: "metal_brushed", color: "#A3A6A8" } },
    lining: { description: "lining (classic flight orange)", nodes: [], default: { preset: "satin", color: "#E2662B" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#3B4229" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "nylon", color: "#E2662B" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#1C1C1C" } },
  },
  root: "body",
  deform,
  hide: (c) => (c.collar === "none" ? ["collar"] : []),
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Rib collar", cuff_l: "Left cuff", cuff_r: "Right cuff", hem_band: "Rib waistband", zipper: "Zipper edges" },
  modules: [
    { module: "zipper_path", zone: "zip_bottom", params: { style: "metal", pull: "tab", tape_width: 0.003 }, name: "Zipper slider" },
    { module: "topstitch", zone: "placket", params: { rows: 1, offset: -0.007, weight: "regular" }, name: "Right front edge stitch" },
    { module: "topstitch", zone: "placket_left", params: { rows: 1, offset: 0.007, weight: "regular" }, name: "Left front edge stitch" },
    { module: "topstitch", zone: "shoulder_*", params: { rows: 2, gap: 0.005 }, name: "Shoulder seam" },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
});
