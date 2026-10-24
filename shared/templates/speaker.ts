import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: portable Bluetooth speaker, a soft fabric-wrapped pill with rubber end caps.
 * Body is a rounded box (0.2 x 0.09 x 0.06, front face at z = 0.03, top at y = 0.045) with two
 * driver grilles on the front, a rubber control strip on top, feet underneath and a cord loop
 * on the right end.
 */

type V3 = [number, number, number];

const FABRIC: PartMaterial = { preset: "knit", color: "#C8553D" };
const RUBBER: PartMaterial = { preset: "rubber", color: "#2A2B2F" };
const GRILLE: PartMaterial = { preset: "metal_brushed", color: "#45484E" };
const METAL: PartMaterial = { preset: "metal_brushed", color: "#C9CCD2" };
const CORD: PartMaterial = { preset: "nylon", color: "#E9DCC6" };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

const W = 0.2, H = 0.09, D = 0.06, R = 0.025;

/** Rounded-rectangle outline (counter-clockwise) centered on the origin. */
function rrect(w: number, h: number, r: number, seg = 6): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push([+(cx + Math.cos(a) * r).toFixed(4), +(cy + Math.sin(a) * r).toFixed(4)]);
    }
  return out;
}

/** A rubber end cap: the body's cross-section extruded along X, 2 mm proud of the fabric. */
const endCap = (s: number, L: string): Part =>
  prim(`end_cap_${s > 0 ? "r" : "l"}`, `${L} end cap`, "body", { type: "extrude", params: { shape: rrect(D + 0.004, H + 0.004, R + 0.002), depth: 0.026, bevel: 0.0055, smooth: false } }, RUBBER, [s * 0.091, 0, 0], [0, 90, 0]);

/** A round button standing on the control strip's top face. */
const button = (id: string, name: string, x: number, r = 0.0045): Part =>
  prim(id, name, "control_strip", { type: "cylinder", params: { radiusTop: r, radiusBottom: r + 0.0004, height: 0.0034, bevel: 0.0012, open: false } }, RUBBER, [x, 0.0035, 0]);

const parts: Part[] = [
  prim("body", "Fabric body", null, { type: "roundedBox", params: { width: W, height: H, depth: D, radius: R } }, FABRIC),
  endCap(-1, "Left"),
  endCap(1, "Right"),

  // Front: two driver grilles with a slim badge between them.
  kit("grille_l", "Left grille", "body", "speaker_grille", GRILLE, [-0.035, 0.002, D / 2 - 0.0002], [0, 0, 0], [1, 1, 1], { radius: 0.027 }),
  kit("grille_r", "Right grille", "body", "speaker_grille", GRILLE, [0.035, 0.002, D / 2 - 0.0002], [0, 0, 0], [1, 1, 1], { radius: 0.027 }),
  prim("logo_badge", "Logo badge", "body", { type: "roundedBox", params: { width: 0.0045, height: 0.03, depth: 0.0024, radius: 0.0011 } }, METAL, [0, 0.002, D / 2 + 0.0006]),

  // Top: rubber control strip with buttons and a status light.
  prim("control_strip", "Control strip", "body", { type: "roundedBox", params: { width: 0.096, height: 0.006, depth: 0.026, radius: 0.0029 } }, RUBBER, [0, H / 2 + 0.0016, 0]),
  button("power_button", "Power button", -0.036),
  button("bluetooth_button", "Bluetooth button", -0.018),
  button("play_button", "Play button", 0.0, 0.0055),
  button("volume_down", "Volume down button", 0.019),
  button("volume_up", "Volume up button", 0.037),
  kit("status_led", "Status light", "control_strip", "led", { preset: "plastic_gloss", color: "#FFFFFF", emissive: "#BFF6FF" }, [-0.036, 0.003, 0.0095], [-90, 0, 0]),

  // Bottom: rubber base strip with feet.
  prim("rubber_base", "Rubber base", "body", { type: "roundedBox", params: { width: 0.13, height: 0.004, depth: 0.016, radius: 0.0018 } }, RUBBER, [0, -H / 2 + 0.0012, 0]),
  kit("foot_l", "Left foot", "rubber_base", "rubber_foot", RUBBER, [-0.05, -0.0018, 0], [90, 0, 0], [0.8, 0.8, 0.8]),
  kit("foot_r", "Right foot", "rubber_base", "rubber_foot", RUBBER, [0.05, -0.0018, 0], [90, 0, 0], [0.8, 0.8, 0.8]),

  // Back: passive radiator and a charging port with a rubber surround.
  kit("back_radiator", "Back passive radiator", "body", "speaker_grille", GRILLE, [-0.03, 0.002, -D / 2 + 0.0002], [0, 180, 0], [1, 1, 1], { radius: 0.024 }),
  prim("port_surround", "Port surround", "body", { type: "roundedBox", params: { width: 0.03, height: 0.014, depth: 0.003, radius: 0.0014 } }, RUBBER, [0.045, -0.014, -D / 2 - 0.0008]),
  kit("usb_port", "USB-C port", "port_surround", "usb_port", METAL, [0, 0, -0.0015], [0, 180, 0]),

  prim("cap_logo", "End cap logo", "end_cap_l", { type: "cylinder", params: { radiusTop: 0.009, radiusBottom: 0.009, height: 0.0016, bevel: 0.0005, open: false } }, METAL, [0, 0, -0.0131], [90, 0, 0]),

  // Right end: anchor and cord carry loop.
  prim("loop_anchor", "Loop anchor", "body", { type: "roundedBox", params: { width: 0.008, height: 0.026, depth: 0.016, radius: 0.0035 } }, METAL, [0.1055, 0.012, 0]),
  prim("carry_loop", "Carry loop", "body", {
    type: "tube",
    params: { points: [[0.106, 0.022, 0], [0.116, 0.029, 0], [0.13, 0.025, 0], [0.137, 0.012, 0], [0.131, -0.002, 0], [0.117, -0.004, 0], [0.106, 0.004, 0]], radius: 0.0034, closed: false, sharp: false },
  }, CORD),
];

export const speaker: Template | null = {
  id: "speaker",
  name: "Portable Bluetooth Speaker",
  keywords: ["bluetooth speaker", "portable speaker", "speaker", "boombox", "soundbar", "wireless speaker"],
  category: "speaker",
  description: "Portable fabric-wrapped Bluetooth speaker with twin driver grilles, rubber end caps, top controls and a cord carry loop",
  targetPriceUsd: 99,
  parts,
};
