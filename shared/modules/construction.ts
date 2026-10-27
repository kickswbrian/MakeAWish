import type { KitEntry, KitParamSpec } from "../kit.ts";

/** Detail modules: construction. Builders live in web/src/three/parts/kit/construction.ts. */

const THREAD: KitParamSpec = {
  options: ["contrast", "gold", "tonal", "cream", "black", "white"],
  default: "tonal",
  description: "stitch thread color: contrast (cream on dark, charcoal on light), gold (jeans), tonal (darker shade of the fabric), cream, black, white",
};
const WEIGHT: KitParamSpec = {
  options: ["fine", "regular", "heavy"],
  default: "regular",
  description: "thread weight: fine (shirts, dresses), regular (jackets, bags), heavy (jeans, workwear)",
};

export const CONSTRUCTION: KitEntry[] = [
  {
    id: "topstitch",
    name: "Topstitch",
    description:
      "Rows of lockstitch thread following the path and hugging the surface (edges, hems, pocket outlines, plackets); the part material is the thread color (jeans: heavy gold). rows=2 is double-needle, gap spaces the rows, offset shifts them along W (into the garment) from the path.",
    size: [0.3, 0.001, 0.0008],
    attach: {},
    params: {
      rows: { default: 1, min: 1, max: 3, description: "parallel rows (2 = double needle)" },
      gap: { default: 0.0064, min: 0.002, max: 0.02, description: "distance between rows in meters" },
      pitch: { default: 0.003, min: 0.0015, max: 0.008, description: "stitch length in meters (2.5-4 mm typical)" },
      weight: WEIGHT,
      offset: { default: 0, min: -0.04, max: 0.04, description: "shift of the rows along W (+ = into the garment) in meters" },
    },
    material: "cotton",
    path: true,
    family: "construction",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["hem", "cuff_left", "cuff_right", "collar", "neckline", "placket", "fly", "waistband", "yoke_back", "back_yoke", "shoulder_left", "shoulder_right", "outseam_left", "outseam_right", "hem_left", "hem_right", "top_edge", "flap_edge", "edge_front", "edge_back", "handle_left", "handle_right", "armhole_left", "armhole_right"],
  },
  {
    id: "seam_welt",
    name: "Welt seam",
    description:
      "Raised flat-felled seam ridge along the path (soft ramp on one side, crisp folded edge toward +W) with rows of stitching on the felled band: side seams, inseams, yokes, shoulders. Material = the garment fabric; stitch color from thread (jeans: gold, heavy).",
    size: [0.3, 0.009, 0.0016],
    attach: {},
    params: {
      width: { default: 0.008, min: 0.004, max: 0.016, description: "felled band width in meters" },
      height: { default: 0.0011, min: 0.0004, max: 0.003, description: "how far the ridge stands off the surface" },
      rows: { default: 2, min: 1, max: 3, description: "stitch rows on the band" },
      thread: THREAD,
      weight: WEIGHT,
    },
    material: "denim",
    slot: "shell",
    path: true,
    family: "construction",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag"],
    zones: ["side_seam_left", "side_seam_right", "inseam_left", "inseam_right", "outseam_left", "outseam_right", "yoke_back", "back_yoke", "shoulder_left", "shoulder_right", "armhole_left", "armhole_right", "edge_front", "edge_back"],
  },
  {
    id: "pleats",
    name: "Pressed pleats",
    description:
      "count pressed pleat folds spaced along the path, each hanging straight from it (toward -W by default; align inside = toward +W) as a raised fold with a crisp edge: skirt and trouser pleats. knife pleats all face one way, box pleats are raised panels with an edge each side; fade softens the lower end (trouser pleats).",
    size: [0.3, 0.18, 0.004],
    attach: {},
    params: {
      count: { default: 4, min: 1, max: 24, description: "number of pleats along the path" },
      depth: { default: 0.003, min: 0.001, max: 0.008, description: "how far each fold stands off the surface" },
      length: { default: 0.18, min: 0.03, max: 0.8, description: "pleat length hanging from the path in meters" },
      style: { options: ["knife", "box"], default: "knife", description: "knife (one-way folds) or box (raised panel, two folds)" },
      align: { options: ["outside", "inside"], default: "outside", description: "outside hangs toward -W (past the edge), inside toward +W" },
      fade: { default: 0.25, min: 0, max: 1, description: "fraction of the length over which the fold flattens out at the bottom (0 = crisp to the end)" },
    },
    material: "wool_suiting",
    slot: "shell",
    path: true,
    family: "construction",
    categories: ["skirt", "bottom", "dress"],
    zones: ["waistband", "waist", "hem"],
  },
  {
    id: "dart",
    name: "Dart",
    description:
      "Sewn dart: a subtle tapered fold pressed to one side with a fine stitch line in its crease, wide end at the origin (on the seam or waistline) running down -Y to its point. Material = the garment fabric.",
    size: [0.008, 0.09, 0.0012],
    attach: { point: [0, -0.09, 0] },
    params: {
      length: { default: 0.09, min: 0.03, max: 0.2, description: "dart length from the seam to its point" },
      width: { default: 0.008, min: 0.003, max: 0.02, description: "width of the fold at the wide end" },
      thread: THREAD,
    },
    material: "cotton",
    slot: "shell",
    family: "construction",
    categories: ["top", "dress", "skirt", "bottom", "outerwear"],
    zones: ["waist", "waistband", "chest_left", "chest_right", "back_center", "yoke_back"],
  },
  {
    id: "bar_tack",
    name: "Bar tack",
    description:
      "Dense zigzag satin-stitch bar along X over a padded core, reinforcing stress points (jeans pocket corners, fly base, belt loops, bag strap ends); the part material is the thread color.",
    size: [0.01, 0.0022, 0.0009],
    attach: { left: [-0.005, 0, 0], right: [0.005, 0, 0] },
    params: {
      length: { default: 0.01, min: 0.004, max: 0.03, description: "bar length along X" },
      width: { default: 0.002, min: 0.0012, max: 0.004, description: "bar width (zigzag span)" },
    },
    material: "cotton",
    family: "construction",
    categories: ["bottom", "outerwear", "top", "bag", "skirt"],
    zones: ["pocket_front_left", "pocket_front_right", "pocket_back_left", "pocket_back_right", "coin_pocket", "fly", "belt_loops", "strap_anchor_left", "strap_anchor_right", "handle_left", "handle_right"],
  },
  {
    id: "jeans_rivet",
    name: "Jeans rivet",
    description:
      "Copper jeans rivet: flanged domed cap with a stamped lettering ring and a peened burr at its center, facing +Z (pocket corners, coin pocket). Takes the part material when it is metal (hardware slot), else the finish option (default copper).",
    size: [0.009, 0.009, 0.0017],
    attach: {},
    params: {
      radius: { default: 0.0045, min: 0.003, max: 0.007, description: "cap radius" },
      finish: {
        options: ["auto", "copper", "brass", "nickel", "antique", "gunmetal", "gold", "black"],
        default: "auto",
        description: "metal finish (auto = the part material if metal, else copper)",
      },
    },
    material: "metal_polished",
    slot: "hardware",
    family: "construction",
    categories: ["bottom", "outerwear", "bag", "skirt"],
    zones: ["pocket_front_left", "pocket_front_right", "coin_pocket", "pocket_back_left", "pocket_back_right", "strap_anchor_left", "strap_anchor_right"],
  },
];
