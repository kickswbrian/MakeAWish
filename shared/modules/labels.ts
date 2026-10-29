import type { KitEntry, KitEnumParam, KitNumberParam } from "../kit.ts";
import { bendParam, threadParam } from "./pockets.ts";

/** Detail modules: labels, patches and graphics. Builders live in web/src/three/parts/kit/labels.ts. */

export const LABEL_OPTIONS = {
  fold: ["flat", "loop"],
  embroidery: ["heart", "star", "flower", "cherry", "bow", "smiley", "sparkle", "butterfly"],
  colors: ["duo", "mono"],
  print: ["heart", "star", "flower", "smiley", "wave", "checker", "bolt"],
  finish: ["solid", "cracked"],
  attach: ["pin", "barb", "string"],
};

const num = (def: number, min: number, max: number, description: string): KitNumberParam => ({ default: def, min, max, description });
const pick = (options: string[], def: string, description: string): KitEnumParam => ({ options: [...options], default: def, description });

export const LABELS: KitEntry[] = [
  {
    id: "woven_label",
    name: "Woven label",
    description:
      "Small woven brand label with woven text: flat (end-folded, sewn at both ends, e.g. inside back neck) or loop (folded in half, sticking out of a seam at the origin and lying down -Y, e.g. a side-seam flag).",
    size: [0.05, 0.02, 0.0009],
    attach: {},
    params: {
      width: num(0.05, 0.02, 0.09, "label width"),
      height: num(0.02, 0.01, 0.05, "label height (loop: visible length)"),
      fold: pick(LABEL_OPTIONS.fold, "flat", "flat end-fold label or a folded loop label"),
      bend: bendParam(),
    },
    material: "satin",
    family: "label",
    slot: "label",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["neck_label", "side_seam_left", "side_seam_right", "hem", "back_center", "waistband", "edge_front"],
  },
  {
    id: "leather_patch",
    name: "Leather patch",
    description:
      "Jeans waistband back patch: leather with a debossed border and debossed wordmark, stitched around its edge; also fits bag fronts and cap backs.",
    size: [0.07, 0.045, 0.0022],
    attach: {},
    params: {
      width: num(0.07, 0.03, 0.12, "patch width"),
      height: num(0.045, 0.02, 0.08, "patch height"),
      bend: bendParam(),
      thread: threadParam("gold"),
    },
    material: "leather",
    family: "label",
    slot: "label",
    categories: ["bottom", "skirt", "outerwear", "bag", "accessory"],
    zones: ["back_patch", "waistband", "front_center", "front_panel", "chest_left", "hip_right"],
  },
  {
    id: "embroidery",
    name: "Embroidery",
    description:
      "Raised satin-stitch embroidered motif sewn straight into the fabric, thread ridges running across each shape; the part material is the thread color (duo adds a fitting accent thread, e.g. green cherry stems).",
    size: [0.035, 0.033, 0.001],
    attach: {},
    params: {
      motif: pick(LABEL_OPTIONS.embroidery, "heart", "the embroidered motif"),
      size: num(0.035, 0.012, 0.12, "motif size (largest dimension)"),
      colors: pick(LABEL_OPTIONS.colors, "duo", "duo: accents in a second thread color; mono: all in the part color"),
      bend: bendParam(),
    },
    material: "satin",
    family: "label",
    slot: "thread",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["chest_left", "chest_right", "chest_center", "sleeve_left", "sleeve_right", "back_center", "hip_left", "hip_right", "thigh_left", "thigh_right", "front_center", "front_panel"],
  },
  {
    id: "print_graphic",
    name: "Screen print",
    description:
      "Screen-printed graphic: a thin layer of ink hugging the fabric (use bend on curved bodies); the part material is the ink color; cracked gives a worn vintage print.",
    size: [0.12, 0.12, 0.0002],
    attach: {},
    params: {
      motif: pick(LABEL_OPTIONS.print, "heart", "the printed graphic"),
      size: num(0.12, 0.02, 0.35, "graphic size (largest dimension)"),
      finish: pick(LABEL_OPTIONS.finish, "solid", "solid fresh ink or cracked vintage ink"),
      bend: bendParam(),
    },
    material: "plastic_matte",
    family: "label",
    slot: "accent",
    categories: ["top", "outerwear", "bottom", "dress", "bag", "accessory"],
    zones: ["chest_center", "chest_left", "back_center", "sleeve_left", "sleeve_right", "front_center", "front_panel", "thigh_left"],
  },
  {
    id: "hang_tag",
    name: "Hang tag",
    description:
      "Card price/brand hang tag (printed logo and barcode) hanging down -Y from the origin on a cord through a brass eyelet, attached with a small safety pin, a plastic barb, or just the cord loop; the part material is the card.",
    size: [0.048, 0.109, 0.006],
    attach: { pin: [0, 0, 0] },
    params: {
      size: num(0.08, 0.04, 0.14, "tag height"),
      attach: pick(LABEL_OPTIONS.attach, "pin", "safety pin, plastic tagging barb, or a cord loop only"),
    },
    material: "canvas",
    family: "label",
    slot: "label",
    categories: ["top", "outerwear", "bottom", "skirt", "dress", "bag", "accessory"],
    zones: ["neck_label", "sleeve_left", "sleeve_right", "side_seam_left", "waistband", "handle_left", "strap_anchor_left"],
  },
];
