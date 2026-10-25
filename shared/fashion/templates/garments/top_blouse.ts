import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";
import { bakedZones, type BakedPath } from "./top-paths.ts";

/**
 * Satin turtleneck blouse with full balloon sleeves gathered into buttoned cuffs and a lace-up back
 * opening. The baked eyelets and laces were dropped and come back as lacing modules over the
 * eyelet holes (two sections, since the opening widens toward the waist).
 */

// Sleeve axis from the shoulder point toward the cuff (model frame, meters), per side.
const SLEEVE = { r: { o: [0.16, 0.45, 0], d: [0.67, -0.74, 0] }, l: { o: [-0.16, 0.45, 0], d: [-0.67, -0.74, 0] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.72, short: 0.36 };
// Length stretches the body below a plane parallel to the dipped hem (front 4 cm higher than the
// back) and just under the lacing, so front and back drop together and the eyelets never move.
const HEM_N = [0, -0.9857, 0.1686] as const;
const LENGTH_K: Record<string, number> = { cropped: 1, regular: 2.2, long: 3.4 };
const FIT: Record<string, [number, number]> = { fitted: [0.95, 0.95], regular: [1, 1], oversized: [1.1, 1.08] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? FIT.regular;
  const p: DeformParams = { fx, fz };
  if (node === "body") Object.assign(p, { sox: 0, soy: 0.22, soz: 0, sdx: HEM_N[0], sdy: HEM_N[1], sdz: HEM_N[2], s0: 0, sk: LENGTH_K[c.length] ?? 1 });
  if (node === "sleeve_r" || node === "sleeve_l") {
    const s = SLEEVE[node === "sleeve_r" ? "r" : "l"];
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.05, sk: SLEEVE_K[c.sleeves] ?? 1 });
  }
  return p;
}

const hide = (c: Record<string, string>) => (c.collar === "none" ? ["collar"] : []);

const PATHS: Record<string, BakedPath> = {
  neckline: { part: "body", label: "neckline seam under the collar (closed; @0.5 is center front)",
    path: [-0.0113, 0.5003, -0.11, 0.0047, 0.4889, -0.1148, 0.0198, 0.493, -0.1124, 0.0313, 0.5044, -0.1069, 0.0392, 0.5176, -0.098, 0.0546, 0.5269, -0.0876, 0.0634, 0.5327, -0.0757, 0.0714, 0.5319, -0.0658, 0.0772, 0.5288, -0.0488, 0.0755, 0.5209, -0.0326, 0.0715, 0.5112, -0.021, 0.065, 0.5049, -0.0109, 0.0574, 0.5032, -0.0022, 0.0503, 0.4971, 0.0068, 0.0427, 0.495, 0.0135, 0.035, 0.4926, 0.0189, 0.0235, 0.4925, 0.0228, 0.0175, 0.494, 0.0313, 0.0048, 0.4949, 0.0319, -0.0059, 0.4937, 0.0317, -0.0173, 0.4917, 0.0303, -0.021, 0.493, 0.0209, -0.035, 0.4941, 0.02, -0.0366, 0.4955, 0.0102, -0.0436, 0.5016, 0.0019, -0.0502, 0.5072, -0.0066, -0.0555, 0.5117, -0.0143, -0.0612, 0.5156, -0.0219, -0.0685, 0.5206, -0.0323, -0.0708, 0.527, -0.0482, -0.0689, 0.5276, -0.0608, -0.0631, 0.5271, -0.0735, -0.0581, 0.5209, -0.0878, -0.046, 0.5166, -0.096, -0.0355, 0.5149, -0.099, -0.0216, 0.4978, -0.1114, -0.0113, 0.5003, -0.11],
    normals: [-0.0569, 0.4533, -0.8895, 0.2318, 0.5166, -0.8243, 0.0283, 0.3938, -0.9187, 0.0106, 0.5177, -0.8555, 0.0576, 0.5464, -0.8355, 0.2381, 0.6524, -0.7195, 0.5027, 0.6871, -0.5246, 0.6666, 0.6571, -0.3519, 0.7849, 0.6174, 0.0522, 0.7969, 0.3499, 0.4924, 0.7239, 0.3738, 0.5799, 0.7081, 0.2954, 0.6413, 0.668, 0.2093, 0.7142, 0.6034, 0.2581, 0.7545, 0.5399, 0.2355, 0.8081, 0.4106, 0.246, 0.878, 0.1025, 0.2215, 0.9698, 0.2172, 0.1324, 0.9671, 0.0086, 0.082, 0.9966, -0.1187, 0.131, 0.9842, -0.1781, -0.0593, 0.9822, -0.5141, 0.1041, 0.8514, 0.0731, 0.9894, -0.1251, -0.6365, 0.2775, 0.7196, -0.6966, 0.1944, 0.6906, -0.7142, 0.1756, 0.6776, -0.7484, 0.2106, 0.6289, -0.7681, -0.3831, 0.513, -0.8183, 0.4464, 0.362, -0.8375, 0.5315, 0.1271, -0.7007, 0.6979, -0.1482, -0.5143, 0.7391, -0.435, -0.3287, 0.7294, -0.5999, -0.1356, 0.6183, -0.7742, -0.0873, 0.5866, -0.8051, 0.0011, 0.4875, -0.8731, -0.0569, 0.4533, -0.8895] },
  back_center: { part: "body", label: "center back lace-up opening, top to bottom",
    path: [-0.0064, 0.4938, -0.1121, -0.007, 0.4825, -0.1159, -0.0085, 0.4559, -0.1249, -0.009, 0.4287, -0.131, -0.009, 0.4031, -0.1335, -0.009, 0.3744, -0.134, -0.01, 0.3483, -0.1315, -0.0095, 0.3217, -0.1265, -0.011, 0.2946, -0.1204, -0.0125, 0.266, -0.1104, -0.0135, 0.24, -0.1004, -0.014, 0.2121, -0.0919, -0.0142, 0.2006, -0.0885],
    normals: [0, 0.3216, -0.9469, 0, 0.3216, -0.9469, 0, 0.27, -0.9629, 0, 0.1598, -0.9871, 0, 0.0555, -0.9985, 0, -0.0367, -0.9993, 0, -0.1414, -0.9899, 0, -0.2014, -0.9795, 0, -0.277, -0.9609, 0, -0.3445, -0.9388, 0, -0.3241, -0.946, 0, -0.2905, -0.9569, 0, -0.2905, -0.9569] },
  lacing_upper: { part: "body", label: "upper half of the back lacing (narrow, 5 eyelet pairs)",
    path: [-0.0064, 0.4938, -0.1121, -0.007, 0.4825, -0.1159, -0.0085, 0.4559, -0.1249, -0.009, 0.4287, -0.131, -0.009, 0.4031, -0.1335, -0.009, 0.3745, -0.134, -0.009, 0.3625, -0.1342],
    normals: [0, 0.3216, -0.9469, 0, 0.3216, -0.9469, 0, 0.27, -0.9629, 0, 0.1598, -0.9871, 0, 0.0555, -0.9985, 0, 0.0175, -0.9998, 0, 0.0175, -0.9998] },
  lacing_lower: { part: "body", label: "lower half of the back lacing (wide, 6 eyelet pairs)",
    path: [-0.0102, 0.36, -0.1337, -0.01, 0.3482, -0.1315, -0.0095, 0.3217, -0.1265, -0.011, 0.2946, -0.1204, -0.0125, 0.266, -0.1104, -0.0135, 0.24, -0.1004, -0.014, 0.2121, -0.0919, -0.0142, 0.2006, -0.0885],
    normals: [0, -0.1854, -0.9827, 0, -0.1854, -0.9827, 0, -0.2014, -0.9795, 0, -0.277, -0.9609, 0, -0.3445, -0.9388, 0, -0.3241, -0.946, 0, -0.2905, -0.9569, 0, -0.2905, -0.9569] },
};

export const topBlouse = meshTemplate({
  id: "top_blouse",
  model: "top_blouse",
  name: "Satin turtleneck blouse",
  category: "blouse",
  kind: "top",
  keywords: ["blouse", "satin blouse", "button up", "button down", "dress shirt", "turtleneck blouse", "balloon sleeve top", "lace up back top", "puff sleeve top", "cute top", "pretty top", "sweet top", "girly top", "shirt", "outfit"],
  description: "Fitted satin blouse with a turtleneck, full balloon sleeves gathered into buttoned cuffs, and a lace-up back opening",
  targetPriceUsd: 65,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "cropped", description: "body length (cropped ends above the waist, long covers the hip)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "ease through body and sleeves" },
    sleeves: { options: ["long", "three_quarter", "short"], default: "long", description: "balloon sleeve length (short is a puff sleeve)" },
    collar: { options: ["turtleneck", "none"], default: "turtleneck", description: "turtleneck or a plain round neckline" },
  },
  slots: {
    shell: { description: "body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r"], default: { preset: "satin", color: "#8E9196" } },
    collar: { description: "turtleneck collar", nodes: ["collar"], default: { preset: "satin", color: "#8E9196" }, follows: ["shell"] },
    hardware: { description: "eyelets", nodes: [], default: { preset: "metal_polished", color: "#C8CACE" } },
    trim: { description: "laces, ribbons and bands", nodes: [], default: { preset: "satin", color: "#1D1D20" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#7E8186" } },
    label: { description: "labels", nodes: [], default: { preset: "satin", color: "#F2EFE9" } },
    accent: { description: "buttons and contrast details", nodes: [], default: { preset: "pearl", color: "#F3EEE4" } },
    lining: { description: "inside details", nodes: [], default: { preset: "satin", color: "#8E9196" } },
  },
  root: "body",
  deform,
  hide,
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Turtleneck" },
  modules: [
    { module: "lacing", zone: "lacing_upper", params: { count: 5, width: 0.057, lace: "flat", bow: "none", lace_color: "black" }, material: "hardware", name: "Back lacing (upper)" },
    { module: "lacing", zone: "lacing_lower", params: { count: 6, width: 0.082, lace: "flat", bow: "bow", lace_color: "black" }, material: "hardware", name: "Back lacing (lower)" },
    { module: "button", zone: "cuff_*@0", params: { style: "pearl_dome", radius: 0.005 }, material: "accent", name: "Cuff button" },
    { module: "topstitch", zone: "hem", params: { rows: 1, pitch: 0.0025, weight: "fine", offset: 0.008 }, material: "thread", name: "Hem stitch" },
    { module: "topstitch", zone: "cuff_*", params: { rows: 1, pitch: 0.0025, weight: "fine", offset: 0.012 }, material: "thread", name: "Cuff stitch" },
    { module: "woven_label", zone: "neck_label", params: { width: 0.03, height: 0.014 }, name: "Neck label" },
  ],
  display: "form",
  // The body sits well behind the bust line at the neck: a slimmer form, set back, stays inside.
  form: { width: 0.21, depth: 0.15, z: -0.045, top: 0.47 },
  extraZones: bakedZones(PATHS, deform, hide),
});
