import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a modern smartwatch standing on its band, face toward +Z, like a studio product shot.
 * The root is the aluminium case (extruded rounded rectangle, 39 x 45 x 10.5 mm, centered on the
 * origin, glass face at z ~ +0.007). The silicone sport band forms a closed wrist loop behind the
 * case in the YZ plane: the upper band rises from the case top and ends in a pin buckle at the back,
 * the lower band comes round from below, passes through the buckle and tucks into a keeper.
 */

type V3 = [number, number, number];

const ALU: PartMaterial = { preset: "metal_brushed", color: "#C9CCD2", roughness: 0.38 };
const BAND: PartMaterial = { preset: "rubber", color: "#3F5E56", roughness: 0.62 };
const STEEL: PartMaterial = { preset: "metal_polished", color: "#D5D8DD" };
const DARK: PartMaterial = { preset: "plastic_matte", color: "#16171A" };
const SENSOR: PartMaterial = { preset: "plastic_gloss", color: "#1B1D21" };
const DISPLAY: PartMaterial = { preset: "glass", color: "#0B0C10", emissive: "#8BF0D0", emissiveIntensity: 1.2 };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

/** Rounded-rectangle outline (counter-clockwise) centered on the origin. */
function rrect(w: number, h: number, r: number, seg = 8): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([+(cx + Math.cos(a) * r).toFixed(5), +(cy + Math.sin(a) * r).toFixed(5)]);
    }
  return out;
}

const CW = 0.039, CH = 0.045, CD = 0.0105;
const SIDE = CW / 2; // case side at x = +-0.0195
const BACK = -CD / 2; // case back at z = -0.00525

// Band centerline (y, z) in the case frame. Strap is 22 mm wide (X) and 2.6 mm thick.
const BAND_W = 0.022, BAND_T = 0.0013;
const yz = (pts: [number, number][]): V3[] => pts.map(([y, z]) => [0, y, z]);
const UPPER: V3[] = yz([[0.0195, -0.0032], [0.0245, -0.0052], [0.0292, -0.0105], [0.0316, -0.0195], [0.0316, -0.0295], [0.0292, -0.0392], [0.0238, -0.0466], [0.0152, -0.0512], [0.0055, -0.0528], [-0.0045, -0.053]]);
const LOWER: V3[] = yz([[-0.0195, -0.0032], [-0.0245, -0.0052], [-0.0292, -0.0105], [-0.0316, -0.0195], [-0.0316, -0.0295], [-0.0292, -0.0392], [-0.0238, -0.0466], [-0.0165, -0.0518], [-0.0085, -0.0552], [0.0, -0.0558], [0.0095, -0.0557], [0.019, -0.0548]]);
const BAND_FACE: V3 = [0, 0.6, 0.8]; // any YZ direction keeps the strap's width along X

const strapHole = (n: number, y: number): Part =>
  prim(`strap_hole_${n}`, "Strap hole", "lower_band", { type: "cylinder", params: { radiusTop: 0.0011, radiusBottom: 0.0011, height: 0.0012, bevel: 0.0003, open: false } }, DARK, [0, y, -0.0567], [90, 0, 0]);

const parts: Part[] = [
  prim("watch_case", "Watch case", null, { type: "extrude", params: { shape: rrect(CW, CH, 0.0098), depth: CD, bevel: 0.0029, smooth: false } }, ALU),

  // Face: glowing display under a proud glass front, with a thin black bezel ring around it.
  kit("display", "Display", "watch_case", "screen", DISPLAY, [0, 0, 0.0029], [0, 0, 0], [1, 1, 1], { width: 0.0322, height: 0.0382 }),

  // Right side: digital crown with a red accent ring, and the flat side button below it.
  kit("digital_crown", "Digital crown", "watch_case", "knob", ALU, [SIDE - 0.0007, 0.0072, -0.0004], [0, 90, 0], [1, 1, 0.95], { radius: 0.0034 }),
  prim("crown_accent", "Crown accent", "digital_crown", { type: "torus", params: { radius: 0.0021, tube: 0.00035, arc: 360 } }, { preset: "plastic_gloss", color: "#E0473A" }, [0, 0, 0.0038]),
  prim("crown_collar", "Crown collar", "watch_case", { type: "cylinder", params: { radiusTop: 0.0037, radiusBottom: 0.0037, height: 0.0012, bevel: 0.0003, open: false } }, DARK, [SIDE - 0.0002, 0.0072, -0.0004], [0, 0, 90]),
  prim("side_button", "Side button", "watch_case", { type: "roundedBox", params: { width: 0.0024, height: 0.0112, depth: 0.0042, radius: 0.0009 } }, ALU, [SIDE + 0.0002, -0.0088, -0.0004]),

  // Left side: speaker slots and a microphone hole.
  prim("speaker_slot_upper", "Speaker grille", "watch_case", { type: "capsule", params: { radius: 0.00055, length: 0.0068 } }, DARK, [-SIDE + 0.0001, -0.0045, 0.0009], [0, 0, 0], [0.6, 1, 1]),
  prim("speaker_slot_lower", "Speaker grille slot", "watch_case", { type: "capsule", params: { radius: 0.00055, length: 0.0068 } }, DARK, [-SIDE + 0.0001, -0.0045, -0.0013], [0, 0, 0], [0.6, 1, 1]),
  prim("microphone", "Microphone", "watch_case", { type: "cylinder", params: { radiusTop: 0.0005, radiusBottom: 0.0005, height: 0.0006, bevel: 0.0001, open: false } }, DARK, [-SIDE + 0.0001, 0.0068, -0.0002], [0, 0, 90]),

  // Back: domed sensor window with a ring of optical sensors and a centre lens.
  prim("sensor_back", "Sensor back", "watch_case", { type: "lathe", params: { points: [[0.0158, 0], [0.0157, 0.0007], [0.0146, 0.0016], [0.011, 0.0024], [0.006, 0.0028], [0, 0.0029]], angle: 360, segments: 96, sharp: false } }, SENSOR, [0, 0, BACK + 0.0004], [-90, 0, 0]),
  prim("sensor_ring", "Sensor ring", "watch_case", { type: "torus", params: { radius: 0.0085, tube: 0.00035, arc: 360 } }, STEEL, [0, 0, BACK - 0.0022]),
  prim("sensor_lens", "Heart rate sensor", "watch_case", { type: "cylinder", params: { radiusTop: 0.0034, radiusBottom: 0.0034, height: 0.0008, bevel: 0.0003, open: false } }, { preset: "glass", color: "#3A1418", emissive: "#FF3B3B", emissiveIntensity: 0.6 }, [0, 0, BACK - 0.0026], [90, 0, 0]),

  // Sport band loop.
  prim("upper_band", "Upper band", "watch_case", { type: "tube", params: { points: UPPER, radius: BAND_T, width: BAND_W, faceNormal: BAND_FACE, closed: false, sharp: false } }, BAND),
  prim("lower_band", "Lower band", "watch_case", { type: "tube", params: { points: LOWER, radius: BAND_T, width: BAND_W, faceNormal: BAND_FACE, closed: false, sharp: false } }, BAND),
  prim("band_slot_top", "Band connector", "watch_case", { type: "roundedBox", params: { width: 0.0236, height: 0.0016, depth: 0.0046, radius: 0.0006 } }, DARK, [0, CH / 2 - 0.0005, -0.0028]),
  prim("band_slot_bottom", "Band connector", "watch_case", { type: "roundedBox", params: { width: 0.0236, height: 0.0016, depth: 0.0046, radius: 0.0006 } }, DARK, [0, -CH / 2 + 0.0005, -0.0028]),
  kit("buckle", "Buckle", "watch_case", "buckle_belt", STEEL, [0, -0.0062, -0.0542], [0, 180, 90], [0.5, 0.74, 0.62]),
  prim("band_keeper", "Band keeper", "watch_case", {
    type: "tube",
    params: { points: rrect(0.0246, 0.0074, 0.0024, 3).map(([x, z]) => [x, 0.0062, +(z - 0.0543).toFixed(5)] as V3), radius: 0.0006, width: 0.0042, faceNormal: [0.3, 0, 1], closed: true, sharp: false },
  }, BAND),
  strapHole(1, 0.0128),
  strapHole(2, 0.0168),
];

export const smartwatch: Template | null = {
  id: "smartwatch",
  name: "Smartwatch",
  keywords: ["smartwatch", "smart watch", "watch", "fitness tracker", "wristwatch", "fitness watch", "activity tracker", "fitness band"],
  category: "smartwatch",
  description: "Aluminium smartwatch with an always-on glowing display, digital crown, side button, heart-rate sensor back and a soft silicone sport band with a steel pin buckle",
  targetPriceUsd: 299,
  parts,
};
