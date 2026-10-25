import type { KitEntry } from "../kit.ts";

/**
 * Detail modules: bag hardware and finishing. Builders live in web/src/three/parts/kit/bag.ts.
 *
 * Metal pieces take the part material (the template's "hardware" slot by default). Leather / silk
 * pieces set `slot` so a template paints them from its strap / accent / trim slot instead; where a
 * module mixes the two, the secondary finish is an enum param (metal: gold..., tab: black...).
 */

const BAG: ["bag", "accessory"] = ["bag", "accessory"];

const METAL_OPTS = ["gold", "silver", "gunmetal", "rose_gold", "black"];
const LEATHER_OPTS = ["black", "cognac", "tan", "cream", "red", "navy", "white", "burgundy"];

export const BAG_HARDWARE: KitEntry[] = [
  {
    id: "turn_lock",
    name: "Turn lock",
    description:
      "Polished metal flap closure with screws and a turning knob, centered on its origin (put it on the flap front, +Y up). style: twist (oval eyelet plate, T-bar knob), push (rectangular push-button housing with flap tongue), cl_turn (rectangular window frame, 4 screws, turn key), tongue (metal tongue over a receiver plate); size = plate width.",
    size: [0.032, 0.0164, 0.0062],
    attach: { knob: [0, 0, 0.0044] },
    params: {
      style: { options: ["twist", "push", "cl_turn", "tongue"], default: "twist", description: "lock construction" },
      size: { default: 0.032, min: 0.016, max: 0.06, description: "plate width in meters (everything scales with it)" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["front_center", "front_panel"],
  },
  {
    id: "foot_stud",
    name: "Bag foot",
    description:
      "Metal bag foot on a stamped prong washer, rising +Z from the base; place it on base_corners with count 4 (or 5).",
    size: [0.0166, 0.0166, 0.0049],
    attach: {},
    params: {
      shape: { options: ["dome", "flat", "cone"], default: "dome", description: "crown shape" },
      radius: { default: 0.0065, min: 0.004, max: 0.012, description: "foot radius (washer is ~35% wider)" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["base_corners"],
  },
  {
    id: "chain_strap",
    name: "Chain strap",
    description:
      "Metal chain strap following the path, links lying flat against the path normal. style: curb (twisted flat links), leather_woven (curb chain with a leather ribbon woven through, the quilted-bag look; ribbon = its color), box (square links); link = link length.",
    size: [0.3, 0.0094, 0.005],
    attach: {},
    params: {
      style: { options: ["curb", "leather_woven", "box"], default: "leather_woven", description: "chain construction" },
      link: { default: 0.012, min: 0.005, max: 0.03, description: "outer length of one link in meters" },
      ribbon: { options: LEATHER_OPTS, default: "black", description: "woven leather color (leather_woven only)" },
    },
    material: "metal_polished",
    path: true,
    family: "bag_hardware",
    categories: BAG,
    zones: ["handle_left", "handle_right"],
  },
  {
    id: "handle_wrap",
    name: "Twilly handle wrap",
    description:
      "Silk scarf wrapped in a spiral around a handle path (path = handle centerline), knotted at one end with two pointed tails hanging -Y. width = band width, pitch = advance per turn (pitch < width overlaps), handle = handle radius; print adds rolled contrast hems, stripes or dots.",
    size: [0.3, 0.11, 0.034],
    attach: {},
    params: {
      width: { default: 0.02, min: 0.008, max: 0.05, description: "visible band width" },
      pitch: { default: 0.018, min: 0.008, max: 0.08, description: "distance along the handle per full turn" },
      handle: { default: 0.006, min: 0.003, max: 0.02, description: "radius of the handle it wraps" },
      tails: { default: 0.09, min: 0, max: 0.25, description: "length of the knotted tails (0 = no knot)" },
      print: { options: ["edged", "striped", "dotted", "solid"], default: "edged", description: "silk pattern (accent = contrast of the silk color)" },
      tie: { options: ["start", "end"], default: "start", description: "path end the knot sits at" },
    },
    material: "satin",
    path: true,
    family: "bag_hardware",
    slot: "accent",
    categories: BAG,
    zones: ["handle_left", "handle_right"],
  },
  {
    id: "edge_paint",
    name: "Edge paint",
    description:
      "Glossy painted bead over a cut leather edge: covers the edge face just past the path (-W) from the surface down `thickness` and wraps ~0.6 mm onto the face. Always a high-gloss lacquer in the part's color.",
    size: [0.3, 0.0013, 0.0033],
    attach: {},
    params: {
      thickness: { default: 0.003, min: 0.001, max: 0.008, description: "height of the leather edge it covers" },
      bead: { default: 0.0006, min: 0.0002, max: 0.0015, description: "how far the rounded bead bulges past the edge" },
    },
    material: "patent_leather",
    path: true,
    family: "bag_hardware",
    slot: "trim",
    categories: BAG,
    zones: ["edge_front", "edge_back", "flap_edge", "top_edge"],
  },
  {
    id: "swivel_hook",
    name: "Swivel snap hook",
    description:
      "Detachable-strap trigger snap hook lying on the surface: strap eye at the top (+Y), swivel barrel, hook body hanging -Y with a spring gate on the +X side. width = strap width the eye takes.",
    size: [0.0257, 0.047, 0.0055],
    attach: { eye: [0, 0.0137, 0.0025], hook: [0, -0.026, 0.0025] },
    params: { width: { default: 0.02, min: 0.008, max: 0.05, description: "inner width of the strap eye" } },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["strap_anchor_left", "strap_anchor_right"],
  },
  {
    id: "o_ring",
    name: "O-ring with tab",
    description:
      "Metal O-ring (main) held by a stitched leather tab folded around it; tab sewn on at +Y, ring hangs -Y. tab = leather color, radius = ring radius.",
    size: [0.0236, 0.0453, 0.0066],
    attach: { ring: [0, -0.0145, 0.0035] },
    params: {
      radius: { default: 0.01, min: 0.005, max: 0.025, description: "ring centerline radius" },
      tab: { options: LEATHER_OPTS, default: "black", description: "leather tab color" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["strap_anchor_left", "strap_anchor_right", "side_left", "side_right"],
  },
  {
    id: "magnetic_snap",
    name: "Magnetic snap",
    description:
      "Magnetic bag snap (two metal discs) on the inside of an opening, facing +Z. state: closed (stacked, prong washer on top) or open (female socket at -X, male stud at +X).",
    size: [0.018, 0.018, 0.0036],
    attach: {},
    params: {
      state: { options: ["closed", "open"], default: "closed", description: "shown snapped together or as two halves" },
      size: { default: 0.018, min: 0.01, max: 0.026, description: "female disc diameter" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["top_edge"],
  },
  {
    id: "logo_plate",
    name: "Logo plate",
    description:
      "Small polished metal plaque facing +Z with an engraved border and generic engraved lettering. shape: rect, oval or bar; width sets the size; text picks the lettering.",
    size: [0.032, 0.0115, 0.0015],
    attach: {},
    params: {
      shape: { options: ["rect", "oval", "bar"], default: "rect", description: "plaque outline" },
      width: { default: 0.032, min: 0.012, max: 0.08, description: "plaque width" },
      text: { options: ["maison", "made_in_italy", "genuine_leather", "none"], default: "maison", description: "engraved lettering" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["front_center", "front_panel", "back_panel"],
  },
  {
    id: "tassel",
    name: "Tassel",
    description:
      "Tassel hanging -Y from a cord loop at the origin: a cap, then leather strips or fine threads (main). material: leather or thread; length = strands; metal = cap finish (self = wrapped in the tassel's own material).",
    size: [0.016, 0.101, 0.017],
    attach: { top: [0, 0, 0] },
    params: {
      material: { options: ["leather", "thread"], default: "leather", description: "strand type" },
      length: { default: 0.08, min: 0.03, max: 0.2, description: "strand length below the cap" },
      metal: { options: [...METAL_OPTS, "self"], default: "gold", description: "cap finish" },
    },
    material: "leather",
    family: "bag_hardware",
    slot: "accent",
    categories: BAG,
    zones: ["strap_anchor_left", "strap_anchor_right", "zip_top", "side_left", "side_right"],
  },
  {
    id: "bag_charm",
    name: "Bag charm",
    description:
      "Dangling bag charm: snap clip at the origin (hook up), short chain hanging -Y, and a charm: pompom (fur ball), heart, star, letter (bubble initial) or bear (plush). Clip, chain and metal charms are main; fur = pompom/bear color.",
    size: [0.04, 0.1, 0.041],
    attach: { clip: [0, 0, 0] },
    params: {
      charm: { options: ["pompom", "heart", "star", "letter", "bear"], default: "pompom", description: "charm shape" },
      letter: { options: ["a", "b", "c", "d", "e", "g", "h", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "v", "w", "y"], default: "m", description: "initial for the letter charm" },
      fur: { options: ["cream", "white", "pink", "lilac", "brown", "black", "grey"], default: "cream", description: "pompom / bear color" },
    },
    material: "metal_polished",
    family: "bag_hardware",
    categories: BAG,
    zones: ["strap_anchor_left", "strap_anchor_right", "handle_left", "handle_right"],
  },
  {
    id: "strap_keeper",
    name: "Strap keeper",
    description:
      "Stitched leather loop wrapped around a strap that runs along Y; origin on the strap's front face. width = strap width it wraps, strap = strap thickness.",
    size: [0.0232, 0.0124, 0.0069],
    attach: {},
    params: {
      width: { default: 0.02, min: 0.008, max: 0.05, description: "width of the strap it holds" },
      strap: { default: 0.0035, min: 0.0015, max: 0.008, description: "thickness of the strap it holds" },
      height: { default: 0.012, min: 0.006, max: 0.03, description: "keeper height along the strap" },
    },
    material: "leather",
    family: "bag_hardware",
    slot: "strap",
    categories: BAG,
    zones: ["handle_left", "handle_right", "strap_anchor_left", "strap_anchor_right"],
  },
  {
    id: "zip_puller",
    name: "Leather zip puller",
    description:
      "Leather tab zip pull (main) with stitched, edge-painted sides, hung from a metal eyelet and ring at the origin (the slider's bail); tab hangs -Y. metal = ring finish, end = tab tip shape.",
    size: [0.0129, 0.043, 0.0083],
    attach: { ring: [0, 0, 0.0042] },
    params: {
      length: { default: 0.038, min: 0.015, max: 0.08, description: "tab length" },
      end: { options: ["round", "point", "square"], default: "round", description: "tab tip" },
      metal: { options: METAL_OPTS, default: "gold", description: "ring and eyelet finish" },
    },
    material: "leather",
    family: "bag_hardware",
    slot: "strap",
    categories: BAG,
    zones: ["zip_top"],
  },
  {
    id: "quilting_stitch",
    name: "Quilting stitch line",
    description:
      "One line of sunk quilting stitches along the path (for a whole diamond grid use the quilted material instead); pitch = stitch spacing.",
    size: [0.3, 0.0009, 0.0005],
    attach: {},
    params: { pitch: { default: 0.0035, min: 0.002, max: 0.008, description: "stitch spacing" } },
    material: "cotton",
    path: true,
    family: "bag_hardware",
    slot: "thread",
    categories: BAG,
    zones: ["flap_edge", "edge_front", "edge_back", "top_edge"],
  },
];
