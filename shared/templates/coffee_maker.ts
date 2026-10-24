import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: compact stainless espresso machine, facing +Z, ~0.40 m tall.
 * The housing (root) is the back tower (origin at its center, 0.2 m up, 0.07 m behind center);
 * the overhanging head and the plinth are its children and share its finish. Children of the
 * tower are placed in floor coordinates through `P()`; children of the head through `H()`.
 * The brew area is the open recess between head and plinth: group head and portafilter under the
 * head, a cup on the drip tray grille, the steam wand on the right. The pressure gauge and buttons
 * sit on the head's front face, the water tank clips onto the back.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

const box = (width: number, height: number, depth: number, radius?: number): Geometry => ({ type: "roundedBox", params: { width, height, depth, ...(radius !== undefined ? { radius } : {}) } });
const cyl = (radiusTop: number, radiusBottom: number, height: number, bevel?: number): Geometry => ({ type: "cylinder", params: { radiusTop, radiusBottom, height, open: false, ...(bevel !== undefined ? { bevel } : {}) } });

/** Rounded-rectangle outline (counter-clockwise) centered on the origin. */
function rrect(w: number, h: number, r: number, seg = 5): V2[] {
  const out: V2[] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([r4(cx + Math.cos(a) * r), r4(cy + Math.sin(a) * r)]);
    }
  return out;
}

const STEEL: PartMaterial = { preset: "metal_brushed", color: "#A2A7AE", roughness: 0.5 };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#DDE0E4" };
const TRAY: PartMaterial = { preset: "metal_brushed", color: "#9EA3A9" };
const BLACK: PartMaterial = { preset: "plastic_matte", color: "#1B1C1F" };
const WALNUT: PartMaterial = { preset: "wood", color: "#6B4329", roughness: 0.4 };
const DIAL: PartMaterial = { preset: "plastic_matte", color: "#16171A" };
const WHITE: PartMaterial = { preset: "plastic_matte", color: "#F2F2EE" };
const AMBER: PartMaterial = { preset: "plastic_gloss", color: "#E8A33C", emissive: "#E8A33C", emissiveIntensity: 0.4 };
const CERAMIC: PartMaterial = { preset: "ceramic", color: "#F5F3EE" };
const CREMA: PartMaterial = { preset: "plastic_gloss", color: "#9A6232", roughness: 0.35 };
const GLASS: PartMaterial = { preset: "glass", color: "#EAF3F6", opacity: 0.4 };
const WATER: PartMaterial = { preset: "glass", color: "#A8D3E6", opacity: 0.55 };

// ---------- Layout (floor coordinates) ----------

const TOWER: V3 = [0, 0.2, -0.07]; // tower center: 0.30 wide, 0.40 tall, z from -0.15 to 0.01
const P = (x: number, y: number, z: number): V3 => [x - TOWER[0], y - TOWER[1], z - TOWER[2]];
const HEAD_C: V3 = [0, 0.341, 0]; // head: 0.12 tall (y 0.281..0.401), z from -0.145 to 0.145
const H = (x: number, y: number, z: number): V3 => [x - HEAD_C[0], y - HEAD_C[1], z - HEAD_C[2]];
const FACE = 0.145; // head front face z
const GZ = FACE; // gauge mount plane
const GY = 0.346; // gauge center height
const GROUP: V3 = [0, 0.271, 0.072]; // group head center
const TRAY_TOP = 0.0765;

// Grille slots (8 max holes).
const slots: V2[][] = Array.from({ length: 8 }, (_, i) => rrect(0.2, 0.0058, 0.0029, 3).map(([x, y]): V2 => [x, r4(y - 0.0455 + i * 0.013)]));

const button = (id: string, name: string, x: number): Part =>
  prim(id, name, "head", cyl(0.0105, 0.0112, 0.006, 0.0022), CHROME, H(x, GY, FACE + 0.002), [90, 0, 0]);

const parts: Part[] = [
  // Housing: back tower (root), overhanging head and plinth, all one stainless finish.
  prim("housing", "Housing", null, box(0.3, 0.4, 0.16, 0.018), STEEL, TOWER),
  prim("head", "Head", "housing", box(0.302, 0.12, 0.29, 0.018), STEEL, P(...HEAD_C)),
  prim("plinth", "Plinth", "housing", box(0.302, 0.035, 0.29, 0.012), STEEL, P(0, 0.0175, 0)),

  // Drip tray with a slotted grille, a float indicator and a badge on its front.
  prim("drip_tray", "Drip tray", "housing", box(0.27, 0.041, 0.136, 0.008), TRAY, P(0, 0.0555, 0.08)),
  prim("grille", "Drip tray grille", "drip_tray", { type: "extrude", params: { shape: rrect(0.255, 0.122, 0.01), holes: slots, depth: 0.0028, bevel: 0.0008, smooth: false } }, CHROME, [0, TRAY_TOP - 0.0555 - 0.0008, 0], [-90, 0, 0]),
  prim("float", "Empty-me float", "drip_tray", cyl(0.0055, 0.0055, 0.012, 0.002), { preset: "plastic_gloss", color: "#D7263D" }, [0.1185, TRAY_TOP - 0.0555 + 0.001, -0.052]),
  prim("tray_badge", "Tray badge", "drip_tray", box(0.054, 0.009, 0.0016, 0.0008), CHROME, [0, -0.002, 0.068]),

  // Pressure gauge: chrome bezel, black dial with a scale, amber espresso zone, needle and domed glass.
  prim("gauge_bezel", "Pressure gauge bezel", "head", cyl(0.034, 0.035, 0.008, 0.003), CHROME, H(0, GY, GZ + 0.002), [90, 0, 0]),
  prim("gauge_dial", "Gauge dial", "head", cyl(0.0292, 0.0292, 0.002, 0.0003), DIAL, H(0, GY, GZ + 0.0065), [90, 0, 0]),
  prim("gauge_scale", "Gauge scale", "head", { type: "torus", params: { radius: 0.0235, tube: 0.0009, arc: 240 } }, WHITE, H(0, GY, GZ + 0.0076), [0, 0, -30], [1, 1, 0.4]),
  prim("gauge_zone", "Espresso zone", "head", { type: "torus", params: { radius: 0.0235, tube: 0.0017, arc: 46 } }, AMBER, H(0, GY, GZ + 0.0078), [0, 0, 38], [1, 1, 0.4]),
  prim("gauge_needle", "Gauge needle", "head", box(0.0018, 0.022, 0.0008, 0.0006), { preset: "plastic_gloss", color: "#E5512E" }, H(0.5 * 0.007, GY + 0.866 * 0.007, GZ + 0.0082), [0, 0, -30]),
  prim("gauge_hub", "Needle hub", "head", cyl(0.0032, 0.0032, 0.0024, 0.0008), CHROME, H(0, GY, GZ + 0.0085), [90, 0, 0]),
  prim("gauge_glass", "Gauge glass", "head", { type: "sphere", params: { radius: 0.06, angle: 29 } }, { preset: "glass", color: "#F4FAFC", opacity: 0.25 }, H(0, GY, GZ + 0.006 - 0.0525), [90, 0, 0]),

  // Buttons either side of the gauge, a power light, and the brand badge under the gauge.
  button("button_single", "Single shot button", -0.108),
  button("button_double", "Double shot button", -0.068),
  button("button_steam", "Steam button", 0.068),
  button("button_power", "Power button", 0.108),
  kit("power_light", "Power light", "head", "led", { preset: "plastic_gloss", color: "#FFB45E", emissive: "#FFB45E" }, H(0.108, GY - 0.021, FACE)),
  prim("brand_badge", "Brand badge", "head", box(0.05, 0.0075, 0.0016, 0.0007), CHROME, H(0, 0.297, FACE + 0.0004)),

  // Cup warmer on top with a low polished rail.
  prim("cup_warmer", "Cup warmer", "head", box(0.27, 0.004, 0.26, 0.0018), CHROME, H(0, 0.4025, -0.004)),
  prim("warmer_rail", "Cup warmer rail", "cup_warmer", { type: "tube", params: { points: rrect(0.258, 0.248, 0.02, 4).map(([x, z]): V3 => [x, 0.0055, z]), radius: 0.0035, closed: true, sharp: false } }, CHROME),

  // Group head and portafilter (handle angled to the left), with a double spout.
  prim("group_head", "Group head", "head", cyl(0.046, 0.044, 0.022, 0.004), CHROME, H(...GROUP)),
  prim("group_gasket", "Group gasket", "group_head", cyl(0.041, 0.041, 0.006, 0.0015), BLACK, [0, -0.013, 0]),
  prim("portafilter", "Portafilter", "group_head", {
    type: "lathe",
    params: { points: [[0, -0.044], [0.03, -0.044], [0.0365, -0.039], [0.0392, -0.026], [0.0405, -0.02], [0.0438, -0.0185], [0.0438, -0.0165], [0.0412, -0.016], [0, -0.016]], angle: 360, segments: 96, sharp: false },
  }, CHROME, [0, 0, 0], [0, -15, 0]),
  prim("spout_block", "Spout", "portafilter", box(0.028, 0.012, 0.016, 0.005), CHROME, [0, -0.049, 0]),
  prim("spout_nozzles", "Spout nozzles", "spout_block", { type: "tube", params: { points: [[-0.016, -0.021, 0], [-0.011, -0.008, 0], [-0.004, 0.0, 0], [0.004, 0.0, 0], [0.011, -0.008, 0], [0.016, -0.021, 0]], radius: 0.0034, closed: false, sharp: false } }, CHROME),
  prim("handle_neck", "Handle neck", "portafilter", cyl(0.0085, 0.0095, 0.038, 0.002), CHROME, [0, -0.026, 0.055], [96, 0, 0]),
  prim("handle", "Portafilter handle", "portafilter", { type: "capsule", params: { radius: 0.0135, length: 0.085 } }, WALNUT, [0, -0.033, 0.122], [96, 0, 0], [1, 1, 0.85]),

  // Steam wand on a ball joint under the head's right side, with a cool-touch grip, and its dial.
  prim("wand_joint", "Steam wand joint", "head", { type: "sphere", params: { radius: 0.011, angle: 180 } }, CHROME, H(0.122, 0.279, 0.102)),
  prim("steam_wand", "Steam wand", "wand_joint", { type: "tube", params: { points: [[0, 0, 0], [0.003, -0.05, 0.006], [0.008, -0.11, 0.014], [0.011, -0.15, 0.018]], radius: 0.0052, closed: false, sharp: false } }, CHROME),
  prim("wand_grip", "Wand grip", "wand_joint", { type: "capsule", params: { radius: 0.0078, length: 0.038 } }, BLACK, [0.0014, -0.032, 0.0035], [-6, 0, 3]),
  prim("wand_tip", "Wand tip", "wand_joint", cyl(0.0052, 0.0036, 0.012, 0.001), CHROME, [0.0112, -0.157, 0.0188], [-6, 0, 4]),
  kit("steam_dial", "Steam dial", "head", "knob", WALNUT, H(0.151, 0.338, 0.05), [0, 90, 0], { radius: 0.02 }),

  // Espresso cup on a saucer, with crema.
  prim("saucer", "Saucer", "drip_tray", { type: "lathe", params: { points: [[0, 0], [0.04, 0], [0.052, 0.003], [0.058, 0.0075], [0.0555, 0.0082], [0.046, 0.0045], [0.03, 0.004], [0, 0.004]], angle: 360, segments: 96, sharp: false } }, CERAMIC, [0, TRAY_TOP - 0.0555 + 0.0012, -0.008]),
  prim("cup", "Espresso cup", "saucer", {
    type: "lathe",
    params: { points: [[0, 0.004], [0.019, 0.004], [0.0235, 0.008], [0.028, 0.025], [0.0298, 0.046], [0.03, 0.058], [0.0278, 0.0582], [0.0272, 0.046], [0.0255, 0.026], [0.02, 0.012], [0, 0.011]], angle: 360, segments: 96, sharp: false },
  }, CERAMIC),
  prim("crema", "Crema", "cup", cyl(0.0262, 0.0262, 0.002, 0.0006), CREMA, [0, 0.043, 0]),
  prim("cup_handle", "Cup handle", "cup", { type: "torus", params: { radius: 0.0115, tube: 0.0032, arc: 220 } }, CERAMIC, [0.0315, 0.034, 0], [0, 0, -110], [1, 1, 1]),

  // Clear water tank clipped onto the back, with water and a lid.
  prim("water_tank", "Water tank", "housing", box(0.22, 0.29, 0.07, 0.012), GLASS, P(0, 0.205, -0.187)),
  prim("water", "Water", "water_tank", box(0.204, 0.17, 0.056, 0.008), WATER, [0, -0.052, 0]),
  prim("tank_lid", "Tank lid", "water_tank", box(0.222, 0.012, 0.072, 0.005), TRAY, [0, 0.152, 0]),
];

export const coffeeMaker: Template | null = {
  id: "coffee_maker",
  name: "Stainless Espresso Machine",
  keywords: ["coffee maker", "coffee machine", "espresso machine", "espresso maker", "drip coffee maker", "coffeemaker", "cappuccino machine", "latte machine", "barista machine"],
  category: "coffee maker",
  description: "Compact brushed stainless espresso machine with a pressure gauge, chrome portafilter, steam wand for milk, cup warmer, slotted drip tray and a clear rear water tank",
  targetPriceUsd: 499,
  parts,
};
