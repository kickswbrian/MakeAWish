import type { DeformParams } from "../../deform.ts";
import { MESH_MODELS } from "../../../meshes.ts";
import type { V3, Zone } from "../../types.ts";
import { meshTemplate } from "../mesh-template.ts";
import { deformedCorners, deformedPath, followHeight } from "./bag-zones.ts";

/**
 * Structured leather work tote over a modeled base: body with an inner leather facing, a lining,
 * a stitched-on base, a front and back patch pocket, two side pockets that wrap the front corners,
 * and two handles whose straps run down the body to the base. The source's baked stitching, buckle
 * and key ring are dropped; stitching, bar tacks, feet and the logo plate are detail modules.
 */

/** Model frame: rim height and the height every size scales from (above the handles). */
const RIM = 0.3;
const TOP = 0.5;
const SIZE: Record<string, number> = { mini: 0.62, small: 0.8, medium: 1, large: 1.14 };
const HANDLE: Record<string, number> = { short: 0.72, regular: 1, long: 1.45 };
const HANDLES = ["handle_front", "handle_back"];

function deform(c: Record<string, string>, node: string): DeformParams {
  const s = SIZE[c.size] ?? 1;
  const rim = TOP - (TOP - RIM) * s;
  // Size: uniform scale (the stage grounds the bag again).
  const p: DeformParams = { ly: TOP, lk: s, fx: s, fz: s };
  // Slouchy: softer and lower, the opening caves in a little and the base spreads.
  if (c.shape === "slouchy") Object.assign(p, { lk: s * 0.93, lgx: 0, lgz: 0, lgy0: 0.02 * s, lgy1: rim, lgk0: 1.05, lgk1: 0.9, fz: s * 0.9 });
  // Handle drop: everything above the rim stretches up from it.
  if (HANDLES.includes(node)) {
    const r = TOP - (TOP - RIM) * (p.lk as number);
    Object.assign(p, { sox: 0, soy: r, soz: 0, sdx: 0, sdy: 1, sdz: 0, s0: 0, sk: HANDLE[c.handles] ?? 1 });
  }
  return p;
}

// Handle arcs from rim to rim (outer face of the strap, probed from the mesh): right end first.
const HANDLE_FRONT: [V3[], V3[]] = [
  [[0.0783, 0.3054, 0.0648], [0.0771, 0.3201, 0.0638], [0.076, 0.3341, 0.0631], [0.0752, 0.3471, 0.0629], [0.0745, 0.3592, 0.0631], [0.0737, 0.3705, 0.0636], [0.0725, 0.3814, 0.064], [0.0706, 0.3921, 0.0645], [0.0679, 0.4028, 0.0652], [0.0643, 0.4134, 0.0659], [0.0592, 0.4237, 0.0665], [0.0526, 0.4331, 0.0668], [0.0443, 0.4411, 0.067], [0.0345, 0.4472, 0.0668], [0.0237, 0.4509, 0.0662], [0.0123, 0.4522, 0.065], [0.0011, 0.4511, 0.0628], [-0.0096, 0.448, 0.0597], [-0.0196, 0.4433, 0.0558], [-0.0288, 0.4375, 0.0515], [-0.0371, 0.4308, 0.0474], [-0.0445, 0.4235, 0.0437], [-0.0511, 0.4157, 0.0407], [-0.0571, 0.4076, 0.0384], [-0.0625, 0.3991, 0.0369], [-0.0669, 0.3901, 0.0361], [-0.07, 0.3805, 0.0357], [-0.0717, 0.3704, 0.0356], [-0.0719, 0.3597, 0.0359], [-0.0715, 0.3483, 0.0372], [-0.0714, 0.3357, 0.0399], [-0.0723, 0.3218, 0.0442], [-0.0739, 0.3069, 0.0495]],
  [[-0.249, 0.209, 0.946], [-0.387, 0.199, 0.9], [-0.517, 0.174, 0.838], [-0.634, 0.126, 0.763], [-0.732, 0.051, 0.679], [-0.807, -0.047, 0.588], [-0.855, -0.164, 0.491], [-0.875, -0.291, 0.387], [-0.864, -0.422, 0.276], [-0.821, -0.548, 0.159], [-0.749, -0.661, 0.04], [-0.651, -0.756, -0.071], [-0.534, -0.83, -0.162], [-0.406, -0.885, -0.227], [-0.272, -0.927, -0.258], [-0.134, -0.958, -0.252], [0.005, -0.978, -0.208], [0.145, -0.981, -0.128], [0.28, -0.96, -0.02], [0.404, -0.909, 0.104], [0.508, -0.829, 0.235], [0.586, -0.724, 0.364], [0.633, -0.603, 0.486], [0.648, -0.473, 0.597], [0.636, -0.344, 0.691], [0.604, -0.225, 0.765], [0.565, -0.119, 0.816], [0.529, -0.027, 0.848], [0.497, 0.053, 0.866], [0.467, 0.123, 0.876], [0.431, 0.183, 0.884], [0.386, 0.234, 0.892], [0.333, 0.279, 0.901]],
];
const HANDLE_BACK: [V3[], V3[]] = [
  [[0.0678, 0.3125, -0.0504], [0.0667, 0.3256, -0.0494], [0.0653, 0.338, -0.0484], [0.0635, 0.3495, -0.0474], [0.0614, 0.3599, -0.0466], [0.0592, 0.3694, -0.0459], [0.0568, 0.3782, -0.0453], [0.0541, 0.3864, -0.0447], [0.0512, 0.3945, -0.044], [0.048, 0.4028, -0.0434], [0.0445, 0.4117, -0.0428], [0.0403, 0.4211, -0.042], [0.035, 0.4309, -0.0406], [0.0282, 0.4407, -0.0385], [0.0198, 0.4497, -0.0358], [0.0095, 0.4569, -0.0329], [-0.0019, 0.4613, -0.0302], [-0.014, 0.4623, -0.0284], [-0.0256, 0.4595, -0.0275], [-0.036, 0.4534, -0.0277], [-0.0446, 0.4446, -0.029], [-0.0514, 0.4343, -0.0307], [-0.0565, 0.4232, -0.0326], [-0.0604, 0.4121, -0.0343], [-0.0634, 0.4012, -0.0358], [-0.0658, 0.3907, -0.0372], [-0.0678, 0.3804, -0.0387], [-0.0693, 0.3701, -0.0402], [-0.0702, 0.3595, -0.0419], [-0.0708, 0.3482, -0.0439], [-0.0713, 0.3359, -0.0466], [-0.0718, 0.3227, -0.0499], [-0.0723, 0.3089, -0.0537]],
  [[-0.209, 0.176, -0.962], [-0.259, 0.148, -0.954], [-0.309, 0.117, -0.944], [-0.359, 0.078, -0.93], [-0.405, 0.031, -0.914], [-0.444, -0.027, -0.896], [-0.471, -0.093, -0.877], [-0.484, -0.165, -0.859], [-0.481, -0.239, -0.843], [-0.461, -0.313, -0.83], [-0.425, -0.384, -0.819], [-0.376, -0.454, -0.808], [-0.316, -0.526, -0.789], [-0.246, -0.606, -0.757], [-0.166, -0.693, -0.702], [-0.072, -0.777, -0.625], [0.032, -0.843, -0.537], [0.144, -0.874, -0.464], [0.256, -0.865, -0.431], [0.358, -0.819, -0.448], [0.445, -0.74, -0.504], [0.511, -0.639, -0.575], [0.557, -0.526, -0.643], [0.584, -0.412, -0.7], [0.595, -0.304, -0.744], [0.593, -0.202, -0.779], [0.578, -0.11, -0.809], [0.551, -0.026, -0.834], [0.514, 0.047, -0.856], [0.467, 0.109, -0.877], [0.409, 0.158, -0.899], [0.343, 0.196, -0.919], [0.27, 0.227, -0.936]],
];

/** The top edge dips ~6 mm at the center front and back; the rim stitch line follows it 4 mm down. */
const rimHeight = (p: V3) => 0.3015 - 0.006 * Math.max(0, 1 - (p[0] / 0.1) ** 2) - 0.004;

function extraZones(_zones: Record<string, Zone>, c: Record<string, string>): Record<string, Zone> {
  const out: Record<string, Zone> = {
    handle_left: deformedPath("handle_front", "front handle", ...HANDLE_FRONT, deform(c, "handle_front")),
    handle_right: deformedPath("handle_back", "back handle", ...HANDLE_BACK, deform(c, "handle_back")),
    base_corners: deformedCorners("base", 0.105, 0.04, 0, deform(c, "base")),
  };
  const rim = MESH_MODELS.tote_leather?.zones?.top_edge;
  if (rim?.path && rim.normals) {
    const z = followHeight({ part: rim.part, label: rim.label, path: rim.path, normals: rim.normals }, rimHeight);
    out.top_edge = deformedPath(rim.part, rim.label, z.path!, z.normals!, deform(c, rim.part));
  }
  return out;
}

export const toteLeather = meshTemplate({
  id: "tote_leather",
  model: "tote_leather",
  name: "Leather tote",
  category: "tote bag",
  kind: "bag",
  keywords: ["tote", "tote bag", "leather tote", "work tote", "structured tote", "laptop tote", "office tote", "carryall"],
  description: "Structured leather work tote: open top with a leather facing, front and back patch pockets, wrap-around side pockets and two handles stitched down to the base",
  targetPriceUsd: 240,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size (medium is 30 cm tall, 31 cm wide)" },
    shape: { options: ["structured", "slouchy"], default: "structured", description: "stiff upright walls or a softer, lower body" },
    handles: { options: ["short", "regular", "long"], default: "regular", description: "handle drop (long fits over the shoulder)" },
    pockets: { options: ["all", "side", "none"], default: "all", description: "outer pockets: front, back and side; side only; or a clean body" },
  },
  slots: {
    shell: { description: "body, pockets and base", nodes: ["body", "facing", "pocket_front", "pocket_back", "pocket_left", "pocket_right", "base"], default: { preset: "leather", color: "#7A4425" } },
    handle: { description: "handles and their straps", nodes: ["handle_front", "handle_back"], default: { preset: "leather", color: "#7A4425" } },
    lining: { description: "inside lining", nodes: ["lining"], default: { preset: "suede", color: "#B89A78" } },
    trim: { description: "painted edges and piping", nodes: [], default: { preset: "leather", color: "#3A2016" } },
    hardware: { description: "feet, plates and rings", nodes: [], default: { preset: "metal_polished", color: "#C9A45C" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#6B3F1E" } },
    accent: { description: "charms, scarves, tassels", nodes: [], default: { preset: "satin", color: "#D9C4A3" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "leather", color: "#3A2016" } },
  },
  root: "body",
  deform,
  hide: (c) => (c.pockets === "none" ? ["pocket_front", "pocket_back", "pocket_left", "pocket_right"] : c.pockets === "side" ? ["pocket_front", "pocket_back"] : []),
  names: {
    body: "Body", facing: "Inner facing", lining: "Lining", base: "Base", handle_front: "Front handle", handle_back: "Back handle",
    pocket_front: "Front pocket", pocket_back: "Back pocket", pocket_left: "Left side pocket", pocket_right: "Right side pocket",
  },
  extraZones,
  modules: [
    { module: "topstitch", zone: "top_edge", params: { rows: 1, weight: "regular", pitch: 0.0035 }, name: "Rim stitching" },
    { module: "topstitch", zone: "leg_*", params: { rows: 2, gap: 0.017, weight: "regular", pitch: 0.0035 }, name: "Strap stitching" },
    { module: "topstitch", zone: "handle_*", params: { rows: 2, gap: 0.013, weight: "regular", pitch: 0.0035 }, name: "Handle stitching" },
    { module: "topstitch", zone: "edge_front", params: { rows: 1, offset: 0.004, weight: "regular", pitch: 0.0035 }, name: "Pocket stitching" },
    { module: "topstitch", zone: "edge_back", params: { rows: 1, offset: 0.004, weight: "regular", pitch: 0.0035 }, name: "Pocket stitching" },
    { module: "edge_paint", zone: "edge_front", params: { thickness: 0.0025 } },
    { module: "edge_paint", zone: "edge_back", params: { thickness: 0.0025 } },
    { module: "bar_tack", zone: "leg_*@0.05", params: { length: 0.016, width: 0.0018 }, name: "Strap bar tack" },
    { module: "foot_stud", zone: "base_corners", params: { count: 4, shape: "dome", radius: 0.0065 }, name: "Base foot" },
    { module: "logo_plate", zone: "front_center", params: { shape: "rect", width: 0.04, text: "maison" } },
  ],
  display: "pedestal",
});
