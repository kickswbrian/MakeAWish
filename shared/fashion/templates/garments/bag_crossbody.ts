import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Leather sling / crossbody bag over a modeled base: a tall body with a domed top, a shaped front
 * flap with a press stud, a zipped front pocket, a grab loop and an adjustable strap hanging behind.
 * The baked normal map keeps the edge stitching, panel seams and embossing; the source's snap,
 * zipper pulls, buckles and D-ring are dropped and re-added as modules.
 */

const TOP = 0.31;
const SIZE: Record<string, number> = { mini: 0.66, small: 0.83, medium: 1, large: 1.18 };

function deform(c: Record<string, string>): DeformParams {
  const s = SIZE[c.size] ?? 1;
  // Uniform scale from above the bag (the stage grounds it again).
  return { ly: TOP, lk: s, fx: s, fz: s };
}

export const bagCrossbody = meshTemplate({
  id: "bag_crossbody",
  model: "bag_crossbody",
  name: "Crossbody sling bag",
  category: "crossbody bag",
  kind: "bag",
  keywords: ["crossbody", "crossbody bag", "camera bag", "sling bag", "sling", "chest bag"],
  description: "Leather sling bag: tall body with a domed top, shaped snap flap, zipped front pocket, grab loop and an adjustable crossbody strap",
  targetPriceUsd: 140,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size (medium is 30 cm tall, 13 cm wide)" },
    strap: { options: ["sling", "none"], default: "sling", description: "crossbody strap on, or a strapless body for product shots" },
    flap: { options: ["flap", "none"], default: "flap", description: "shaped front flap with a snap, or a plain domed front" },
  },
  slots: {
    shell: { description: "body, flap and pocket", nodes: ["body", "flap", "pocket_front", "top_handle"], default: { preset: "leather", color: "#2E2220" } },
    strap: { description: "crossbody strap", nodes: ["strap"], default: { preset: "leather", color: "#2E2220" } },
    trim: { description: "painted edges and piping", nodes: [], default: { preset: "leather", color: "#1A1414" } },
    hardware: { description: "snap, zipper and rings", nodes: [], default: { preset: "metal_brushed", color: "#9EA2A6" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#D8CDB8" } },
    accent: { description: "charms, tassels", nodes: [], default: { preset: "leather", color: "#8A5A3C" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "leather", color: "#8A5A3C" } },
  },
  root: "body",
  deform,
  hide: (c) => [...(c.strap === "none" ? ["strap"] : []), ...(c.flap === "none" ? ["flap"] : [])],
  names: { body: "Body", flap: "Front flap", pocket_front: "Front pocket", top_handle: "Grab loop", strap: "Strap" },
  modules: [
    { module: "button", zone: "flap_snap", params: { style: "jeans_tack", radius: 0.0065 }, material: "hardware", name: "Flap snap" },
    { module: "topstitch", zone: "flap_edge", params: { rows: 1, offset: 0.0035, weight: "regular", pitch: 0.0035 }, name: "Flap stitching" },
    { module: "edge_paint", zone: "flap_edge", params: { thickness: 0.0025 } },
    { module: "zipper_path", zone: "zip_front", params: { style: "metal", pull: "leather_tab", tape_width: 0.0035 }, name: "Pocket zipper" },
    { module: "bar_tack", zone: "zip_front@0.02", params: { length: 0.012, width: 0.0018 }, name: "Zip end tack" },
    { module: "o_ring", zone: "strap_anchor_right", params: { radius: 0.008, tab: "black" }, name: "Side ring" },
  ],
  display: "pedestal",
});
