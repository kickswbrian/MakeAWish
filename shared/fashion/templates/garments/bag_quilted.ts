import type { DeformParams } from "../../deform.ts";
import { MESH_MODELS } from "../../../meshes.ts";
import type { V3, Zone } from "../../types.ts";
import { meshTemplate } from "../mesh-template.ts";
import { deformedPath, followHeight } from "./bag-zones.ts";

/**
 * Quilted shopper over a modeled base: a soft diamond-quilted body (the quilting is real geometry)
 * that tapers toward a scooped rim, an inner lining and two rounded rope handles that hang down
 * the front and back. Stitching, keepers and the plate are modules.
 */

const TOP = 0.32;
const SIZE: Record<string, number> = { mini: 0.6, small: 0.8, medium: 1, large: 1.15 };

function deform(c: Record<string, string>): DeformParams {
  const s = SIZE[c.size] ?? 1;
  const p: DeformParams = { ly: TOP, lk: s, fx: s, fz: s };
  // Slouchy: lower, the base spreads and the opening caves in.
  if (c.shape === "slouchy") Object.assign(p, { lk: s * 0.9, lgx: 0, lgz: 0, lgy0: 0.02 * s, lgy1: TOP - (TOP - 0.3) * s, lgk0: 1.06, lgk1: 0.88 });
  return p;
}

// Handle centerlines on the outer face of each rope, right end first (probed from the mesh).
const HANDLE_FRONT: [V3[], V3[]] = [
  [[0.0845, 0.2717, 0.0783], [0.0968, 0.2614, 0.0843], [0.1059, 0.2491, 0.0891], [0.1112, 0.2347, 0.0928], [0.1133, 0.2191, 0.0965], [0.1128, 0.2027, 0.1005], [0.1106, 0.1852, 0.1041], [0.1073, 0.1654, 0.1068], [0.1025, 0.1425, 0.1089], [0.096, 0.1187, 0.1109], [0.0884, 0.0978, 0.1129], [0.079, 0.0811, 0.1146], [0.0639, 0.0673, 0.1158], [0.0373, 0.0568, 0.1165], [-0.0001, 0.0525, 0.117], [-0.0378, 0.0565, 0.1171], [-0.0649, 0.067, 0.1169], [-0.0803, 0.081, 0.1162], [-0.0895, 0.0986, 0.1148], [-0.097, 0.1211, 0.1128], [-0.1034, 0.1458, 0.1105], [-0.1076, 0.1685, 0.1077], [-0.1095, 0.1897, 0.1035], [-0.1096, 0.2134, 0.0971], [-0.1065, 0.2386, 0.089], [-0.0981, 0.2586, 0.0811], [-0.0854, 0.272, 0.0737]],
  [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
];
const HANDLE_BACK: [V3[], V3[]] = [
  [[0.0845, 0.2716, -0.0783], [0.0968, 0.2614, -0.0843], [0.106, 0.2493, -0.0891], [0.1113, 0.2349, -0.0928], [0.1134, 0.2192, -0.0965], [0.1129, 0.2027, -0.1005], [0.1107, 0.1852, -0.1041], [0.1073, 0.1655, -0.1068], [0.1025, 0.1426, -0.1089], [0.096, 0.1187, -0.1109], [0.0884, 0.0978, -0.1129], [0.079, 0.0811, -0.1146], [0.0639, 0.0673, -0.1158], [0.0373, 0.0568, -0.1165], [-0.0001, 0.0525, -0.117], [-0.0378, 0.0565, -0.1171], [-0.0649, 0.067, -0.1169], [-0.0803, 0.0812, -0.1162], [-0.0896, 0.1001, -0.1145], [-0.0973, 0.126, -0.1118], [-0.1039, 0.1557, -0.1084], [-0.1082, 0.183, -0.1047], [-0.1099, 0.2063, -0.0998], [-0.1094, 0.228, -0.0934], [-0.1061, 0.2473, -0.0866], [-0.0979, 0.2617, -0.0802], [-0.0855, 0.272, -0.0737]],
  [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]],
];

/** The rim scoops from 30 cm at the corners to ~24.5 cm at the center; the stitch line follows it. */
const rimHeight = (p: V3) => 0.247 + 0.053 * Math.min(1, Math.abs(p[0]) / 0.18) ** 2.4 - 0.007;

function extraZones(_zones: Record<string, Zone>, c: Record<string, string>): Record<string, Zone> {
  const d = deform(c);
  const out: Record<string, Zone> = {};
  if (c.handles !== "none") {
    out.handle_left = deformedPath("handle_front", "front handle", ...HANDLE_FRONT, d);
    out.handle_right = deformedPath("handle_back", "back handle", ...HANDLE_BACK, d);
  }
  const rim = MESH_MODELS.bag_quilted?.zones?.top_edge;
  if (rim?.path && rim.normals) {
    const z = followHeight({ part: rim.part, label: rim.label, path: rim.path, normals: rim.normals }, rimHeight);
    out.top_edge = deformedPath(rim.part, rim.label, z.path!, z.normals!, d);
  }
  return out;
}

export const bagQuilted = meshTemplate({
  id: "bag_quilted",
  model: "bag_quilted",
  name: "Quilted shopper",
  category: "quilted bag",
  kind: "bag",
  keywords: ["quilted bag", "quilted tote", "quilted purse", "quilted shopper", "chain bag", "puffer bag"],
  description: "Soft diamond-quilted shopper with a scooped rim, contrast lining and two rounded rope handles",
  targetPriceUsd: 180,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size (medium is 30 cm tall, 38 cm wide)" },
    shape: { options: ["structured", "slouchy"], default: "structured", description: "upright body or a softer, lower one" },
    handles: { options: ["rope", "none"], default: "rope", description: "rounded rope handles, or none (add a chain strap)" },
  },
  slots: {
    shell: { description: "quilted body", nodes: ["body"], default: { preset: "leather", color: "#1E1C1D" } },
    handle: { description: "rope handles", nodes: ["handle_front", "handle_back"], default: { preset: "leather", color: "#1E1C1D" } },
    lining: { description: "inside lining", nodes: ["lining"], default: { preset: "satin", color: "#8E2430" } },
    trim: { description: "piping and edges", nodes: [], default: { preset: "leather", color: "#1E1C1D" } },
    hardware: { description: "plate, chain and rings", nodes: [], default: { preset: "metal_polished", color: "#D4AF5A" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#2A2627" } },
    accent: { description: "charms, scarves, tassels", nodes: [], default: { preset: "satin", color: "#F1E6D2" } },
    label: { description: "labels and patches", nodes: [], default: { preset: "leather", color: "#1E1C1D" } },
  },
  root: "body",
  deform,
  hide: (c) => (c.handles === "none" ? ["handle_front", "handle_back"] : []),
  names: { body: "Quilted body", lining: "Lining", handle_front: "Front handle", handle_back: "Back handle" },
  extraZones,
  modules: [
    { module: "topstitch", zone: "top_edge", params: { rows: 2, gap: 0.005, weight: "regular", pitch: 0.003 }, name: "Rim stitching" },
    { module: "logo_plate", zone: "front_center", params: { shape: "bar", width: 0.04, text: "maison" } },
    { module: "strap_keeper", zone: "handle_*@0.07", params: { width: 0.014, strap: 0.012, height: 0.014 }, material: "handle", name: "Handle keeper" },
    { module: "strap_keeper", zone: "handle_*@0.93", params: { width: 0.014, strap: 0.012, height: 0.014 }, material: "handle", name: "Handle keeper" },
  ],
  display: "pedestal",
});
