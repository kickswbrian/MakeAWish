import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a modern 1.7 L electric kettle on its power base, side profile to the viewer.
 * The root is the enamel body (lathe around Y, origin on the axis at the base station's underside,
 * body bottom at y = 0.02, shoulder at y ~ 0.2). Spout points up-left (-X), the walnut handle is
 * on +X, a glass water window sits on the front quarter toward the handle, and the base station
 * has a glow ring, a temperature dial and a ready light on its front.
 */

type V3 = [number, number, number];

const ENAMEL: PartMaterial = { preset: "plastic_gloss", color: "#EEE7DA", roughness: 0.3 };
const STEEL: PartMaterial = { preset: "metal_brushed", color: "#CDD0D5" };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#D8DBE0" };
const WALNUT: PartMaterial = { preset: "wood", color: "#6E4A2F" };
const LEATHER: PartMaterial = { preset: "leather", color: "#5C3B26", roughness: 0.55 };
const BASE: PartMaterial = { preset: "plastic_matte", color: "#2A2B2F" };
const DARK: PartMaterial = { preset: "plastic_gloss", color: "#17181B" };
const GLOW = "#FFB45E";

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const deg = (d: number) => (d * Math.PI) / 180;
/** Point on the body surface at angle a (degrees from +Z toward +X), height y and radius r. */
const around = (a: number, y: number, r: number): V3 => [r4(Math.sin(deg(a)) * r), y, r4(Math.cos(deg(a)) * r)];

const R = 0.08; // body radius along the straight wall
const WIN_A = 26; // water window angle from the front toward the handle

const parts: Part[] = [
  prim("kettle_body", "Kettle body", null, {
    type: "lathe",
    params: {
      // Bottom, soft heel, straight wall, rounded shoulder, rolled lip into the lid opening.
      points: [[0, 0.02], [0.073, 0.02], [0.0778, 0.0228], [0.0796, 0.029], [R, 0.04], [0.0798, 0.12], [0.0788, 0.172], [0.0762, 0.19], [0.0712, 0.2018], [0.0652, 0.2075], [0.0618, 0.2088], [0.0598, 0.2075], [0.059, 0.204], [0, 0.204]],
      angle: 360, segments: 128, sharp: false,
    },
  }, ENAMEL),
  prim("base_trim", "Steel trim band", "kettle_body", { type: "lathe", params: { points: [[0.0786, 0.0236], [0.0807, 0.0252], [0.0812, 0.0285], [0.0806, 0.0312], [0.0795, 0.0322]], angle: 360, segments: 128, sharp: false } }, STEEL),
  prim("brand_badge", "Brand badge", "kettle_body", { type: "roundedBox", params: { width: 0.026, height: 0.0065, depth: 0.0016, radius: 0.0007 } }, CHROME, around(-14, 0.06, R + 0.0003), [0, -14, 0]),

  // Lid: domed enamel lid inside a chrome collar, walnut knob on a steel stem.
  prim("lid", "Lid", "kettle_body", { type: "lathe", params: { points: [[0.0605, 0.2052], [0.0612, 0.2092], [0.0592, 0.2125], [0.048, 0.2192], [0.028, 0.2234], [0, 0.2246]], angle: 360, segments: 128, sharp: false } }, ENAMEL),
  prim("lid_collar", "Lid collar", "kettle_body", { type: "torus", params: { radius: 0.0622, tube: 0.0019, arc: 360 } }, CHROME, [0, 0.2083, 0], [90, 0, 0]),
  prim("knob_stem", "Knob stem", "lid", { type: "cylinder", params: { radiusTop: 0.0068, radiusBottom: 0.0085, height: 0.006, bevel: 0.0012, open: false } }, STEEL, [0, 0.2266, 0]),
  prim("lid_knob", "Lid knob", "lid", { type: "lathe", params: { points: [[0, 0.2286], [0.0105, 0.2286], [0.0128, 0.231], [0.0136, 0.2345], [0.0122, 0.2378], [0.007, 0.2398], [0, 0.2402]], angle: 360, segments: 96, sharp: false } }, WALNUT),
  prim("lid_hinge", "Lid hinge", "kettle_body", { type: "roundedBox", params: { width: 0.012, height: 0.0065, depth: 0.022, radius: 0.0025 } }, STEEL, [0.0605, 0.2105, 0]),

  // Spout: a tapered enamel beak rising toward -X with a chrome rim and a mesh filter inside.
  prim("spout", "Spout", "kettle_body", {
    type: "lathe",
    params: { points: [[0.0215, -0.012], [0.02, 0.012], [0.0165, 0.034], [0.0128, 0.052], [0.0112, 0.0605], [0.0106, 0.0612], [0.0098, 0.06], [0.0112, 0.05], [0.015, 0.032], [0.0182, 0.01], [0.0195, -0.012]], angle: 360, segments: 96, sharp: false },
  }, ENAMEL, [-0.0655, 0.162, 0], [0, 0, 52], [1, 1, 0.82]),
  prim("spout_rim", "Spout rim", "spout", { type: "torus", params: { radius: 0.0105, tube: 0.0011, arc: 360 } }, CHROME, [0, 0.0606, 0], [90, 0, 0]),
  prim("spout_filter", "Spout filter", "spout", { type: "cylinder", params: { radiusTop: 0.0117, radiusBottom: 0.0117, height: 0.0008, bevel: 0.0002, open: false } }, STEEL, [0, 0.048, 0]),

  // Handle on +X: leather-wrapped grip between enamel mounts, lid release on top, power switch below.
  prim("handle", "Handle", "kettle_body", {
    type: "tube",
    params: { points: [[0.069, 0.197, 0], [0.088, 0.2045, 0], [0.108, 0.2, 0], [0.1205, 0.181, 0], [0.1245, 0.142, 0], [0.1215, 0.103, 0], [0.11, 0.074, 0], [0.093, 0.062, 0], [0.077, 0.06, 0]], radius: 0.0098, closed: false, sharp: false },
  }, LEATHER, [0, 0, 0], [0, 0, 0], [1, 1, 1.45]),
  prim("handle_mount_top", "Upper handle mount", "kettle_body", { type: "sphere", params: { radius: 0.0125, angle: 180 } }, ENAMEL, [0.0742, 0.1955, 0], [0, 0, -18], [0.75, 1.05, 1.32]),
  prim("handle_mount_bottom", "Lower handle mount", "kettle_body", { type: "sphere", params: { radius: 0.0125, angle: 180 } }, ENAMEL, [0.0805, 0.0602, 0], [0, 0, 8], [0.62, 1.05, 1.32]),
  prim("lid_button", "Lid release button", "kettle_body", { type: "capsule", params: { radius: 0.0042, length: 0.012 } }, CHROME, [0.0975, 0.2138, 0], [0, 0, 84], [0.8, 1, 1.6]),
  kit("power_switch", "Power switch", "kettle_body", "toggle_switch", DARK, [R + 0.0001, 0.046, 0], [0, 90, 90], [0.85, 0.85, 0.85]),

  // Water window: smoked frame, water level and a glass cover with max / min marks.
  prim("window_frame", "Water window frame", "kettle_body", { type: "roundedBox", params: { width: 0.0205, height: 0.112, depth: 0.004, radius: 0.0019 } }, DARK, around(WIN_A, 0.112, R - 0.0002), [0, WIN_A, 0]),
  prim("water_level", "Water level", "window_frame", { type: "roundedBox", params: { width: 0.0138, height: 0.064, depth: 0.0008, radius: 0.0003 } }, { preset: "plastic_gloss", color: "#5DB6E2", emissive: "#2E9BD6", emissiveIntensity: 0.9 }, [0, -0.0195, 0.0019]),
  prim("water_window", "Water window", "window_frame", { type: "roundedBox", params: { width: 0.0152, height: 0.104, depth: 0.0014, radius: 0.0006 } }, { preset: "glass", color: "#EEF7FA", roughness: 0.02, opacity: 0.6 }, [0, 0, 0.0031]),
  prim("max_mark", "Max mark", "window_frame", { type: "roundedBox", params: { width: 0.0018, height: 0.0007, depth: 0.0004, radius: 0.0002 } }, { preset: "plastic_matte", color: "#F4F4F2" }, [-0.0085, 0.044, 0.0021]),
  prim("min_mark", "Min mark", "window_frame", { type: "roundedBox", params: { width: 0.0018, height: 0.0007, depth: 0.0004, radius: 0.0002 } }, { preset: "plastic_matte", color: "#F4F4F2" }, [-0.0085, -0.044, 0.0021]),

  // Power base: dark station with a glow ring, temperature dial, ready light and cord.
  prim("base_station", "Power base", "kettle_body", { type: "cylinder", params: { radiusTop: 0.0905, radiusBottom: 0.0935, height: 0.0195, bevel: 0.0042, open: false, segments: 128 } }, BASE, [0, 0.00975, 0]),
  prim("glow_ring", "Glow ring", "base_station", { type: "torus", params: { radius: 0.0855, tube: 0.0011, arc: 360 } }, { preset: "plastic_gloss", color: GLOW, emissive: GLOW, emissiveIntensity: 2.2 }, [0, 0.0095, 0], [90, 0, 0]),
  kit("temperature_dial", "Temperature dial", "base_station", "knob", STEEL, around(0, -0.0002, 0.0922), [0, 0, 0], [1, 1, 0.7], { radius: 0.0074 }),
  kit("ready_light", "Ready light", "base_station", "led", { preset: "plastic_gloss", color: GLOW, emissive: GLOW }, around(-12, -0.0002, 0.0923), [0, -12, 0], [0.9, 0.9, 0.9]),
  prim("keep_warm_button", "Keep warm button", "base_station", { type: "cylinder", params: { radiusTop: 0.0032, radiusBottom: 0.0034, height: 0.0024, bevel: 0.0007, open: false } }, STEEL, around(12, -0.0002, 0.0928), [90, 0, -12]),
  prim("cord_relief", "Cord strain relief", "base_station", { type: "cylinder", params: { radiusTop: 0.0034, radiusBottom: 0.0048, height: 0.012, bevel: 0.001, open: false } }, BASE, [0, -0.0035, -0.0955], [-90, 0, 0]),
  prim("power_cord", "Power cord", "base_station", {
    type: "tube",
    params: { points: [[0, -0.0035, -0.098], [0, -0.0048, -0.112], [0.006, -0.0068, -0.128], [0.024, -0.0068, -0.142], [0.05, -0.0068, -0.149]], radius: 0.0027, closed: false, sharp: false },
  }, BASE),
];

export const kettle: Template | null = {
  id: "kettle",
  name: "Electric Kettle",
  keywords: ["electric kettle", "kettle", "tea kettle", "teapot", "tea pot", "water boiler", "hot water kettle"],
  category: "kettle",
  description: "1.7 L enamel electric kettle with a leather-wrapped handle, walnut lid knob, glass water window, chrome trim and a glowing power base with temperature dial",
  targetPriceUsd: 89,
  parts,
};
