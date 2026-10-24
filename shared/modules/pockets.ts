import type { KitEntry, KitEnumParam, KitNumberParam, ModuleCategory } from "../kit.ts";

/** Detail modules: pockets. Builders live in web/src/three/parts/kit/pockets.ts. */

/** Option lists shared with the builders (they receive the option index). */
export const THREAD_OPTIONS = ["contrast", "gold", "tonal"];
export const METAL_OPTIONS = ["copper", "brass", "nickel", "gunmetal", "black"];
export const POCKET_OPTIONS = {
  stitch: ["single", "double"],
  corner: ["square", "rounded", "pointed"],
  patchFlap: ["none", "flap", "flap_button"],
  button: ["sewn", "metal"],
  lips: ["single", "double"],
  weltFlap: ["none", "flap"],
  closure: ["snap", "button"],
  flapClosure: ["none", "button", "snap"],
  pleat: ["none", "box"],
  slash: ["curved", "slant"],
  side: ["left", "right"],
  rivet: ["none", "rivet"],
  deco: ["arc", "v", "none"],
};

const num = (def: number, min: number, max: number, description: string): KitNumberParam => ({ default: def, min, max, description });
const pick = (options: string[], def: string, description: string): KitEnumParam => ({ options: [...options], default: def, description });

export const bendParam = (): KitNumberParam =>
  num(0, 0, 3, "curvature radius (m) of the garment around +Y so the panel hugs it; 0 = flat (templates pass the zone's)");
export const threadParam = (def: string): KitEnumParam =>
  pick(THREAD_OPTIONS, def, "topstitch thread: contrast (cream on dark, charcoal on light), gold (classic jeans), tonal (matches the fabric)");
export const metalParam = (def: string): KitEnumParam => pick(METAL_OPTIONS, def, "hardware finish of rivets, snaps and metal buttons");

const ALL_GARMENTS: ModuleCategory[] = ["top", "outerwear", "bottom", "skirt", "dress", "bag"];

export const POCKETS: KitEntry[] = [
  {
    id: "patch_pocket",
    name: "Patch pocket",
    description:
      "Sewn-on fabric pocket (shirt / trucker-jacket chest, chore coat hip, tote front), open at +Y with a folded top hem, topstitched sides and bottom and tacked top corners; flap adds a flap above the opening (flap_button with a button), corner shapes the bottom.",
    size: [0.12, 0.14, 0.0025],
    attach: { opening: [0, 0.07, 0.002] },
    params: {
      width: num(0.12, 0.05, 0.3, "pocket width"),
      height: num(0.14, 0.05, 0.35, "pocket height (without the flap)"),
      bend: bendParam(),
      corner: pick(POCKET_OPTIONS.corner, "square", "bottom corners: square (barely eased), rounded, or pointed (shirt-style V bottom)"),
      flap: pick(POCKET_OPTIONS.patchFlap, "none", "none, a flap over the opening, or a flap with a button"),
      stitch: pick(POCKET_OPTIONS.stitch, "double", "single edge stitch (shirts) or double-needle topstitch (jackets, workwear)"),
      thread: threadParam("contrast"),
      button: pick(POCKET_OPTIONS.button, "sewn", "flap button: sewn 4-hole or metal shank (trucker jacket)"),
      metal: metalParam("copper"),
    },
    material: "denim",
    family: "pocket",
    categories: ALL_GARMENTS,
    zones: ["chest_left", "chest_right", "hip_left", "hip_right", "thigh_left", "thigh_right", "front_center", "front_panel", "back_panel"],
  },
  {
    id: "welt_pocket",
    name: "Welt pocket",
    description:
      "Tailored slit pocket (blazers, coats, trouser back): one welt board (single) or two piped lips (double, jetted) along X with a dark opening and tacked ends; flap tucks a flap into the opening that hangs over the lower lip.",
    size: [0.14, 0.01, 0.0025],
    attach: { opening: [0, 0, 0.001] },
    params: {
      width: num(0.14, 0.05, 0.25, "opening width along X"),
      height: num(0.01, 0.006, 0.03, "total welt height: a breast welt board is ~0.022, jetted lips ~0.01"),
      lips: pick(POCKET_OPTIONS.lips, "double", "single welt board (breast pocket) or double jetted lips"),
      flap: pick(POCKET_OPTIONS.weltFlap, "none", "none or a tailored flap"),
      bend: bendParam(),
      thread: threadParam("tonal"),
    },
    material: "wool_suiting",
    family: "pocket",
    categories: ["outerwear", "top", "bottom", "skirt", "dress"],
    zones: ["chest_left", "chest_right", "hip_left", "hip_right", "pocket_back_left", "pocket_back_right"],
  },
  {
    id: "cargo_pocket",
    name: "Cargo pocket",
    description:
      "Bellows cargo pocket (cargo pants thigh, field jacket): front panel standing out on pleated side/bottom gussets, optional center box pleat, heavy topstitch, and a flap with two snaps or buttons above the opening at +Y.",
    size: [0.19, 0.225, 0.021],
    attach: { flap: [0, 0.116, 0.012] },
    params: {
      width: num(0.17, 0.08, 0.3, "pocket width"),
      height: num(0.2, 0.08, 0.32, "pocket height (without the flap)"),
      depth: num(0.014, 0.006, 0.04, "how far the bellows front stands off the garment at its bottom"),
      closure: pick(POCKET_OPTIONS.closure, "snap", "the two flap fasteners"),
      pleat: pick(POCKET_OPTIONS.pleat, "box", "center box pleat on the front panel"),
      bend: bendParam(),
      thread: threadParam("tonal"),
      metal: metalParam("gunmetal"),
    },
    material: "canvas",
    family: "pocket",
    categories: ["bottom", "outerwear", "skirt", "bag"],
    zones: ["thigh_left", "thigh_right", "hip_left", "hip_right", "chest_left", "chest_right", "side_left", "side_right", "front_panel"],
  },
  {
    id: "coin_pocket",
    name: "Coin pocket",
    description: "Small jeans watch/coin pocket: hemmed top at +Y, heavy double contrast topstitch, and two rivets at the top corners.",
    size: [0.055, 0.06, 0.0035],
    attach: {},
    params: {
      width: num(0.055, 0.03, 0.09, "pocket width"),
      height: num(0.06, 0.03, 0.09, "pocket height"),
      bend: bendParam(),
      rivet: pick(POCKET_OPTIONS.rivet, "rivet", "rivets at the top corners"),
      thread: threadParam("gold"),
      metal: metalParam("copper"),
    },
    material: "denim",
    family: "pocket",
    categories: ["bottom", "skirt", "outerwear"],
    zones: ["coin_pocket"],
  },
  {
    id: "slash_pocket",
    name: "Front pocket opening",
    description:
      "Jeans/trouser front pocket opening: a curved scoop (or straight slant) edge from the waist (+Y) to the side seam, with a rolled topstitched lip and the pocket facing showing inside; side left puts the side seam at -X, right at +X.",
    size: [0.127, 0.097, 0.0042],
    attach: { waist: [0.055, 0.04, 0], side: [-0.055, -0.04, 0] },
    params: {
      width: num(0.11, 0.05, 0.18, "span along the waist from the side seam to the opening"),
      height: num(0.08, 0.04, 0.2, "drop along the side seam"),
      shape: pick(POCKET_OPTIONS.slash, "curved", "curved scoop (jeans) or straight slant (chinos, trousers)"),
      side: pick(POCKET_OPTIONS.side, "left", "left: side seam toward -X (the pocket on the viewer's left); right mirrors it"),
      stitch: pick(POCKET_OPTIONS.stitch, "double", "single or double topstitch along the opening"),
      rivet: pick(POCKET_OPTIONS.rivet, "rivet", "rivets at both ends of the opening"),
      bend: bendParam(),
      thread: threadParam("gold"),
      metal: metalParam("copper"),
    },
    material: "denim",
    family: "pocket",
    categories: ["bottom", "skirt"],
    zones: ["pocket_front_left", "pocket_front_right"],
  },
  {
    id: "jeans_back_pocket",
    name: "Jeans back pocket",
    description:
      "Five-sided jeans back patch pocket (V bottom), folded top hem at +Y, heavy double topstitch, bar-tacked top corners and a decorative stitch (a simple arc or a V).",
    size: [0.14, 0.155, 0.003],
    attach: {},
    params: {
      width: num(0.14, 0.08, 0.2, "pocket width"),
      height: num(0.155, 0.08, 0.22, "height at the V tip"),
      deco: pick(POCKET_OPTIONS.deco, "arc", "decorative stitch: two parallel arcs, a V, or none"),
      bend: bendParam(),
      thread: threadParam("gold"),
    },
    material: "denim",
    family: "pocket",
    categories: ["bottom", "skirt", "outerwear"],
    zones: ["pocket_back_left", "pocket_back_right"],
  },
  {
    id: "flap",
    name: "Pocket flap",
    description:
      "Standalone pocket flap (over a welt or as a faux pocket), sewn along its top edge at +Y and hanging down -Y, topstitched, with an optional button or snap near the bottom edge.",
    size: [0.13, 0.05, 0.006],
    attach: { closure: [0, -0.016, 0.003] },
    params: {
      width: num(0.13, 0.04, 0.3, "flap width"),
      height: num(0.05, 0.02, 0.12, "flap height"),
      shape: pick(POCKET_OPTIONS.corner, "pointed", "bottom edge: square, rounded corners, or pointed (center V)"),
      closure: pick(POCKET_OPTIONS.flapClosure, "button", "none, a sewn button, or a metal snap"),
      stitch: pick(POCKET_OPTIONS.stitch, "double", "single or double topstitch"),
      bend: bendParam(),
      thread: threadParam("contrast"),
      metal: metalParam("brass"),
    },
    material: "denim",
    family: "pocket",
    categories: ALL_GARMENTS,
    zones: ["chest_left", "chest_right", "hip_left", "hip_right", "thigh_left", "thigh_right", "pocket_back_left", "pocket_back_right", "front_panel"],
  },
  {
    id: "kangaroo_pocket",
    name: "Kangaroo pocket",
    description:
      "Hoodie / sweatshirt front pouch: a wide sewn-on panel with slanted hand openings on both sides (bound and double-stitched), sewn along the top, short sides and bottom; slightly puffed.",
    size: [0.3, 0.19, 0.0055],
    attach: {},
    params: {
      width: num(0.3, 0.16, 0.42, "pouch width at the bottom"),
      height: num(0.19, 0.1, 0.28, "pouch height"),
      bend: bendParam(),
      thread: threadParam("tonal"),
    },
    material: "fleece",
    family: "pocket",
    categories: ["top", "outerwear", "dress"],
    zones: ["chest_center", "front_center"],
  },
];
