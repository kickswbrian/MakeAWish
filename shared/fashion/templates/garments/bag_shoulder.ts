import type { DeformParams } from "../../deform.ts";
import type { V3, Zone } from "../../types.ts";
import { meshTemplate } from "../mesh-template.ts";
import { deformedPath } from "./bag-zones.ts";

/**
 * Minimal oblong shoulder bag (baguette) over a modeled base: two padded pillow panels set into a
 * wrap-around gusset with a top zip, a base band, and a doubled shoulder strap. The source's zipper,
 * strap buckle and raised logo are dropped; zip, keeper, plate and edge paint are modules.
 */

const TOP = 0.42;
const BODY_TOP = 0.142;
const SIZE: Record<string, number> = { mini: 0.66, small: 0.83, medium: 1, large: 1.17 };
// Strap stretch above the body: top handle, shoulder (as modeled), long, none (clutch).
const STRAP: Record<string, number> = { top_handle: 0.5, shoulder: 1, long: 1.55 };
const STRAPS = ["strap_front", "strap_back"];

function deform(c: Record<string, string>, node: string): DeformParams {
  const s = SIZE[c.size] ?? 1;
  const p: DeformParams = { ly: TOP, lk: s, fx: s, fz: s };
  if (c.shape === "slouchy") Object.assign(p, { lk: s * 0.94, lgx: 0, lgz: 0, lgy0: 0.01 * s, lgy1: TOP - (TOP - BODY_TOP) * s, lgk0: 1.03, lgk1: 0.95, fz: s * 1.08 });
  if (STRAPS.includes(node)) {
    const top = TOP - (TOP - BODY_TOP) * (p.lk as number);
    Object.assign(p, { sox: 0, soy: top, soz: 0, sdx: 0, sdy: 1, sdz: 0, s0: 0, sk: STRAP[c.strap] ?? 1 });
  }
  return p;
}

// Strap centerlines on the outer face, right end first (probed from the mesh).
const STRAP_FRONT: [V3[], V3[]] = [
  [[0.0843, 0.1265, 0.04], [0.0853, 0.1389, 0.0399], [0.0858, 0.1523, 0.0397], [0.0854, 0.1672, 0.0393], [0.084, 0.1831, 0.0389], [0.0816, 0.1993, 0.0383], [0.0789, 0.2153, 0.0371], [0.0764, 0.2315, 0.0353], [0.0739, 0.2479, 0.0333], [0.0709, 0.2651, 0.0318], [0.0675, 0.2836, 0.0303], [0.0635, 0.3044, 0.0284], [0.0581, 0.3277, 0.0257], [0.0497, 0.3518, 0.0229], [0.0371, 0.3735, 0.0204], [0.02, 0.3887, 0.0187], [0, 0.3942, 0.0182], [-0.02, 0.3887, 0.0187], [-0.0371, 0.3735, 0.0204], [-0.0497, 0.3518, 0.0229], [-0.0581, 0.3277, 0.0257], [-0.0635, 0.3044, 0.0284], [-0.0675, 0.2836, 0.0303], [-0.0709, 0.2651, 0.0318], [-0.0739, 0.2479, 0.0333], [-0.0764, 0.2315, 0.0353], [-0.0789, 0.2153, 0.0371], [-0.0816, 0.1993, 0.0383], [-0.084, 0.1831, 0.0389], [-0.0854, 0.1672, 0.0393], [-0.0858, 0.1523, 0.0397], [-0.0853, 0.1389, 0.0399], [-0.0843, 0.1265, 0.04]],
  [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
];
const STRAP_BACK: [V3[], V3[]] = [
  [[0.0843, 0.1265, -0.04], [0.0853, 0.1389, -0.0399], [0.0858, 0.1523, -0.0397], [0.0854, 0.1672, -0.0393], [0.084, 0.1831, -0.0389], [0.0816, 0.1993, -0.0383], [0.0789, 0.2153, -0.0371], [0.0764, 0.2315, -0.0353], [0.0739, 0.2479, -0.0333], [0.0709, 0.2651, -0.0318], [0.0675, 0.2836, -0.0303], [0.0635, 0.3044, -0.0284], [0.0581, 0.3277, -0.0257], [0.0497, 0.3518, -0.0229], [0.0371, 0.3735, -0.0204], [0.02, 0.3887, -0.0187], [0, 0.3942, -0.0182], [-0.02, 0.3887, -0.0187], [-0.0371, 0.3735, -0.0204], [-0.0497, 0.3518, -0.0229], [-0.0581, 0.3277, -0.0257], [-0.0635, 0.3044, -0.0284], [-0.0675, 0.2836, -0.0303], [-0.0709, 0.2651, -0.0318], [-0.0739, 0.2479, -0.0333], [-0.0764, 0.2315, -0.0353], [-0.0789, 0.2153, -0.0371], [-0.0816, 0.1993, -0.0383], [-0.084, 0.1831, -0.0389], [-0.0854, 0.1672, -0.0393], [-0.0858, 0.1523, -0.0397], [-0.0853, 0.1389, -0.0399], [-0.0843, 0.1265, -0.04]],
  [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]],
];

function extraZones(_zones: Record<string, Zone>, c: Record<string, string>): Record<string, Zone> {
  if (c.strap === "none") return {};
  return {
    handle_left: deformedPath("strap_front", "front strap", ...STRAP_FRONT, deform(c, "strap_front")),
    handle_right: deformedPath("strap_back", "back strap", ...STRAP_BACK, deform(c, "strap_back")),
  };
}

export const bagShoulder = meshTemplate({
  id: "bag_shoulder",
  model: "bag_shoulder",
  name: "Oblong shoulder bag",
  category: "shoulder bag",
  kind: "bag",
  keywords: ["shoulder bag", "handbag", "purse", "baguette bag", "baguette", "hobo bag", "top handle bag", "clutch"],
  description: "Minimal oblong shoulder bag: padded pillow panels in a wrap-around gusset, top zip and a slim doubled shoulder strap",
  targetPriceUsd: 160,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size (medium is 30 cm wide, 14 cm tall)" },
    shape: { options: ["structured", "slouchy"], default: "structured", description: "crisp box or a softer, rounder hobo body" },
    strap: { options: ["top_handle", "shoulder", "long", "none"], default: "shoulder", description: "strap drop: short top handle, shoulder, long, or none (clutch)" },
  },
  slots: {
    shell: { description: "front and back panels", nodes: ["panel_front", "panel_back"], default: { preset: "leather", color: "#141416" } },
    sides: { description: "gusset and base band", nodes: ["gusset", "base"], default: { preset: "leather", color: "#141416" }, follows: ["trim:leather,leather_pebbled,patent_leather,suede", "shell"] },
    strap: { description: "shoulder strap", nodes: ["strap_front", "strap_back"], default: { preset: "leather", color: "#141416" } },
    trim: { description: "painted edges and piping", nodes: [], default: { preset: "leather", color: "#141416" } },
    hardware: { description: "zip and plate", nodes: [], default: { preset: "metal_polished", color: "#CDD1D6" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#1E1F22" } },
    lining: { description: "inside", nodes: [], default: { preset: "suede", color: "#3A3A3E" } },
    accent: { description: "charms, scarves, tassels", nodes: [], default: { preset: "satin", color: "#E8E2D6" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "leather", color: "#141416" } },
  },
  root: "gusset",
  deform,
  hide: (c) => (c.strap === "none" ? STRAPS : []),
  names: { gusset: "Gusset", base: "Base band", panel_front: "Front panel", panel_back: "Back panel", strap_front: "Strap (front)", strap_back: "Strap (back)" },
  extraZones,
  modules: [
    { module: "zipper_path", zone: "zip_top", params: { style: "metal", pull: "tab", tape_width: 0.004 }, name: "Top zip" },
    { module: "edge_paint", zone: "edge_front", params: { thickness: 0.002 } },
    { module: "edge_paint", zone: "edge_back", params: { thickness: 0.002 } },
    { module: "logo_plate", zone: "logo_front", params: { shape: "bar", width: 0.034, text: "maison" } },
    { module: "strap_keeper", zone: "handle_left@0.8", params: { width: 0.016, strap: 0.009, height: 0.012 }, material: "strap", name: "Strap keeper" },
  ],
  display: "pedestal",
});
