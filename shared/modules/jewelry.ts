import type { KitEntry } from "../kit.ts";

/** Detail modules: jewelry. Builders live in web/src/three/parts/kit/jewelry.ts. */

// ---------- Shared dimensions (the earrings template places zones with these) ----------

export const HOOP_PROFILES = ["round", "flat", "twisted", "chunky", "knife_edge"] as const;

/**
 * A hoop's cross-section for a profile and thickness: `radial` across the band (in the hoop's
 * plane), `depth` front to back (along Z). Flat hoops are wide bands, chunky ones puffy tubes.
 */
export function hoopSection(profile: string, thickness: number): { radial: number; depth: number } {
  switch (profile) {
    case "flat":
      return { radial: thickness * 0.55, depth: thickness * 2 };
    case "chunky":
      return { radial: thickness, depth: thickness * 1.3 };
    case "knife_edge":
      return { radial: thickness, depth: thickness * 1.15 };
    default:
      return { radial: thickness, depth: thickness };
  }
}

/** Radius of a hoop's wire centerline: outer diameter minus the band. The ring's top is at the origin. */
export const hoopCenterRadius = (diameter: number, profile: string, thickness: number) => diameter / 2 - hoopSection(profile, thickness).radial / 2;

/** Huggie band: radial thickness given, depth a touch more (a squarish, domed band). */
export const huggieDepth = (thickness: number) => thickness * 1.05;

/** Height of a stone's girdle above the base of a prong or bezel setting (round stone of this diameter). */
export const gemSeatZ = (size: number) => 0.46 * size + 0.0003;

const METALS = ["gold", "silver", "rose_gold", "gunmetal"];
const STONES = ["diamond", "ruby", "sapphire", "emerald", "amethyst", "citrine", "onyx", "pink"];
const metalParam = { options: METALS, default: "gold", description: "metal of the setting (the part material colors the stone)" };
const stoneParam = { options: STONES, default: "diamond", description: "stone color for set stones" };
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

const JEWELRY_CATS: KitEntry["categories"] = ["jewelry", "accessory"];

export const JEWELRY: KitEntry[] = [
  {
    id: "hoop",
    name: "Hoop",
    description:
      "Hoop earring: a ring in the XY plane facing +Z, its top at the origin (the earlobe point), hanging down -Y. Profile sets the band (round tube, flat band, twisted rope, chunky puffy, knife edge); closure hinged (snap post and notch at the top), endless (tapered wire) or click (hidden hinge, seam lines).",
    size: [0.025, 0.025, 0.0026],
    attach: { bottom: [0, -0.025, 0] },
    params: {
      diameter: { default: 0.025, min: 0.008, max: 0.09, description: "outer diameter in meters (small 15 mm, medium 25 mm, large 40 mm)" },
      thickness: { default: 0.0026, min: 0.0008, max: 0.012, description: "band thickness (fine 1.5 mm, regular 2.6 mm, chunky 5 mm)" },
      profile: { options: [...HOOP_PROFILES], default: "round", description: "band cross-section" },
      closure: { options: ["hinged", "endless", "click"], default: "hinged", description: "how it closes at the top" },
    },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["earlobe"],
    family: "jewelry",
  },
  {
    id: "huggie",
    name: "Huggie",
    description:
      "Huggie earring: a small thick hoop that hugs the lobe, in the XY plane facing +Z, top at the origin, with a click hinge near the top. pave adds a row of set stones across the front face (stone color param).",
    size: [0.012, 0.012, 0.0027],
    attach: { bottom: [0, -0.012, 0] },
    params: {
      diameter: { default: 0.012, min: 0.007, max: 0.02, description: "outer diameter in meters" },
      thickness: { default: 0.0026, min: 0.0012, max: 0.005, description: "band thickness" },
      pave: { options: ["none", "pave"], default: "none", description: "stones across the front face" },
      stone: stoneParam,
    },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["earlobe"],
    family: "jewelry",
  },
  {
    id: "stud",
    name: "Stud",
    description:
      "Stud earring: head facing +Z sitting on the earlobe point, post running back -Z through the lobe with a butterfly back. Heads: polished ball, prong-set gem, pearl, puffy heart, faceted star, flower, bezel-set gem, or an empty prong/bezel setting for a separate gem module on its face.",
    size: [0.005, 0.005, 0.014],
    attach: { face: [0, 0, 0.0026] },
    params: {
      head: { options: ["ball", "gem", "pearl", "heart", "star", "flower", "bezel_gem", "prong_setting", "bezel_setting"], default: "ball", description: "what sits on the post" },
      size: { default: 0.005, min: 0.002, max: 0.016, description: "head (or stone) diameter in meters" },
      stone: stoneParam,
      back: { options: ["butterfly", "none"], default: "butterfly", description: "include the butterfly back" },
    },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["earlobe"],
    family: "jewelry",
  },
  {
    id: "gem",
    name: "Gemstone",
    description:
      "Faceted gemstone, table facing +Z: round brilliant, oval, pear (point +Y), emerald step cut, marquise or heart. Setting prong or bezel rises from the surface; none sinks the pavilion into it (flush). The part material colors the stone (preset gem).",
    size: [0.006, 0.006, 0.0045],
    attach: { table: [0, 0, 0.0043] },
    params: {
      cut: { options: ["round", "oval", "pear", "emerald", "marquise", "heart"], default: "round", description: "stone shape" },
      setting: { options: ["prong", "bezel", "none"], default: "prong", description: "how it is held" },
      size: { default: 0.006, min: 0.001, max: 0.03, description: "stone length (round: diameter) in meters" },
      metal: metalParam,
    },
    material: "gem",
    slot: "stone",
    categories: ["jewelry", "accessory", "bag"],
    zones: ["face", "drop_point", "front_center"],
    family: "jewelry",
  },
  {
    id: "pearl",
    name: "Pearl",
    description:
      "Pearl bead with a metal cap. mount cup sits it on the surface (+Z, peg into the surface); hang puts a bell cap and loop at the origin with the pearl hanging -Y (for drop points). The part material colors the pearl.",
    size: [0.008, 0.008, 0.0088],
    attach: {},
    params: {
      size: { default: 0.008, min: 0.002, max: 0.02, description: "pearl diameter in meters" },
      shape: { options: ["round", "baroque", "teardrop"], default: "round", description: "pearl shape" },
      mount: { options: ["cup", "hang"], default: "cup", description: "sit on a surface or hang from a point" },
      metal: metalParam,
    },
    material: "pearl",
    slot: "accent",
    categories: ["jewelry", "accessory", "top", "dress", "bag"],
    zones: ["face", "drop_point", "front_center"],
    family: "jewelry",
  },
  {
    id: "pave",
    name: "Pave stones",
    description:
      "Row of tiny set stones along a path (the front arc of a hoop, a bezel edge), tables facing the path normal, with metal beads between them. The part material colors the stones.",
    size: [0.03, 0.0014, 0.0012],
    attach: {},
    path: true,
    params: {
      stone: { default: 0.0012, min: 0.0006, max: 0.004, description: "stone diameter in meters" },
      metal: metalParam,
    },
    material: "gem",
    slot: "stone",
    categories: JEWELRY_CATS,
    zones: ["hoop_front"],
    family: "jewelry",
  },
  {
    id: "chain",
    name: "Chain",
    description:
      "Metal chain following the path: interlocking links evenly spaced, alternating orientation (cable, curb, rope, paperclip, box, figaro, bead/ball chain). Works on hanging (necklace), closed and surface paths.",
    size: [0.3, 0.004, 0.003],
    attach: {},
    path: true,
    params: {
      link: { options: ["cable", "curb", "rope", "paperclip", "box", "figaro", "bead"], default: "cable", description: "link style" },
      size: { default: 0.0035, min: 0.0012, max: 0.03, description: "link length in meters (bead: spacing)" },
      wire: { default: 0, min: 0, max: 0.004, description: "wire diameter in meters (0 = in proportion to the link)" },
    },
    material: "metal_polished",
    categories: ["jewelry", "accessory", "bag", "top", "bottom", "outerwear"],
    zones: ["hoop_front", "handle_left", "handle_right", "flap_edge", "waist"],
    family: "jewelry",
  },
  {
    id: "ear_wire",
    name: "French ear wire",
    description:
      "French hook ear wire in the YZ plane: the curve's top passes through the lobe at the origin, front leg down +Z side with a ball and coil, open loop at the bottom (drops hang there), tail behind (-Z).",
    size: [0.0033, 0.0165, 0.0105],
    attach: { loop: [0, -0.0154, 0.0031] },
    params: { wire: { default: 0.0007, min: 0.0005, max: 0.0012, description: "wire diameter" } },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["earlobe"],
    family: "jewelry",
  },
  {
    id: "drop",
    name: "Drop",
    description:
      "Short dangle hanging -Y from the origin (a hoop or wire passes through its jump ring along X): jump ring, a few chain links and a charm (pearl, gem, disc, heart, star, moon, teardrop, chain tassel).",
    size: [0.008, 0.022, 0.008],
    attach: { top: [0, 0, 0] },
    params: {
      length: { default: 0.022, min: 0.008, max: 0.08, description: "total drop length in meters" },
      charm: { options: ["pearl", "gem", "disc", "heart", "star", "moon", "teardrop", "tassel"], default: "pearl", description: "what hangs at the end" },
      charm_size: { default: 0.008, min: 0.003, max: 0.03, description: "charm size in meters" },
      loop: { default: 0.0032, min: 0.0012, max: 0.012, description: "inner diameter of the top jump ring (bigger than the wire it hangs on)" },
      stone: stoneParam,
    },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["drop_point"],
    family: "jewelry",
  },
  {
    id: "charm",
    name: "Charm",
    description:
      "Pendant charm with a jump ring bail at the origin, hanging -Y, face +Z: heart, star, crescent moon, disc, initial letter, scallop shell or flower, in polished metal.",
    size: [0.012, 0.016, 0.0025],
    attach: { bail: [0, 0, 0] },
    params: {
      shape: { options: ["heart", "star", "moon", "disc", "initial", "shell", "flower"], default: "heart", description: "charm shape" },
      size: { default: 0.012, min: 0.004, max: 0.04, description: "charm width in meters" },
      letter: { options: LETTERS, default: "a", description: "letter for the initial charm" },
    },
    material: "metal_polished",
    categories: ["jewelry", "accessory", "bag"],
    zones: ["drop_point", "hoop_front", "strap_anchor_left", "strap_anchor_right"],
    family: "jewelry",
  },
  {
    id: "clasp",
    name: "Clasp",
    description: "Necklace / bracelet clasp hanging -Y from its attachment ring at the origin, face +Z: lobster claw, spring ring, or toggle (ring and bar).",
    size: [0.006, 0.013, 0.0025],
    attach: { ring: [0, 0, 0] },
    params: {
      style: { options: ["lobster", "spring_ring", "toggle"], default: "lobster", description: "clasp type" },
      size: { default: 0.012, min: 0.006, max: 0.03, description: "clasp length in meters" },
    },
    material: "metal_polished",
    categories: ["jewelry", "accessory", "bag"],
    zones: ["drop_point"],
    family: "jewelry",
  },
  {
    id: "ear_back",
    name: "Butterfly back",
    description: "Butterfly push back for a stud post, mounted at the earlobe point like the stud: the clutch sits `depth` behind it (-Z) on the post axis, scrolls toward the lobe.",
    size: [0.006, 0.005, 0.0022],
    attach: {},
    params: { depth: { default: 0.0062, min: 0.003, max: 0.012, description: "distance behind the earlobe point (lobe thickness)" } },
    material: "metal_polished",
    categories: JEWELRY_CATS,
    zones: ["earlobe"],
    family: "jewelry",
  },
];
