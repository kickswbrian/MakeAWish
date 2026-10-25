import type { KitEntry, KitEnumParam } from "../kit.ts";

/** Detail modules: trims. Builders live in web/src/three/parts/kit/trims.ts. */

/**
 * Where a path trim sits relative to its path. W points into the garment (up the sleeve from a cuff,
 * up the body from a hem): inside = from the path toward +W (on the garment), outside = hanging past
 * the edge toward -W, center = straddling the path.
 */
const align = (def: "inside" | "center" | "outside"): KitEnumParam => ({
  options: ["inside", "center", "outside"],
  default: def,
  description: "inside: on the garment from the path; outside: hangs past the edge; center: straddles the path",
});

export const TRIMS: KitEntry[] = [
  {
    id: "rib_band",
    name: "Rib knit band",
    description:
      "Ribbed knit band (bomber/sweatshirt cuff, hem, waistband, collar) with raised rib columns and a rolled folded edge at the path; follow a closed cuff/hem path. height = band depth, pitch = one knit+purl rib repeat.",
    size: [0.3, 0.05, 0.005],
    attach: {},
    params: {
      height: { default: 0.05, min: 0.008, max: 0.2, description: "band depth across the path in meters" },
      thickness: { default: 0.004, min: 0.0015, max: 0.012, description: "folded band thickness" },
      pitch: { default: 0.004, min: 0.0018, max: 0.012, description: "rib repeat (one raised column group + one valley)" },
      rib: { options: ["2x2", "1x1"], default: "2x2", description: "rib structure: paired columns (2x2) or fine single columns (1x1)" },
      align: align("inside"),
    },
    material: "rib_knit",
    path: true,
    family: "trim",
    slot: "trim",
    categories: ["top", "outerwear", "bottom", "dress", "accessory"],
    zones: ["cuff_left", "cuff_right", "hem", "waistband", "collar", "neckline", "hem_left", "hem_right"],
  },
  {
    id: "ruffle",
    name: "Ruffle",
    description:
      "Gathered fabric frill with soft irregular flutes and a stitched, gathered heading on the path; hangs past the edge by default. fullness sets how deep the waves are; layers 2 adds a shorter frill on top.",
    size: [0.3, 0.045, 0.02],
    attach: {},
    params: {
      height: { default: 0.04, min: 0.01, max: 0.15, description: "frill depth from the stitch line in meters" },
      fullness: { default: 2.2, min: 1.3, max: 3.5, description: "gathering ratio: 1.3 gently wavy, 3.5 very full" },
      layers: { default: 1, min: 1, max: 2, description: "1 or 2 tiers (the second is shorter, on top)" },
      align: align("outside"),
    },
    material: "cotton",
    path: true,
    family: "trim",
    slot: "shell",
    categories: ["top", "dress", "skirt", "bottom", "outerwear"],
    zones: ["hem", "neckline", "collar", "cuff_left", "cuff_right", "placket", "shoulder_left", "shoulder_right", "armhole_left", "armhole_right", "waist"],
  },
  {
    id: "lace_trim",
    name: "Lace edging",
    description:
      "Scalloped lace edging with a picot edge, eyelets and a beading row, thin and flat, hanging past the edge by default. scallop = width of each scallop repeat; style eyelet adds cut-work flowers (broderie anglaise).",
    size: [0.3, 0.03, 0.001],
    attach: {},
    params: {
      height: { default: 0.03, min: 0.008, max: 0.1, description: "lace depth across the path in meters" },
      scallop: { default: 0.016, min: 0.006, max: 0.05, description: "width of one scallop repeat" },
      style: { options: ["lace", "eyelet"], default: "lace", description: "lace: net lace (pair with the lace preset); eyelet: broderie anglaise cut-work flowers (pair with cotton)" },
      align: align("outside"),
    },
    material: "lace",
    path: true,
    family: "trim",
    slot: "trim",
    categories: ["top", "dress", "skirt", "bottom"],
    zones: ["hem", "neckline", "cuff_left", "cuff_right", "collar", "hem_left", "hem_right", "waist"],
  },
  {
    id: "bow",
    name: "Ribbon bow",
    description:
      "Tied ribbon bow facing +Z: two soft loops along ±X, a wrapped knot at the origin and two notched tails hanging down -Y. width = loop-to-loop span; style ribbon (satin), velvet (plush, thick), skinny (narrow ribbon, long tails) or oversized (big floppy loops).",
    size: [0.08, 0.085, 0.026],
    attach: { knot: [0, 0, 0.014] },
    params: {
      width: { default: 0.08, min: 0.02, max: 0.4, description: "bow span across both loops in meters" },
      style: { options: ["ribbon", "velvet", "skinny", "oversized"], default: "ribbon", description: "ribbon proportions and weight" },
    },
    material: "satin",
    family: "trim",
    slot: "accent",
    categories: ["top", "dress", "skirt", "bag", "accessory", "outerwear", "jewelry"],
    zones: ["chest_center", "neckline", "back_center", "waist", "front_center", "shoulder_left", "shoulder_right", "earlobe", "strap_anchor_left", "strap_anchor_right"],
  },
  {
    id: "piping",
    name: "Piping",
    description:
      "Cord-filled bias piping along a seam (center) or proud of a finished edge (outside); radius sets the cord size.",
    size: [0.3, 0.006, 0.004],
    attach: {},
    params: {
      radius: { default: 0.0018, min: 0.0008, max: 0.006, description: "piping cord radius in meters" },
      align: { options: ["center", "outside"], default: "center", description: "center: inserted in a seam; outside: rolls past a garment edge" },
    },
    material: "satin",
    path: true,
    family: "trim",
    slot: "trim",
    categories: ["top", "outerwear", "dress", "bag", "bottom", "skirt", "accessory"],
    zones: ["collar", "neckline", "placket", "side_seam_left", "side_seam_right", "shoulder_left", "shoulder_right", "back_yoke", "edge_front", "edge_back", "flap_edge", "top_edge", "waistband_top"],
  },
  {
    id: "ruching",
    name: "Ruching",
    description:
      "Gathered band with dense soft chevron wrinkles fanning from a gathered center line (scrunch seam, sleeve or side ruching); centered on the path by default. density = wrinkles per cm.",
    size: [0.3, 0.05, 0.006],
    attach: {},
    params: {
      height: { default: 0.05, min: 0.01, max: 0.2, description: "ruched band width across the path in meters" },
      density: { default: 1.6, min: 0.5, max: 4, description: "wrinkles per centimeter of path" },
      align: align("center"),
    },
    material: "jersey",
    path: true,
    family: "trim",
    slot: "shell",
    categories: ["top", "dress", "bottom", "skirt"],
    zones: ["back_center", "side_seam_left", "side_seam_right", "sleeve_left", "sleeve_right", "outseam_left", "outseam_right", "waist", "neckline", "chest_center"],
  },
  {
    id: "fringe",
    name: "Fringe",
    description:
      "Hanging strands (cut suede strips or twisted yarn) from a stitched heading strip on the path; hangs past the edge by default. length = strand length, density = strands per cm.",
    size: [0.3, 0.07, 0.006],
    attach: {},
    params: {
      length: { default: 0.06, min: 0.015, max: 0.3, description: "strand length in meters" },
      density: { default: 3, min: 1, max: 8, description: "strands per centimeter" },
      style: { options: ["suede", "yarn"], default: "suede", description: "flat cut suede strips or round twisted yarn" },
      align: align("outside"),
    },
    material: "suede",
    path: true,
    family: "trim",
    slot: "trim",
    categories: ["outerwear", "top", "skirt", "dress", "bag", "accessory"],
    zones: ["hem", "back_yoke", "chest_center", "cuff_left", "cuff_right", "flap_edge", "edge_front", "hem_left", "hem_right", "shoulder_left", "shoulder_right"],
  },
  {
    id: "scallop_edge",
    name: "Scalloped edge",
    description:
      "Scalloped faced edge band (collar, hem, cuff) with rounded scallops and topstitching that follows each scallop; extends past the edge by default. height = depth at the scallop tips, scallop = width of each scallop.",
    size: [0.3, 0.014, 0.003],
    attach: {},
    params: {
      height: { default: 0.014, min: 0.004, max: 0.06, description: "band depth at the scallop tips in meters" },
      scallop: { default: 0.018, min: 0.006, max: 0.06, description: "width of one scallop" },
      align: align("outside"),
    },
    material: "cotton",
    path: true,
    family: "trim",
    slot: "shell",
    categories: ["top", "dress", "skirt", "bottom", "outerwear"],
    zones: ["collar", "hem", "neckline", "cuff_left", "cuff_right", "placket", "hem_left", "hem_right", "flap_edge"],
  },
  {
    id: "pompom",
    name: "Pompom",
    description: "Fluffy yarn pompom of cut strands, sewn on at its base (origin on the surface, ball out along +Z). radius = ball radius.",
    size: [0.04, 0.04, 0.038],
    attach: { top: [0, 0, 0.038] },
    params: { radius: { default: 0.02, min: 0.006, max: 0.07, description: "pompom radius in meters" } },
    material: "knit",
    family: "trim",
    slot: "trim",
    categories: ["accessory", "top", "outerwear", "bag", "skirt"],
    zones: ["front_center", "chest_center", "back_center", "strap_anchor_left", "strap_anchor_right", "drop_point", "hip_left", "hip_right"],
  },
  {
    id: "sherpa_band",
    name: "Sherpa band",
    description:
      "Fluffy sherpa/teddy pile band of clumped curls (collar, cuff, lining edge) with a rounded fluffy edge at the path. pile = curl height.",
    size: [0.3, 0.05, 0.008],
    attach: {},
    params: {
      height: { default: 0.05, min: 0.01, max: 0.2, description: "band depth across the path in meters" },
      pile: { default: 0.006, min: 0.002, max: 0.015, description: "curl pile height" },
      align: align("inside"),
    },
    material: "sherpa",
    path: true,
    family: "trim",
    slot: "trim",
    categories: ["outerwear", "top", "accessory", "bag"],
    zones: ["collar", "cuff_left", "cuff_right", "hem", "placket", "neckline", "flap_edge"],
  },
  {
    id: "puff_band",
    name: "Shirred band",
    description:
      "Smocked/shirred band: parallel rows of elastic stitching with crinkled fabric puffing between them (puff sleeve cuffs, smocked waists and bodices). spacing = distance between elastic rows.",
    size: [0.3, 0.035, 0.005],
    attach: {},
    params: {
      height: { default: 0.035, min: 0.01, max: 0.2, description: "band depth across the path in meters" },
      spacing: { default: 0.007, min: 0.004, max: 0.015, description: "distance between elastic rows" },
      align: align("inside"),
    },
    material: "cotton",
    path: true,
    family: "trim",
    slot: "shell",
    categories: ["top", "dress", "skirt"],
    zones: ["cuff_left", "cuff_right", "waist", "neckline", "waistband", "hem", "chest_center"],
  },
];
