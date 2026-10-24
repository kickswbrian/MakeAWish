import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { bakedZones, type BakedPath } from "./top-paths.ts";

/**
 * Flowing high-low satin skirt over a cloth-simulated base: a shirred elastic waistband and
 * cascading drapes that fall shorter at the front. The source cloth is two coincident layers, so
 * the prep keeps only the outward-facing side (no z-fighting); the fabric's baked folds are fold
 * normals, and the uneven hemline is a baked path (see top-paths.ts).
 */

// Length shortens or keeps everything below the hip line (y 0.78); the model as cut is a maxi.
const HIP = 0.78;
const LENGTH_K: Record<string, number> = { knee: 0.6, midi: 0.85, maxi: 1 };
// Radial scale at the hem relative to the hip, about the skirt's vertical axis.
const FLARE_K: Record<string, number> = { straight: 0.84, a_line: 1, full: 1.25 };
const FIT: Record<string, number> = { fitted: 0.95, regular: 1, oversized: 1.08 };

function deform(c: Record<string, string>, _node: string): DeformParams {
  const lk = LENGTH_K[c.length] ?? LENGTH_K.midi;
  const f = FIT[c.fit] ?? 1;
  // Fit is the overall size (the elastic waist and drapes scale together).
  return { ly: HIP, lk, lgx: 0, lgz: -0.02, lgy0: HIP, lgy1: HIP - HIP * lk, lgk0: 1, lgk1: FLARE_K[c.flare] ?? 1, fx: f, fz: f };
}

const PATHS: Record<string, BakedPath> = {
  hem: { part: "body", label: "hem (follows the high-low hemline; uneven, @0.5 is center front)",
    path: [0.0021, 0.0613, -0.1453, -0.0054, 0.0645, -0.1619, -0.0041, 0.0883, -0.0654, -0.0083, 0.0561, -0.0631, -0.0157, 0.0555, -0.0663, -0.0829, 0.0451, -0.2099, -0.1069, 0.0438, -0.2101, -0.1219, 0.0413, -0.1976, -0.1238, 0.0371, -0.1693, -0.1038, 0.0317, -0.1257, -0.1019, 0.03, -0.1105, -0.1083, 0.0299, -0.0967, -0.1835, 0.0223, -0.1281, -0.2022, 0.0211, -0.1181, -0.1267, 0.0104, -0.0762, -0.1207, 0.0107, -0.0626, -0.2222, 0.0055, -0.0736, -0.2325, 0.0006, -0.0411, -0.2528, -0.0004, -0.0378, -0.1943, 0.0022, -0.0165, -0.1835, 0.0021, 0.0031, -0.1753, 0.0031, 0.0152, -0.1665, 0.0049, 0.0261, -0.1405, 0.0064, 0.0316, -0.1704, 0.0931, 0.06, -0.2136, 0.1627, 0.1057, -0.2021, 0.1811, 0.125, -0.0996, 0.2279, 0.0657, -0.0922, 0.2345, 0.0741, -0.0141, 0.2117, -0.0036, -0.0701, 0.2181, 0.1028, -0.0198, 0.1692, 0.017, -0.0383, 0.192, 0.0776, -0.0314, 0.1873, 0.0719, -0.021, 0.1778, 0.0608, -0.0158, 0.1864, 0.1502, -0.0048, 0.1811, 0.1526, 0.006, 0.1735, 0.1407, 0.0237, 0.1632, 0.1135, 0.0338, 0.1589, 0.1111, 0.0468, 0.1543, 0.117, 0.0627, 0.1509, 0.128, 0.081, 0.146, 0.1339, 0.1002, 0.1424, 0.1235, 0.1072, 0.1412, 0.1088, 0.1051, 0.1399, 0.0865, 0.1006, 0.1459, 0.064, 0.0993, 0.1413, 0.0605, 0.1681, 0.0949, 0.0785, 0.1715, 0.0867, 0.0645, 0.1851, 0.08, 0.0507, 0.1126, 0.0475, 0.0179, 0.1098, 0.0489, 0.0075, 0.1083, 0.0506, -0.0022, 0.2371, 0.0475, -0.0197, 0.2212, 0.0452, -0.0262, 0.196, 0.0477, -0.0449, 0.1593, 0.0491, -0.0476, 0.2532, 0.0625, -0.097, 0.2398, 0.064, -0.1194, 0.2319, 0.0662, -0.131, 0.1654, 0.0747, -0.1339, 0.154, 0.0774, -0.143, 0.1424, 0.0766, -0.1481, 0.1215, 0.0783, -0.1584, 0.1044, 0.0779, -0.1688, 0.0959, 0.0773, -0.1736, 0.0784, 0.0788, -0.1878, 0.0218, 0.0574, -0.0755, 0.0155, 0.057, -0.0684, 0.0182, 0.0576, -0.1111, 0.0111, 0.0595, -0.1257, 0.0021, 0.0613, -0.1453],
    normals: [0.7774, -0.4921, -0.3918, 0.7011, 0.6914, -0.1743, 0.014, -0.0828, -0.9965, 0.3336, -0.0481, -0.9415, 0.4792, -0.0263, -0.8773, 0.389, -0.2766, -0.8787, -0.238, -0.4107, -0.8802, -0.5474, -0.7414, -0.3881, 0.1157, -0.979, -0.1677, -0.9625, 0.0864, 0.257, -0.9503, -0.293, -0.1051, -0.8353, 0.0304, -0.549, 0.0765, -0.5387, -0.839, -0.9901, 0.0838, -0.1125, -0.6169, -0.5202, 0.5906, -0.943, -0.2564, 0.2123, -0.2839, -0.9244, 0.2549, 0.0466, -0.7034, -0.7093, -0.4277, -0.4681, -0.7733, -0.855, -0.1541, 0.4952, -0.8162, -0.258, 0.5169, -0.4378, -0.8062, 0.3979, -0.5738, -0.122, 0.8099, -0.2602, -0.9634, 0.0647, -0.1325, -0.6446, 0.7529, 0.2132, -0.7026, 0.6789, -0.3014, -0.195, 0.9334, -0.2397, -0.0352, 0.9702, -0.8877, -0.1727, 0.4269, -0.8619, 0.3007, 0.4082, 0.8289, -0.0318, 0.5586, -0.6996, 0.4679, 0.54, 0.3409, -0.3941, 0.8535, 0.6303, -0.0911, 0.771, -0.6009, -0.7717, 0.2082, -0.5284, 0.0465, 0.8477, 0.4184, -0.0536, 0.9067, -0.2406, -0.9366, 0.2547, 0.6035, -0.0391, 0.7964, -0.1893, 0.1971, 0.9619, -0.5641, -0.1626, 0.8095, 0.1399, 0.9727, 0.1851, 0.0201, -0.0322, 0.9993, 0.7475, -0.0747, 0.66, 0.958, -0.083, 0.2744, 0.8133, -0.568, -0.126, 0.9964, 0.0174, -0.0826, 0.3672, 0.9291, -0.0427, 0.9901, 0.1082, -0.0897, 0.8999, 0.2276, 0.3721, 0.6336, 0.2758, 0.7229, 0.6084, -0.5003, 0.6161, 0.0493, -0.9839, -0.1717, 0.6668, -0.7152, -0.2094, 0.3966, -0.4997, -0.77, 0.2727, -0.8646, -0.422, 0.4573, 0.0482, -0.888, 0.8525, -0.0584, 0.5194, 0.9094, 0.1087, -0.4015, 0.0365, -0.9912, -0.1275, 0.628, 0.1487, -0.7638, 0.2969, -0.8728, -0.3874, 0.3664, 0.8323, -0.416, 0.0103, -0.9906, -0.1363, -0.6186, 0.2415, -0.7476, 0.1807, -0.9348, -0.3058, 0.191, -0.9405, -0.2811, 0.0805, -0.9936, -0.0798, 0.4745, 0.1559, -0.8663, -0.7883, -0.055, -0.6129, 0.3988, -0.8676, -0.2969, 0.6989, -0.6146, -0.3657, 0.7774, -0.4921, -0.3918] },
};

export const skirtMidi = meshTemplate({
  id: "skirt_midi",
  model: "skirt_midi",
  name: "Draped midi skirt",
  category: "skirt",
  kind: "skirt",
  keywords: ["midi skirt", "maxi skirt", "flowy skirt", "long skirt"],
  description: "Flowing high-low satin skirt with a shirred elastic waistband and cascading drapes, shorter at the front",
  targetPriceUsd: 78,
  controls: {
    length: { options: ["knee", "midi", "maxi"], default: "midi", description: "length at the back (the front sits higher)" },
    flare: { options: ["straight", "a_line", "full"], default: "a_line", description: "how wide the drapes sweep at the hem" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "overall ease: waist, hip and hem scale together" },
  },
  slots: {
    shell: { description: "skirt", nodes: ["body"], default: { preset: "satin", color: "#1E2740" } },
    trim: { description: "elastic waistband", nodes: ["waistband"], default: { preset: "satin", color: "#1E2740" }, follows: ["shell"] },
    lining: { description: "inner drape panels", nodes: ["lining"], default: { preset: "satin", color: "#1E2740" } },
    thread: { description: "waistband stitching", nodes: [], default: { preset: "cotton", color: "#161C2E" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "satin", color: "#F1EEE7" } },
    hardware: { description: "metal details", nodes: [], default: { preset: "metal_polished", color: "#C9A34A" } },
    accent: { description: "contrast details (bows, embroidery, trims)", nodes: [], default: { preset: "satin", color: "#C9A9A6" } },
  },
  root: "body",
  deform,
  names: { body: "Skirt", waistband: "Elastic waistband", lining: "Inner drape panels" },
  modules: [
    { module: "topstitch", zone: "waistband", params: { rows: 3, gap: 0.011, pitch: 0.0028, weight: "fine" }, name: "Elastic channel stitching" },
    { module: "woven_label", zone: "waistband_label", params: { width: 0.035, height: 0.015 }, name: "Waistband label" },
  ],
  display: "form",
  // Slim hip form (the elastic waist is narrow and the front drapes part), raised so the maxi clears the floor.
  form: { width: 0.21, depth: 0.12, z: -0.01, lift: 0.4 },
  extraZones: bakedZones(PATHS, deform),
});
