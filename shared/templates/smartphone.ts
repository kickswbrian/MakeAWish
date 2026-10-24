import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: modern flagship smartphone standing upright, screen facing +Z.
 * The body (root) is a rounded-rectangle outline extruded front to back: 0.0715 wide, 0.147 tall,
 * 0.0078 deep (front face at z = +0.0039, back at z = -0.0039, right side at x = +0.03575, bottom
 * at y = -0.0735). The display sits in the front face; the camera plateau is at the back top
 * corner on the +X side (top left when the phone is turned over). Buttons, camera plateau and
 * antenna bands share the body's finish so the whole phone recolors together.
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

/** Rounded-rectangle outline (counter-clockwise) centered on the origin. */
function rrect(w: number, h: number, r: number, seg = 8): V2[] {
  const out: V2[] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([r4(cx + Math.cos(a) * r), r4(cy + Math.sin(a) * r)]);
    }
  return out;
}

const BODY: PartMaterial = { preset: "plastic_matte", color: "#56657A", roughness: 0.42, metalness: 0.45 };
const BAND: PartMaterial = { preset: "plastic_matte", color: "#8E98A5" };
const SCREEN: PartMaterial = { preset: "glass", color: "#0B0C0E", emissive: "#8FD3FF", emissiveIntensity: 1.2 };
const BLACK: PartMaterial = { preset: "plastic_gloss", color: "#0A0B0D" };
const HOLE: PartMaterial = { preset: "plastic_matte", color: "#0E0F11" };
const LENS: PartMaterial = { preset: "glass", color: "#14171C" };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#D5D9DF" };

const W = 0.0715, H = 0.147, DP = 0.0078;
const ZF = DP / 2, ZB = -DP / 2;

// Camera plateau on the back, top corner on the +X side.
const BUMP = 0.037;
const BX = W / 2 - 0.0055 - BUMP / 2, BY = H / 2 - 0.0055 - BUMP / 2;
const BUMP_D = 0.0018;
const BUMP_BACK = -BUMP_D / 2; // the plateau's back face, in its own frame

const lens = (id: string, name: string, x: number, y: number): Part =>
  kit(id, name, "camera_bump", "camera_lens", LENS, [x, y, BUMP_BACK], [0, 180, 0], { radius: 0.0064 });

const sideButton = (id: string, name: string, sx: 1 | -1, y: number, len: number): Part =>
  prim(id, name, "body", { type: "roundedBox", params: { width: 0.0016, height: len, depth: 0.0026, radius: 0.0007 } }, BODY, [sx * (W / 2 + 0.0003), y, 0]);

const band = (id: string, sx: 1 | -1, y: number): Part =>
  prim(id, "Antenna band", "body", { type: "roundedBox", params: { width: 0.0006, height: 0.0013, depth: 0.0032, radius: 0.0002 } }, BAND, [sx * (W / 2 - 0.0001), y, 0]);

const holes = (side: "speaker" | "mic", sx: 1 | -1): Part[] =>
  Array.from({ length: 5 }, (_, i) =>
    prim(`${side}_hole_${i + 1}`, side === "speaker" ? "Speaker hole" : "Microphone hole", "body", { type: "cylinder", params: { radiusTop: 0.00068, radiusBottom: 0.00068, height: 0.0004, bevel: 0.0001, open: false } }, HOLE, [sx * (0.0098 + i * 0.0028), -H / 2 + 0.0001, 0]),
  );

const parts: Part[] = [
  prim("body", "Body", null, { type: "extrude", params: { shape: rrect(W, H, 0.0112), depth: DP, bevel: 0.0022, smooth: false } }, BODY, [0, 0, 0], [0, 0, 0]),

  // Front: edge-to-edge display set into the frame, with the camera pill.
  kit("screen", "Screen", "body", "screen", SCREEN, [0, 0, ZF - 0.0032], [0, 0, 0], { width: 0.0685, height: 0.1442 }),
  prim("front_camera", "Front camera pill", "body", { type: "roundedBox", params: { width: 0.0118, height: 0.0035, depth: 0.0004, radius: 0.00017 } }, BLACK, [0, H / 2 - 0.0108, ZF + 0.0009]),

  // Back: camera plateau with three lenses, flash and depth sensor; a polished logo disc.
  prim("camera_bump", "Camera bump", "body", { type: "extrude", params: { shape: rrect(BUMP, BUMP, 0.0095), depth: BUMP_D, bevel: 0.0007, smooth: false } }, BODY, [BX, BY, ZB - BUMP_D / 2 + 0.0003]),
  lens("lens_main", "Main camera lens", 0.0086, 0.0086),
  lens("lens_ultrawide", "Ultra-wide lens", 0.0086, -0.0086),
  lens("lens_tele", "Telephoto lens", -0.0086, 0),
  kit("flash", "Flash", "camera_bump", "led", { preset: "plastic_gloss", color: "#FFF1D2", emissive: "#FFF1D2", emissiveIntensity: 0.6 }, [-0.0088, 0.0112, BUMP_BACK], [0, 180, 0]),
  prim("depth_sensor", "Depth sensor", "camera_bump", { type: "cylinder", params: { radiusTop: 0.0024, radiusBottom: 0.0024, height: 0.0005, bevel: 0.00015, open: false } }, BLACK, [-0.0088, -0.0112, BUMP_BACK - 0.0001], [90, 0, 0]),
  prim("logo", "Logo", "body", { type: "cylinder", params: { radiusTop: 0.0058, radiusBottom: 0.0058, height: 0.0003, bevel: 0.0001, open: false } }, CHROME, [0, -0.004, ZB - 0.00005], [90, 0, 0]),

  // Sides: power button on the right; action and volume buttons on the left; antenna bands.
  sideButton("power_button", "Power button", 1, 0.026, 0.018),
  sideButton("action_button", "Action button", -1, 0.044, 0.007),
  sideButton("volume_up", "Volume up button", -1, 0.028, 0.011),
  sideButton("volume_down", "Volume down button", -1, 0.0125, 0.011),
  band("band_right_top", 1, 0.058),
  band("band_left_top", -1, 0.058),
  band("band_right_bottom", 1, -0.058),
  band("band_left_bottom", -1, -0.058),

  // Bottom: USB-C port between the speaker and microphone grilles.
  kit("usb_port", "USB-C port", "body", "usb_port", CHROME, [0, -H / 2, 0], [90, 0, 0]),
  ...holes("speaker", 1),
  ...holes("mic", -1),
];

export const smartphone: Template | null = {
  id: "smartphone",
  name: "Flagship Smartphone",
  keywords: ["smartphone", "phone", "iphone", "cell phone", "cellphone", "mobile phone", "android phone"],
  category: "smartphone",
  description: "6.1-inch flagship smartphone with an edge-to-edge glowing display, brushed titanium frame, triple-lens camera plateau and USB-C",
  targetPriceUsd: 999,
  parts,
};
