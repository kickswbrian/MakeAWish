import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: wireless over-ear headphones.
 * Origin sits between the ear cups. The headband (root) is an extruded arch in the XY plane.
 * Each ear cup is a lathe whose axis (+Y in the cup's frame) points away from the head
 * (right cup rotated [0,0,-90] so its +Y is world +X; left cup [0,0,90]) and is stretched into an
 * oval by its X scale. Cup children live in that frame: y < 0 faces the head, y = 0.032 is the
 * outer face, the rim is at radius 0.0425.
 */

type V3 = [number, number, number];

const BODY: PartMaterial = { preset: "plastic_matte", color: "#1F2A3D" };
const CUSHION: PartMaterial = { preset: "leather", color: "#C49A6C" };
const METAL: PartMaterial = { preset: "metal_brushed", color: "#C9CCD2" };
const CAP: PartMaterial = { preset: "metal_brushed", color: "#D3BC94" };
const DARK: PartMaterial = { preset: "plastic_matte", color: "#15181E" };
const CLOTH: PartMaterial = { preset: "knit", color: "#22252B" };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

const r4 = (v: number) => +v.toFixed(4);

/** Closed outline of an elliptical arch band (centerline radii rx, ry around (0, cy)), angles in degrees. */
function arch(rx: number, ry: number, cy: number, thick: number, a0: number, a1: number, n = 30): [number, number][] {
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    outer.push([r4(Math.cos(a) * (rx + thick / 2)), r4(cy + Math.sin(a) * (ry + thick / 2))]);
    inner.push([r4(Math.cos(a) * (rx - thick / 2)), r4(cy + Math.sin(a) * (ry - thick / 2))]);
  }
  return [...outer, ...inner.reverse()];
}

// Layout.
const CX = 0.0816; // cup inner face (cushion side) distance from center
const PIVOT_X = 0.0956; // yoke / slider plane
const BAND_RX = PIVOT_X;
const BAND_RY = 0.085;
const BAND_CY = 0.115;
const BAND_T = 0.009;
const OVAL: V3 = [1.15, 1, 1];

function side(s: "l" | "r"): Part[] {
  const sx = s === "r" ? 1 : -1;
  const L = s === "r" ? "Right" : "Left";
  const cup = `cup_${s}`;
  const out: Part[] = [
    prim(cup, `${L} ear cup`, "headband", {
      type: "lathe",
      params: { points: [[0, 0], [0.039, 0], [0.0415, 0.003], [0.0425, 0.012], [0.0416, 0.022], [0.037, 0.0292], [0.03, 0.0318], [0, 0.0322]], angle: 360, segments: 96, sharp: false },
    }, BODY, [sx * CX, 0, 0], [0, 0, -sx * 90], OVAL),
    prim(`cushion_${s}`, `${L} ear cushion`, cup, { type: "torus", params: { radius: 0.0288, tube: 0.0128, arc: 360 } }, CUSHION, [0, -0.0072, 0], [90, 0, 0], [1, 1, 0.68]),
    prim(`cushion_ring_${s}`, `${L} cushion ring`, cup, { type: "cylinder", params: { radiusTop: 0.0405, radiusBottom: 0.0405, height: 0.003, bevel: 0.001, open: false } }, DARK, [0, 0.0005, 0]),
    prim(`driver_cloth_${s}`, `${L} driver cloth`, cup, { type: "cylinder", params: { radiusTop: 0.022, radiusBottom: 0.022, height: 0.002, bevel: 0.0005, open: false } }, CLOTH, [0, -0.0045, 0]),
    prim(`cap_${s}`, `${L} outer cap`, cup, { type: "cylinder", params: { radiusTop: 0.0285, radiusBottom: 0.0305, height: 0.004, bevel: 0.0014, open: false } }, CAP, [0, 0.032, 0]),
    kit(`grille_${s}`, `${L} grille`, `cap_${s}`, "speaker_grille", { preset: "metal_brushed", color: "#9EA3AA" }, [0, 0.0019, 0], [-90, 0, 0], [1, 1, 1], { radius: 0.0215 }),
    // Yoke: a half ring around the top of the cup, pinned to the cup at the front and back.
    prim(`yoke_${s}`, `${L} yoke`, "headband", { type: "torus", params: { radius: 0.0498, tube: 0.0034, arc: 180 } }, BODY, [sx * PIVOT_X, 0, 0], [0, 90, 0], [1, 1.1, 2.1]),
    prim(`pivot_front_${s}`, `${L} front pivot`, "headband", { type: "cylinder", params: { radiusTop: 0.0055, radiusBottom: 0.0055, height: 0.0105, bevel: 0.0012, open: false } }, METAL, [sx * PIVOT_X, 0, 0.0455], [90, 0, 0]),
    prim(`pivot_back_${s}`, `${L} back pivot`, "headband", { type: "cylinder", params: { radiusTop: 0.0055, radiusBottom: 0.0055, height: 0.0105, bevel: 0.0012, open: false } }, METAL, [sx * PIVOT_X, 0, -0.0455], [90, 0, 0]),
    prim(`yoke_hub_${s}`, `${L} yoke hub`, "headband", { type: "roundedBox", params: { width: 0.012, height: 0.012, depth: 0.016, radius: 0.004 } }, BODY, [sx * PIVOT_X, 0.0585, 0]),
    // Polished slider rising from the yoke into the headband's hinge block.
    prim(`slider_${s}`, `${L} slider`, "headband", { type: "roundedBox", params: { width: 0.0045, height: 0.04, depth: 0.011, radius: 0.0018 } }, METAL, [sx * PIVOT_X, 0.08, 0]),
    prim(`hinge_${s}`, `${L} hinge block`, "headband", { type: "roundedBox", params: { width: 0.0135, height: 0.03, depth: 0.03, radius: 0.0055 } }, BODY, [sx * PIVOT_X, 0.106, 0]),
  ];
  return out;
}

/** Controls on the right cup's back rim, placed by angle around the cup axis (0 = straight back). */
function rimMount(deg: number, y: number): { position: V3; rotation: V3 } {
  const a = (deg * Math.PI) / 180;
  const r = 0.0428;
  // In the right cup frame +X points down in the world, so positive angles move the control down.
  return { position: [r4(Math.sin(a) * r), y, r4(-Math.cos(a) * r)], rotation: [0, r4(180 - deg), 0] };
}

const power = rimMount(-28, 0.0125);
const anc = rimMount(-8, 0.0125);
const led = rimMount(14, 0.0125);

const parts: Part[] = [
  prim("headband", "Headband", null, {
    type: "extrude",
    params: { shape: arch(BAND_RX, BAND_RY, BAND_CY, BAND_T, -6, 186, 32), depth: 0.032, bevel: 0.0032, smooth: false },
  }, BODY),
  prim("band_cushion", "Headband cushion", "headband", {
    type: "extrude",
    params: { shape: arch(BAND_RX - BAND_T / 2 - 0.0055, BAND_RY - BAND_T / 2 - 0.0055, BAND_CY, 0.0125, 28, 152, 24), depth: 0.027, bevel: 0.0055, smooth: false },
  }, CUSHION),
  prim("band_logo", "Headband logo", "headband", { type: "roundedBox", params: { width: 0.032, height: 0.0024, depth: 0.012, radius: 0.001 } }, CAP, [0, r4(BAND_CY + BAND_RY + BAND_T / 2 + 0.0006), 0]),
  ...side("l"),
  ...side("r"),
  prim("power_button", "Power button", "cup_r", { type: "roundedBox", params: { width: 0.011, height: 0.0055, depth: 0.004, radius: 0.0019 } }, DARK, power.position, power.rotation),
  prim("anc_button", "Noise cancelling button", "cup_r", { type: "roundedBox", params: { width: 0.0075, height: 0.0055, depth: 0.0036, radius: 0.0017 } }, DARK, anc.position, anc.rotation),
  kit("status_led", "Status light", "cup_r", "led", { preset: "plastic_gloss", color: "#7FF0DD", emissive: "#7FF0DD" }, led.position, led.rotation),
  kit("usb_port", "USB-C port", "cup_r", "usb_port", { preset: "metal_polished", color: "#C9CCD2" }, [0.0428, 0.0125, 0], [0, 90, 0]),
];

export const headphones: Template | null = {
  id: "headphones",
  name: "Wireless Over-Ear Headphones",
  keywords: ["headphones", "headphone", "headset", "earphones", "cans", "over ear headphones", "noise cancelling headphones"],
  category: "headphones",
  description: "Wireless over-ear headphones with leather cushions, brushed metal sliders, open grille caps and on-cup controls",
  targetPriceUsd: 249,
  parts,
};
