import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { bakedZones, type BakedPath } from "./top-paths.ts";

/**
 * Strapless zip-front crop top (bustier): sweetheart top edge, seamed fitted body and a flounce ruffle
 * at the hem. The zipper was only painted on the source texture; it comes back as a real zipper
 * module up the center front.
 */

// Length stretches the body below the bust; the ruffle rides down with the hem (a far-away pivot
// with a scale just over 1 is a near-pure translation) instead of stretching.
const LY = 0.182;
const RUFFLE_TOP = 0.041;
const PIVOT = 5;
const LENGTH_K: Record<string, number> = { cropped: 1, regular: 1.68, long: 2.32 };
const FIT: Record<string, [number, number]> = { fitted: [0.97, 0.97], regular: [1, 1], oversized: [1.08, 1.08] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? FIT.fitted;
  const lk = LENGTH_K[c.length] ?? 1;
  if (node === "ruffle") {
    const top = LY - (LY - RUFFLE_TOP) * lk;
    return { ly: PIVOT, lk: (PIVOT - top) / (PIVOT - RUFFLE_TOP), fx, fz };
  }
  return { ly: LY, lk, fx, fz };
}

const hide = (c: Record<string, string>) => (c.ruffle === "none" ? ["ruffle"] : []);

const PATHS: Record<string, BakedPath> = {
  neckline: { part: "body", label: "sweetheart top edge (closed; @0.5 is center front)",
    path: [0.0087, 0.215, -0.1344, 0.0239, 0.2144, -0.1344, 0.0416, 0.2151, -0.1336, 0.0641, 0.2158, -0.1322, 0.0858, 0.217, -0.1283, 0.1051, 0.22, -0.1215, 0.1264, 0.2244, -0.11, 0.1443, 0.2331, -0.0931, 0.1556, 0.2413, -0.0756, 0.1642, 0.2541, -0.0501, 0.1663, 0.2649, -0.0276, 0.1653, 0.2706, -0.0092, 0.1595, 0.2856, 0.0142, 0.1502, 0.2967, 0.0352, 0.1366, 0.3049, 0.0504, 0.1235, 0.3084, 0.0617, 0.1079, 0.3089, 0.0732, 0.0934, 0.308, 0.0812, 0.0806, 0.3059, 0.0887, 0.0668, 0.3005, 0.0962, 0.0522, 0.2937, 0.1024, 0.0394, 0.288, 0.1071, 0.0257, 0.2836, 0.11, 0.0088, 0.2776, 0.1151, -0.0075, 0.2789, 0.1129, -0.0239, 0.284, 0.1087, -0.0382, 0.2909, 0.1036, -0.048, 0.2934, 0.1004, -0.0652, 0.3028, 0.0911, -0.079, 0.3054, 0.0874, -0.0923, 0.3079, 0.0805, -0.1058, 0.3087, 0.0753, -0.1214, 0.3064, 0.065, -0.1386, 0.3002, 0.0511, -0.1521, 0.2898, 0.0349, -0.1592, 0.2806, 0.0157, -0.1638, 0.2685, -0.0004, -0.1658, 0.2588, -0.0269, -0.1641, 0.2479, -0.049, -0.1571, 0.2381, -0.0707, -0.1451, 0.2295, -0.0904, -0.1272, 0.2226, -0.1082, -0.1082, 0.2188, -0.1201, -0.0844, 0.2162, -0.1284, -0.0644, 0.2158, -0.1314, -0.0473, 0.214, -0.1329, -0.0307, 0.2144, -0.1333, -0.0114, 0.215, -0.1341, 0.0087, 0.215, -0.1344],
    normals: [-0.0406, -0.2918, -0.9556, 0.0313, -0.127, -0.9914, 0.032, -0.1848, -0.9823, 0.1342, 0.0066, -0.9909, 0.2387, 0.1371, -0.9614, 0.4113, 0.0339, -0.9109, 0.5486, 0.1828, -0.8159, 0.7298, 0.1654, -0.6634, 0.8928, 0.0622, -0.4461, 0.945, 0.1698, -0.2794, 0.9521, 0.2703, -0.143, 0.9549, 0.0842, 0.2846, 0.891, -0.2458, 0.3816, 0.756, -0.2115, 0.6194, 0.7265, 0.4448, 0.5238, 0.4883, 0.7653, 0.4194, 0.3639, 0.6525, 0.6647, 0.3113, 0.8265, 0.4691, -0.0876, 0.9188, 0.3849, -0.1185, 0.8783, 0.4631, 0.2654, 0.5927, 0.7604, -0.0397, 0.6685, 0.7427, -0.1133, 0.6939, 0.7111, -0.0843, 0.5963, 0.7983, -0.01, 0.6775, 0.7354, 0.0385, 0.6832, 0.7293, 0.1459, 0.8003, 0.5815, -0.2379, 0.6986, 0.6748, -0.0956, 0.6242, 0.7754, -0.0361, 0.8189, 0.5728, -0.2355, 0.6628, 0.7108, -0.2214, 0.8535, 0.4718, -0.3955, 0.8596, 0.3236, -0.5819, 0.7851, 0.212, -0.8867, 0.4195, 0.1943, -0.9556, 0.0482, 0.2906, -0.9512, -0.0835, 0.2972, -0.9152, 0.3635, -0.1739, -0.8958, 0.311, -0.3177, -0.8737, 0.1538, -0.4616, -0.8087, -0.1778, -0.5608, -0.6172, -0.1533, -0.7718, -0.3862, 0.2397, -0.8907, -0.2086, 0.0785, -0.9748, -0.1179, -0.2528, -0.9603, -0.0161, -0.3378, -0.9411, -0.0147, -0.1549, -0.9878, -0.0054, -0.0519, -0.9986, -0.0406, -0.2918, -0.9556] },
};

export const topCropZip = meshTemplate({
  id: "top_crop_zip",
  model: "top_crop_zip",
  name: "Zip-front bustier crop top",
  category: "crop top",
  kind: "top",
  keywords: ["crop top", "zip top", "zip up crop top", "baby tee", "bustier", "bustier top", "corset top", "strapless top", "tube top"],
  description: "Strapless bustier crop top with a sweetheart neckline, full-length front zipper and a flounce ruffle hem",
  targetPriceUsd: 55,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "cropped", description: "body length (regular reaches the waist, long the high hip)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "fitted", description: "ease through the body" },
    ruffle: { options: ["ruffle", "none"], default: "ruffle", description: "flounce ruffle at the hem or a clean hem" },
  },
  slots: {
    shell: { description: "body", nodes: ["body"], default: { preset: "leather", color: "#18181B" } },
    trim: { description: "hem ruffle", nodes: ["ruffle"], default: { preset: "leather", color: "#18181B" }, follows: ["shell"] },
    hardware: { description: "zipper teeth and slider", nodes: [], default: { preset: "metal_polished", color: "#C9CBD0" } },
    thread: { description: "edge stitching", nodes: [], default: { preset: "cotton", color: "#2A2A2E" } },
    label: { description: "labels", nodes: [], default: { preset: "satin", color: "#F2EFE9" } },
    accent: { description: "contrast details (bows, piping)", nodes: [], default: { preset: "satin", color: "#18181B" } },
    lining: { description: "inside lining", nodes: [], default: { preset: "satin", color: "#18181B" } },
  },
  root: "body",
  deform,
  hide,
  names: { body: "Body", ruffle: "Hem ruffle" },
  modules: [
    { module: "zipper_path", zone: "placket", params: { style: "metal", pull: "tab", tape: "black", tape_width: 0.005 }, material: "hardware", name: "Front zipper" },
    { module: "topstitch", zone: "neckline", params: { rows: 1, pitch: 0.003, weight: "regular", offset: 0.006 }, name: "Top edge stitching" },
    { module: "topstitch", zone: "hem", params: { rows: 1, pitch: 0.003, weight: "regular", offset: 0.005 }, name: "Waist seam stitching" },
    { module: "woven_label", zone: "neck_label", params: { width: 0.032, height: 0.014 }, name: "Inside label" },
  ],
  display: "form",
  // Strapless: the form's shoulders and neck rise above the top edge.
  form: { width: 0.25, depth: 0.19, top: 0.42, z: 0.0 },
  extraZones: bakedZones(PATHS, deform, hide),
});
