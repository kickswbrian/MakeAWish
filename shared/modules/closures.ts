import type { KitEntry, KitParamSpec } from "../kit.ts";

/** Detail modules: closures. Builders live in web/src/three/parts/kit/closures.ts. */

const FINISH: KitParamSpec = {
  options: ["auto", "copper", "brass", "nickel", "antique", "gunmetal", "gold", "black"],
  default: "auto",
  description: "metal finish for the hardware (auto = the part material when it is metal, else nickel)",
};
const SOFT = ["auto", "black", "charcoal", "navy", "ecru", "white", "tan", "olive", "red"];

export const CLOSURES: KitEntry[] = [
  {
    id: "zipper_path",
    name: "Zipper",
    description:
      "Zipper following the path (its center line): woven tape both sides, interlocking #5 teeth, a bottom stop at the first point and the slider + pull at the LAST point (put the last point at the top of a jacket front or fly, at the closed end of a bag top). Given a metal (hardware) material the teeth and slider take it and the tape uses `tape`; given a fabric, the tape takes it and the hardware uses `finish`.",
    size: [0.3, 0.022, 0.006],
    attach: {},
    params: {
      style: { options: ["metal", "plastic", "invisible"], default: "metal", description: "metal scoop teeth, molded plastic teeth (tape-colored), or invisible (only the seam and a small slider)" },
      pull: { options: ["tab", "ring", "leather_tab", "cord"], default: "tab", description: "zipper pull: metal tab, ring, leather strip, or cord loop with a rubber end" },
      finish: FINISH,
      tape: { options: SOFT, default: "auto", description: "tape color when the part material is metal (auto = black)" },
      tape_width: { default: 0.006, min: 0.002, max: 0.016, description: "visible tape width each side of the teeth in meters" },
    },
    material: "metal_polished",
    path: true,
    family: "closure",
    categories: ["outerwear", "top", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["placket", "fly", "zip_top", "top_edge", "side_seam_left", "side_seam_right", "back_center", "pocket_front_left", "pocket_front_right"],
  },
  {
    id: "button",
    name: "Button",
    description:
      "Clothing button facing +Z: flat4/flat2 sew-through (contrast thread), shank_dome, jeans_tack (metal tack button with stamped rim), toggle (duffle peg with rope loop and leather tab, rope rising +Y), covered (fabric dome, pass the shell material), pearl_dome (use preset pearl), horn_rim (use preset horn). The part material is the button body.",
    size: [0.015, 0.015, 0.004],
    attach: {},
    params: {
      style: {
        options: ["flat4", "flat2", "shank_dome", "jeans_tack", "toggle", "covered", "pearl_dome", "horn_rim"],
        default: "flat4",
        description: "button type",
      },
      radius: { default: 0.0075, min: 0.004, max: 0.02, description: "button radius (shirts 0.005, coats 0.011, jeans tack 0.0085; toggle length = 5x)" },
      finish: FINISH,
    },
    material: "plastic_gloss",
    family: "closure",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["placket", "cuff_left", "cuff_right", "waistband", "fly", "chest_left", "chest_right", "collar", "flap_edge", "front_center", "sleeve_left", "sleeve_right"],
  },
  {
    id: "drawstring",
    name: "Drawstring",
    description:
      "Braided round cord along the path (the path is the visible cord, e.g. one hanging from a hood or waistband eyelet) with aglets at the ends. Given a metal material the aglets take it and the cord uses `cord`; given a fabric, the cord takes it.",
    size: [0.02, 0.2, 0.006],
    attach: {},
    params: {
      aglet: { options: ["metal", "plastic", "knot"], default: "metal", description: "cord ends: metal tips, clear plastic tips, or tied knots" },
      ends: { options: ["both", "end"], default: "both", description: "aglets on both ends, or only the last point (the first point disappears into an eyelet)" },
      radius: { default: 0.0025, min: 0.001, max: 0.006, description: "cord radius" },
      cord: { options: SOFT, default: "auto", description: "cord color when the part material is metal (auto = ecru)" },
      finish: FINISH,
    },
    material: "cotton",
    slot: "trim",
    path: true,
    family: "closure",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["waistband", "waist", "hem", "collar", "neckline", "top_edge"],
  },
  {
    id: "hook_eye",
    name: "Hook and eye",
    description:
      "Small wire hook-and-eye pair lying on the surface, hook on the left catching the eye on the right (closure along X), sewn down with whip stitches: waistbands, dress backs, bra-style closures.",
    size: [0.026, 0.008, 0.002],
    attach: { hook: [-0.006, 0, 0], eye: [0.007, 0, 0] },
    params: { finish: FINISH },
    material: "metal_polished",
    family: "closure",
    categories: ["dress", "skirt", "bottom", "top"],
    zones: ["waistband", "back_center", "neckline", "placket"],
  },
  {
    id: "lacing",
    name: "Lacing",
    description:
      "Criss-cross lacing along the path (its center line) through metal eyelets in two columns width apart, tied in a bow at the last point (corset backs, sneaker throats, lace-up necklines). Given a metal material the eyelets take it and the lace uses `lace_color`; given a fabric, the lace takes it.",
    size: [0.04, 0.2, 0.004],
    attach: {},
    params: {
      width: { default: 0.03, min: 0.008, max: 0.1, description: "distance between the two eyelet columns in meters" },
      count: { default: 6, min: 2, max: 20, description: "eyelet pairs along the path" },
      lace: { options: ["round", "flat"], default: "round", description: "round cord or flat lace" },
      bow: { options: ["bow", "none"], default: "bow", description: "tie a bow at the last pair" },
      lace_color: { options: SOFT, default: "auto", description: "lace color when the part material is metal (auto = black)" },
      finish: FINISH,
    },
    material: "cotton",
    path: true,
    family: "closure",
    categories: ["top", "dress", "outerwear", "accessory", "bag"],
    zones: ["back_center", "placket", "neckline", "side_seam_left", "side_seam_right", "front_center"],
  },
];
