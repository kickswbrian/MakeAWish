import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { bakedZones, type BakedPath } from "./top-paths.ts";

/**
 * Fitted rib tank over a sculpted base: body with self-fabric bindings at the neckline and armholes
 * and a turned hem band. Coverstitching and labels are modules; necklines, armholes and straps are
 * baked path zones along the bindings (see top-paths.ts).
 */

const LENGTH_K: Record<string, number> = { cropped: 0.55, regular: 1, long: 1.3 };
// The source body is very full through the bust: every fit pulls the depth in toward a dress form.
const FIT: Record<string, [number, number]> = { fitted: [0.92, 0.86], regular: [0.97, 0.92], oversized: [1.1, 1.04] };
// Radial scale below the bust: lgk0 at lgy0 easing back to 1 at lgy1 (straight fills the waist, swing flares the hem).
const SHAPE: Record<string, [number, number, number]> = { shaped: [1, 0.1, 0.28], straight: [1.12, 0.1, 0.28], swing: [1.32, 0, 0.32] };

function deform(c: Record<string, string>, _node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? FIT.regular;
  const [k, y0, y1] = SHAPE[c.silhouette] ?? SHAPE.shaped;
  // Length moves everything below the bust; the silhouette heights follow the moved hem.
  const lk = LENGTH_K[c.length] ?? 1;
  const at = (y: number) => (y < 0.3 ? 0.3 - (0.3 - y) * lk : y);
  return { ly: 0.3, lk, lgx: 0, lgz: 0, lgy0: at(y0), lgy1: at(y1), lgk0: k, lgk1: 1, fx, fz };
}

const PATHS: Record<string, BakedPath> = {
  neckline: { part: "neck_binding", label: "neckline (bound edge, closed; @0.5 is center front)",
    path: [-0.008, 0.4485, -0.1938, 0.0126, 0.4492, -0.1938, 0.0405, 0.4531, -0.1938, 0.0702, 0.4673, -0.1931, 0.0962, 0.5118, -0.1834, 0.1137, 0.5539, -0.164, 0.1238, 0.5827, -0.137, 0.1276, 0.5949, -0.111, 0.1312, 0.5965, -0.0862, 0.1325, 0.5933, -0.0671, 0.1335, 0.5845, -0.0428, 0.1337, 0.5728, -0.0185, 0.1336, 0.5592, 0.0005, 0.1302, 0.5358, 0.0231, 0.1226, 0.5107, 0.0438, 0.1131, 0.4862, 0.0625, 0.0984, 0.4669, 0.0829, 0.079, 0.4515, 0.1001, 0.0573, 0.4376, 0.1123, 0.0366, 0.4322, 0.1188, 0.0071, 0.426, 0.1267, -0.0153, 0.4275, 0.1249, -0.0381, 0.4318, 0.1199, -0.0564, 0.4395, 0.1105, -0.0768, 0.4508, 0.1002, -0.0935, 0.4688, 0.0821, -0.1074, 0.4919, 0.0609, -0.1176, 0.513, 0.0434, -0.1229, 0.5485, 0.0192, -0.1268, 0.5641, -0, -0.1267, 0.5728, -0.0123, -0.1278, 0.5862, -0.0407, -0.1284, 0.5939, -0.062, -0.1305, 0.5965, -0.0859, -0.1268, 0.595, -0.1134, -0.1248, 0.5808, -0.1388, -0.1134, 0.5516, -0.1655, -0.094, 0.5042, -0.1854, -0.0684, 0.4618, -0.1939, -0.0416, 0.4518, -0.1935, -0.008, 0.4485, -0.1938],
    normals: [0.0078, 0.0837, -0.9965, -0.0109, 0.1255, -0.992, -0.0165, 0.0828, -0.9964, 0.0219, 0.1432, -0.9895, 0.0145, 0.2688, -0.9631, 0.2651, 0.4478, -0.8539, 0.3425, 0.6941, -0.6331, 0.4417, 0.8295, -0.3418, 0.4201, 0.9048, 0.069, 0.4846, 0.8445, 0.2281, 0.718, 0.6539, 0.2385, 0.6821, 0.6328, 0.3664, 0.7802, 0.4262, 0.458, 0.6076, 0.4431, 0.6592, 0.3641, 0.4935, 0.7899, 0.3028, 0.5667, 0.7662, 0.2908, 0.6001, 0.7452, -0.0991, 0.7729, 0.6267, -0.0368, 0.7616, 0.647, 0.0039, 0.7971, 0.6038, 0.0185, 0.7121, 0.7019, -0.0092, 0.7673, 0.6412, -0.0265, 0.7328, 0.6799, 0.0403, 0.7845, 0.6188, -0.5736, 0.019, 0.8189, -0.4542, 0.4444, 0.7721, -0.0914, 0.6118, 0.7857, -0.9719, -0.0851, 0.2196, -0.6124, 0.4678, 0.6373, -0.8106, 0.4618, 0.3602, -0.6878, 0.6455, 0.332, -0.577, 0.7327, 0.3609, -0.5042, 0.8148, 0.2862, -0.967, 0.2505, 0.0473, -0.5062, 0.8039, -0.3123, -0.7668, 0.4105, -0.4935, -0.4288, 0.3572, -0.8298, -0.0783, 0.2008, -0.9765, 0.1431, 0.2788, -0.9496, 0.0551, 0.2585, -0.9644, 0.0078, 0.0837, -0.9965] },
  armhole_left: { part: "armhole_binding", label: "left armhole (bound edge, closed)",
    path: [-0.1211, 0.4838, -0.1867, -0.127, 0.5093, -0.1799, -0.1343, 0.5339, -0.1695, -0.1379, 0.5555, -0.1559, -0.1448, 0.5743, -0.1371, -0.1464, 0.5854, -0.1151, -0.1475, 0.589, -0.0882, -0.1489, 0.5864, -0.0679, -0.1479, 0.5785, -0.0417, -0.1461, 0.5684, -0.0202, -0.1459, 0.5561, -0.0045, -0.1446, 0.5438, 0.0078, -0.1439, 0.5294, 0.0184, -0.1436, 0.5149, 0.028, -0.1431, 0.4965, 0.0392, -0.1423, 0.4802, 0.0515, -0.1478, 0.4556, 0.0678, -0.1628, 0.4337, 0.0715, -0.1841, 0.4128, 0.0631, -0.1966, 0.4003, 0.0379, -0.1992, 0.3904, 0.0185, -0.1956, 0.3852, -0.0008, -0.1938, 0.3784, -0.017, -0.1928, 0.3707, -0.0405, -0.1899, 0.3638, -0.0642, -0.1871, 0.355, -0.0896, -0.1781, 0.3506, -0.119, -0.1627, 0.3532, -0.1472, -0.1379, 0.3723, -0.1713, -0.121, 0.3977, -0.1868, -0.1165, 0.4245, -0.1906, -0.1133, 0.4508, -0.1914, -0.1211, 0.4838, -0.1867],
    normals: [-0.1314, 0.1793, -0.975, -0.1769, 0.2436, -0.9536, -0.2991, 0.3437, -0.8902, -0.2202, 0.5692, -0.7922, -0.3133, 0.6883, -0.6543, -0.4562, 0.849, -0.2667, -0.5123, 0.8587, -0.0074, -0.815, 0.5734, 0.0837, -0.9024, 0.4021, 0.1549, -0.5949, 0.6438, 0.4813, -0.595, 0.5371, 0.598, -0.4909, 0.5533, 0.673, -0.597, 0.4445, 0.6679, -0.6001, 0.4057, 0.6894, -0.6001, 0.4057, 0.6894, -0.5082, 0.5496, 0.6631, -0.6485, 0.5713, 0.503, -0.678, 0.6009, 0.4233, -0.7781, 0.5256, 0.3439, -0.9645, 0.23, 0.1301, -0.9317, 0.3216, -0.1691, -0.5401, 0.7585, -0.3647, -0.8721, 0.4569, -0.1752, -0.7714, 0.5869, -0.2459, -0.476, 0.8242, -0.3069, -0.8895, 0.3675, -0.2715, -0.7024, 0.6398, -0.3118, -0.5892, 0.7749, -0.229, -0.8171, 0.5615, -0.1306, -0.1851, -0.2048, -0.9612, -0.1673, -0.0427, -0.985, -0.1345, 0.0794, -0.9877, -0.1314, 0.1793, -0.975] },
  armhole_right: { part: "armhole_binding", label: "right armhole (bound edge, closed)",
    path: [0.1212, 0.4859, -0.186, 0.1128, 0.4551, -0.191, 0.1114, 0.4297, -0.1915, 0.1182, 0.3974, -0.1868, 0.1331, 0.3729, -0.1741, 0.161, 0.3529, -0.1477, 0.1785, 0.3506, -0.1187, 0.1871, 0.3554, -0.0882, 0.189, 0.3636, -0.0654, 0.1919, 0.37, -0.0417, 0.1932, 0.3771, -0.0219, 0.1962, 0.3822, -0.003, 0.1986, 0.3916, 0.016, 0.1967, 0.3996, 0.0362, 0.1853, 0.4153, 0.0571, 0.1657, 0.4371, 0.0635, 0.1543, 0.4577, 0.0577, 0.1503, 0.4813, 0.0437, 0.1523, 0.4942, 0.0333, 0.152, 0.5117, 0.0237, 0.153, 0.5247, 0.0139, 0.1537, 0.5375, 0.0046, 0.1545, 0.5527, -0.0086, 0.1534, 0.5662, -0.0233, 0.1529, 0.5759, -0.0405, 0.1528, 0.5835, -0.0653, 0.1491, 0.5878, -0.0866, 0.1471, 0.5854, -0.1128, 0.1444, 0.5758, -0.1351, 0.1386, 0.5575, -0.1552, 0.135, 0.5353, -0.1686, 0.1252, 0.5115, -0.1793, 0.1212, 0.4859, -0.186],
    normals: [0.1948, 0.1711, -0.9658, 0.219, 0.0683, -0.9733, 0.1698, -0.0369, -0.9848, 0.2551, -0.1709, -0.9517, 0.8521, 0.3792, -0.3606, 0.5286, 0.831, -0.1731, 0.7781, 0.507, -0.3709, 0.9355, 0.2415, -0.2578, 0.3436, 0.8922, -0.2933, 0.8962, 0.397, -0.1982, 0.9223, 0.289, -0.2565, 0.9883, -0.0147, -0.1516, 0.9381, 0.2683, -0.219, 0.9851, 0.1469, 0.0895, 0.8274, 0.469, 0.3089, 0.7443, 0.5569, 0.3685, 0.3717, 0.5303, 0.762, 0.6403, 0.4209, 0.6425, 0.6403, 0.4209, 0.6425, 0.5391, 0.4536, 0.7097, 0.8654, 0.2613, 0.4276, 0.8766, 0.2406, 0.4168, 0.9361, 0.2194, 0.2749, 0.5597, 0.6791, 0.4749, 0.5734, 0.7511, 0.3273, 0.8661, 0.4984, 0.039, 0.3778, 0.9254, 0.0312, 0.4735, 0.8506, -0.2287, 0.373, 0.774, -0.5117, 0.1321, 0.5606, -0.8175, 0.2517, 0.3968, -0.8827, 0.1924, 0.2956, -0.9357, 0.1948, 0.1711, -0.9658] },
  strap_left: { part: "body", label: "left shoulder strap, front to back",
    path: [-0.1225, 0.5096, 0.0412, -0.1286, 0.5334, 0.0228, -0.1298, 0.5544, 0.0052, -0.1311, 0.5692, -0.0148, -0.1337, 0.5818, -0.0424, -0.1336, 0.5918, -0.0769, -0.1353, 0.5883, -0.1109, -0.1303, 0.5754, -0.1382, -0.1218, 0.55, -0.1612, -0.1143, 0.5239, -0.1743],
    normals: [-0.3964, 0.4496, 0.8004, -0.4764, 0.4845, 0.7337, -0.4713, 0.602, 0.6446, -0.3672, 0.7806, 0.5058, -0.3299, 0.8741, 0.3564, -0.4386, 0.8925, 0.1048, -0.393, 0.8865, -0.2444, -0.3001, 0.7225, -0.6228, -0.228, 0.4449, -0.8661, -0.1482, 0.3239, -0.9344] },
  strap_right: { part: "body", label: "right shoulder strap, front to back",
    path: [0.1276, 0.5098, 0.0379, 0.1367, 0.5303, 0.0193, 0.1393, 0.5505, 0.0019, 0.1387, 0.5679, -0.0188, 0.1408, 0.58, -0.0446, 0.1369, 0.5903, -0.0771, 0.1341, 0.5888, -0.1104, 0.1312, 0.5758, -0.1374, 0.123, 0.5509, -0.1608, 0.114, 0.5217, -0.1752],
    normals: [0.4933, 0.4535, 0.7423, 0.5086, 0.464, 0.7253, 0.4806, 0.639, 0.6006, 0.3745, 0.7839, 0.4952, 0.3025, 0.8773, 0.3726, 0.4332, 0.8988, 0.0675, 0.4295, 0.8683, -0.2484, 0.2844, 0.7386, -0.6112, 0.1756, 0.4679, -0.8662, 0.1592, 0.3261, -0.9318] },
};

export const tankFitted = meshTemplate({
  id: "tank_fitted",
  model: "tank_fitted",
  name: "Fitted tank top",
  category: "tank top",
  kind: "top",
  keywords: ["tank top", "tank", "cami", "camisole", "fitted tank", "ribbed tank", "scoop neck tank"],
  description: "Fitted scoop-neck tank with wide shoulder straps, self-fabric bound neckline and armholes, and a coverstitched hem",
  targetPriceUsd: 28,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (cropped ends above the navel)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "fitted", description: "ease through the body" },
    silhouette: { options: ["shaped", "straight", "swing"], default: "shaped", description: "shaped waist, straight boxy body, or swing (flared to the hem)" },
  },
  slots: {
    shell: { description: "body", nodes: ["body"], default: { preset: "rib_knit", color: "#F1EEE7" } },
    trim: { description: "neck and armhole bindings and hem band", nodes: ["neck_binding", "armhole_binding", "hem_band"], default: { preset: "rib_knit", color: "#F1EEE7" }, follows: ["shell"] },
    thread: { description: "coverstitching", nodes: [], default: { preset: "cotton", color: "#E4E0D6" } },
    label: { description: "neck and side labels", nodes: [], default: { preset: "satin", color: "#1F1F22" } },
    accent: { description: "contrast details (bows, embroidery)", nodes: [], default: { preset: "satin", color: "#C9A9A6" } },
    hardware: { description: "metal details", nodes: [], default: { preset: "metal_polished", color: "#C9A34A" } },
    lining: { description: "inside details", nodes: [], default: { preset: "jersey", color: "#F1EEE7" } },
  },
  root: "body",
  deform,
  names: { body: "Body", neck_binding: "Neck binding", armhole_binding: "Armhole binding", hem_band: "Hem band" },
  modules: [
    { module: "topstitch", zone: "neckline", params: { rows: 2, gap: 0.004, pitch: 0.0028, weight: "fine", offset: 0.003 }, material: "thread", name: "Neckline coverstitch" },
    { module: "topstitch", zone: "armhole_*", params: { rows: 2, gap: 0.004, pitch: 0.0028, weight: "fine", offset: 0.003 }, material: "thread", name: "Armhole coverstitch" },
    { module: "topstitch", zone: "hem", params: { rows: 2, gap: 0.005, pitch: 0.003, weight: "fine", offset: -0.01 }, material: "thread", name: "Hem coverstitch" },
    { module: "woven_label", zone: "neck_label", params: { width: 0.035, height: 0.016 }, name: "Neck label" },
    { module: "woven_label", zone: "side_seam_left@0.75", params: { fold: "loop", width: 0.012, height: 0.02 }, name: "Side label" },
  ],
  display: "form",
  // Straps rest on the form's shoulders; slim enough to stay inside the fitted body.
  form: { width: 0.24, depth: 0.16, top: 0.575, z: 0 },
  extraZones: bakedZones(PATHS, deform),
});
