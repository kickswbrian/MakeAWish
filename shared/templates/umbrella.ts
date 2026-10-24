import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: a classic open stick umbrella held upright, J-hook handle at the bottom.
 * The root is the fabric canopy: a thin fluted lathe shell (1 m across, 8 panels, rim at y ~ 0.715,
 * apex at y = 0.93) whose 8 ripple peaks sit over the ribs. Ribs follow the underside out to their
 * tips; stretchers run from the runner on the shaft up to each rib. Everything is positioned in the
 * canopy's frame, which equals world space (origin on the shaft axis at the bottom of the hook).
 */

type V3 = [number, number, number];

const FABRIC: PartMaterial = { preset: "nylon", color: "#22345E", roughness: 0.7 };
const RIB: PartMaterial = { preset: "metal_brushed", color: "#33363B" };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#D6D9DE" };
const TIP: PartMaterial = { preset: "plastic_gloss", color: "#1C1D20" };
const WOOD: PartMaterial = { preset: "wood", color: "#8A5A36", roughness: 0.42 };

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

const RIM = 0.5, APEX = 0.93, DROP = 0.26, SHELL = 0.003;
const PANELS = 8;
/** Canopy outer surface height at radius r: flat near the top, steepening toward the rim. */
const yOuter = (r: number) => APEX - DROP * (r / RIM) ** 1.8;
const yInner = (r: number) => yOuter(r) - SHELL;
const RADII = [0, 0.06, 0.13, 0.2, 0.27, 0.34, 0.4, 0.45, 0.485];

// Underside from the apex out to the rim, round the hem, back over the top (normals face out).
const CANOPY: [number, number][] = [
  ...RADII.map((r) => [r, r4(yInner(r))] as [number, number]),
  [RIM, r4(yOuter(RIM) - 0.0035)], [RIM + 0.0012, r4(yOuter(RIM) - 0.0005)],
  ...RADII.slice().reverse().map((r) => [r, r4(yOuter(r))] as [number, number]),
];

// Ribs run under the creases between panels, at k * 45 degrees from +Z toward +X.
const ribAngle = (k: number) => (k * 2 * Math.PI) / PANELS;
const onRib = (k: number, r: number, below: number): V3 => {
  const a = ribAngle(k);
  return [r4(Math.sin(a) * r), r4(yInner(r) - below), r4(Math.cos(a) * r)];
};

/**
 * Eight segments make eight taut, flat panels between the ribs (an octagonal hem); a tiny ripple
 * makes the renderer shade from the real facets, so the panels meet at creases over the ribs.
 */
const CANOPY_GEO: Geometry = { type: "lathe", params: { points: CANOPY, angle: 360, segments: PANELS, sharp: false, flutes: 1, fluteDepth: 0.001, fluteFade: "even" } };

const RUNNER_Y = 0.655, STRETCH_R = 0.215;

const ribParts = (k: number): Part[] => {
  const a = ribAngle(k);
  const tip = onRib(k, RIM - 0.004, 0.0035);
  return [
    prim(`rib_${k + 1}`, "Rib", "canopy", { type: "tube", params: { points: [0.018, 0.08, 0.16, 0.24, 0.32, 0.4, 0.46, RIM - 0.006].map((r) => onRib(k, r, 0.0038)), radius: 0.0021, closed: false, sharp: false } }, RIB),
    prim(`rib_tip_${k + 1}`, "Rib tip", "canopy", { type: "capsule", params: { radius: 0.0042, length: 0.012 } }, TIP, tip, [0, r4((a * 180) / Math.PI - 90), -128]),
    prim(`stretcher_${k + 1}`, "Stretcher", "canopy", {
      type: "tube",
      params: { points: [[r4(Math.sin(a) * 0.0135), RUNNER_Y + 0.016, r4(Math.cos(a) * 0.0135)], onRib(k, STRETCH_R, 0.0058)], radius: 0.0015, closed: false, sharp: true },
    }, RIB),
  ];
};

const STRAP_A = ribAngle(2) + Math.PI / PANELS; // hangs from a panel hem, between two ribs
const strapDir: [number, number] = [Math.sin(STRAP_A), Math.cos(STRAP_A)];
const hem = (RIM - 0.008) * Math.cos(Math.PI / PANELS);
const strapPt = (r: number, y: number): V3 => [r4(strapDir[0] * r), y, r4(strapDir[1] * r)];

const parts: Part[] = [
  prim("canopy", "Canopy", null, CANOPY_GEO, FABRIC),

  // Top: ferrule above the canopy, top notch where the ribs meet underneath.
  prim("top_cap", "Top cap", "canopy", { type: "cylinder", params: { radiusTop: 0.0085, radiusBottom: 0.0165, height: 0.012, bevel: 0.003, open: false } }, TIP, [0, APEX + 0.004, 0]),
  prim("ferrule", "Tip ferrule", "canopy", { type: "lathe", params: { points: [[0.0064, APEX + 0.007], [0.0058, APEX + 0.024], [0.0041, APEX + 0.05], [0.0042, APEX + 0.056], [0.0031, APEX + 0.0612], [0, APEX + 0.0626]], angle: 360, segments: 64, sharp: false } }, CHROME),
  prim("top_notch", "Top notch", "canopy", { type: "cylinder", params: { radiusTop: 0.017, radiusBottom: 0.0125, height: 0.03, bevel: 0.003, open: false } }, TIP, [0, APEX - 0.02, 0]),

  // Shaft, the runner the stretchers hinge from, and the spring catch.
  prim("shaft", "Shaft", "canopy", { type: "cylinder", params: { radiusTop: 0.0068, radiusBottom: 0.0068, height: 0.77, bevel: 0.001, open: false } }, CHROME, [0, 0.545, 0]),
  prim("runner", "Runner", "canopy", { type: "cylinder", params: { radiusTop: 0.0148, radiusBottom: 0.0118, height: 0.05, bevel: 0.003, open: false } }, TIP, [0, RUNNER_Y, 0]),
  prim("runner_collar", "Runner collar", "canopy", { type: "torus", params: { radius: 0.0146, tube: 0.0022, arc: 360 } }, TIP, [0, RUNNER_Y + 0.016, 0], [90, 0, 0]),
  prim("spring_catch", "Spring catch", "canopy", { type: "roundedBox", params: { width: 0.004, height: 0.014, depth: 0.004, radius: 0.0012 } }, CHROME, [0, RUNNER_Y - 0.04, 0.0072]),

  ...Array.from({ length: PANELS }, (_, k) => ribParts(k)).flat(),

  // Handle: chrome collar, straight wooden grip and a J hook.
  prim("handle_collar", "Handle collar", "canopy", { type: "cylinder", params: { radiusTop: 0.0095, radiusBottom: 0.0135, height: 0.016, bevel: 0.002, open: false } }, CHROME, [0, 0.168, 0]),
  prim("handle", "Handle", "canopy", {
    type: "tube",
    params: { points: [[0, 0.162, 0], [0, 0.11, 0], [0, 0.062, 0], [0.006, 0.03, 0], [0.026, 0.006, 0], [0.054, 0.002, 0], [0.076, 0.018, 0], [0.084, 0.046, 0], [0.081, 0.062, 0]], radius: 0.0135, closed: false, sharp: false },
  }, WOOD),

  // Closure strap hanging from one panel's hem, with a snap button.
  prim("closure_strap", "Closure strap", "canopy", {
    type: "tube",
    params: { points: [strapPt(hem, r4(yOuter(RIM) + 0.004)), strapPt(hem + 0.004, r4(yOuter(RIM) - 0.03)), strapPt(hem + 0.002, r4(yOuter(RIM) - 0.085)), strapPt(hem - 0.004, r4(yOuter(RIM) - 0.125))], radius: 0.0011, width: 0.022, faceNormal: [r4(strapDir[0]), 0, r4(strapDir[1])], closed: false, sharp: false },
  }, FABRIC),
  {
    id: "strap_snap", name: "Strap snap", kind: "kit", kitAsset: "snap_button", parent: "canopy",
    transform: { position: strapPt(hem + 0.0004, r4(yOuter(RIM) - 0.108)), rotation: [0, r4((STRAP_A * 180) / Math.PI), 0], scale: [1.1, 1.1, 1.1] },
    material: { ...CHROME },
  },
];

export const umbrella: Template | null = {
  id: "umbrella",
  name: "Classic Stick Umbrella",
  keywords: ["umbrella", "parasol", "brolly", "rain umbrella", "golf umbrella", "sun umbrella"],
  category: "umbrella",
  description: "Full-size stick umbrella with an 8-panel windproof canopy, fibreglass ribs, chrome shaft and ferrule, and a curved wooden J handle",
  targetPriceUsd: 59,
  parts,
};
