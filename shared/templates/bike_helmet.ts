import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: modern commuter / road bike helmet.
 * The shell is a lathe (revolved around Y, rim at y = 0) stretched front-to-back by the root's
 * Z scale, so every child's position is in that stretched frame: a point on the lathe surface
 * stays on the shell. Helpers convert real-world Z into the shell frame (z / SZ) and kit parts
 * mounted on front/back faces carry a 1/SZ Z scale so they keep real proportions.
 * Ear area (x = +-0.105, y = -0.05, z = 0) is kept clear between the front and rear straps.
 */

const SZ = 1.28;
const z = (real: number) => +(real / SZ).toFixed(4);
const iz = +(1 / SZ).toFixed(4);

const SHELL: PartMaterial = { preset: "plastic_matte", color: "#2E5E4E" };
const WRAP: PartMaterial = { preset: "plastic_gloss", color: "#1C1E21" };
const FOAM: PartMaterial = { preset: "knit", color: "#2B2D31" };
const STRAP: PartMaterial = { preset: "nylon", color: "#1E1F22" };
const ACCENT: PartMaterial = { preset: "plastic_gloss", color: "#E9A23B" };
const HARD: PartMaterial = { preset: "plastic_matte", color: "#222326" };
const CUT: PartMaterial = { preset: "plastic_matte", color: "#888888" };

type V3 = [number, number, number];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position, rotation, scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position, rotation, scale }, material: { ...material } };
}

/** Invisible vent cutter carved out of the shell. */
function vent(id: string, name: string, w: number, h: number, d: number, position: V3, rotation: V3 = [0, 0, 0]): Part {
  return {
    ...prim(id, name, "shell", { type: "roundedBox", params: { width: w, height: h, depth: d, radius: Math.min(w, h, d) * 0.45 } }, CUT, position, rotation),
    csg: { op: "subtract", withPartId: "shell" },
  };
}

/** A flat webbing strap through real-world points (converted into the shell frame). */
function strap(id: string, name: string, pts: V3[], faceNormal: V3, width = 0.016): Part {
  return prim(id, name, "shell", {
    type: "tube",
    params: { points: pts.map(([x, y, zz]) => [x, y, z(zz)] as V3), radius: 0.0011, width, faceNormal, closed: false, sharp: false },
  }, STRAP);
}

// Shell profile [radius, y]: inner surface from the crown down, then the outer surface back up.
const OUTER: [number, number][] = [[0.097, -0.075], [0.1012, -0.05], [0.1035, -0.02], [0.1048, 0.0], [0.105, 0.03], [0.1, 0.06], [0.088, 0.09], [0.066, 0.12], [0.04, 0.14], [0.013, 0.152], [0, 0.154]];
const INNER: [number, number][] = [[0, 0.134], [0.03, 0.125], [0.052, 0.11], [0.068, 0.09], [0.08, 0.06], [0.085, 0.03], [0.0855, 0.0], [0.085, -0.02], [0.0835, -0.05], [0.08, -0.075]];

// The rim is cut on a plane tilted so the back sits lower than the brow (like a real road helmet):
// y = RIM_Y + RIM_SLOPE * z in the shell frame. RIM_TILT is that plane's angle about X.
const RIM_Y = -0.014;
const RIM_SLOPE = 0.32;
const RIM_TILT = -+(Math.atan(RIM_SLOPE) * 180 / Math.PI).toFixed(2);
const rimN: V3 = [0, Math.cos(Math.atan(RIM_SLOPE)), -Math.sin(Math.atan(RIM_SLOPE))];
/** Invisible box below the rim plane that trims the shell's lower edge. */
function rimCutter(): Part {
  const d = -0.1;
  const c: V3 = [0, +(RIM_Y + rimN[1] * d).toFixed(4), +(rimN[2] * d).toFixed(4)];
  return {
    ...prim("rim_cut", "Rim line cut", "shell", { type: "roundedBox", params: { width: 0.4, height: 0.2, depth: 0.5, radius: 0.01 } }, CUT, c, [RIM_TILT, 0, 0]),
    csg: { op: "subtract", withPartId: "shell" },
  };
}

// Visor outline seen from above (x, z in the shell frame): buried along the shell, a soft crescent at the front.
const VISOR: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = -1 + (2 * i) / 12;
    const phi = t * 0.72;
    const r = 0.099 + 0.027 * Math.cos((t * Math.PI) / 2) ** 0.8;
    out.push([+(r * Math.sin(phi)).toFixed(4), +(r * Math.cos(phi)).toFixed(4)]);
  }
  for (let i = 12; i >= 0; i--) {
    const phi = (-1 + (2 * i) / 12) * 0.72;
    out.push([+(0.09 * Math.sin(phi)).toFixed(4), +(0.09 * Math.cos(phi)).toFixed(4)]);
  }
  return out;
})();

const parts: Part[] = [
  prim("shell", "Shell", null, {
    type: "lathe",
    params: { points: [...INNER, ...OUTER], angle: 360, segments: 128, sharp: false },
  }, SHELL, [0, 0, 0], [0, 0, 0], [1, 1, SZ]),
  rimCutter(),

  // Glossy in-mold lower wrap: a ring lying in the tilted rim plane, 1 mm proud of the shell.
  prim("lower_wrap", "Lower wrap", "shell", {
    type: "lathe",
    params: { points: [[0.0885, 0.004], [0.0885, -0.0075], [0.0915, -0.0115], [0.1015, -0.0115], [0.1051, -0.0075], [0.1053, 0.0], [0.1046, 0.004]], angle: 360, segments: 128, sharp: false },
  }, WRAP, [0, +(RIM_Y + RIM_SLOPE * 0.0018).toFixed(4), 0.0018], [RIM_TILT, 0, 0], [1, 1, 1.043]),

  // Vents: crown channels, upper and lower side channels, brow intakes and rear exhausts.
  vent("vent_crown_l", "Left crown vent", 0.016, 0.07, 0.085, [-0.021, 0.15, 0.002]),
  vent("vent_crown_r", "Right crown vent", 0.016, 0.07, 0.085, [0.021, 0.15, 0.002]),
  vent("vent_side_l", "Left side vent", 0.015, 0.07, 0.07, [-0.054, 0.124, -0.004], [0, 0, 30]),
  vent("vent_side_r", "Right side vent", 0.015, 0.07, 0.07, [0.054, 0.124, -0.004], [0, 0, -30]),
  vent("vent_low_l", "Left lower vent", 0.013, 0.06, 0.05, [-0.083, 0.087, -0.012], [0, 0, 58]),
  vent("vent_low_r", "Right lower vent", 0.013, 0.06, 0.05, [0.083, 0.087, -0.012], [0, 0, -58]),
  vent("vent_brow_l", "Left brow vent", 0.026, 0.013, 0.05, [-0.036, 0.07, 0.088], [-22, -20, 0]),
  vent("vent_brow_r", "Right brow vent", 0.026, 0.013, 0.05, [0.036, 0.07, 0.088], [-22, 20, 0]),
  vent("vent_rear_l", "Left rear vent", 0.022, 0.015, 0.05, [-0.034, 0.075, -0.088], [22, 20, 0]),
  vent("vent_rear_r", "Right rear vent", 0.022, 0.015, 0.05, [0.034, 0.075, -0.088], [22, -20, 0]),

  // Raised center ridge running front to back over the crown.
  prim("center_ridge", "Center ridge", "shell", {
    type: "tube",
    params: {
      points: [[0, 0.075, 0.1], [0, 0.11, 0.0775], [0, 0.135, 0.052], [0, 0.1505, 0.022], [0, 0.155, 0], [0, 0.1505, -0.022], [0, 0.135, -0.052], [0, 0.11, -0.0775], [0, 0.08, -0.0985]],
      radius: 0.0032, closed: false, sharp: false,
    },
  }, ACCENT),

  // Short peaked visor across the brow.
  prim("visor", "Visor", "shell", {
    type: "extrude",
    params: { shape: VISOR, depth: 0.0042, bevel: 0.0016, smooth: true },
  }, SHELL, [0, 0.062, 0], [98, 0, 0]),
  kit("visor_pin_l", "Left visor pin", "shell", "screw", HARD, [-0.0645, 0.05, 0.0785], [0, -39, 0], [1.1, 1.1, 1.1]),
  kit("visor_pin_r", "Right visor pin", "shell", "screw", HARD, [0.0645, 0.05, 0.0785], [0, 39, 0], [1.1, 1.1, 1.1]),

  // Comfort padding inside the shell.
  prim("padding", "Comfort padding", "shell", {
    type: "lathe",
    params: { points: [[0, 0.129], [0.028, 0.121], [0.05, 0.106], [0.065, 0.086], [0.0765, 0.06], [0.081, 0.03], [0.0815, 0.0], [0.081, -0.02]], angle: 360, segments: 96, sharp: false },
  }, FOAM),
  prim("brow_pad", "Brow pad", "shell", {
    type: "lathe",
    params: { points: [[0.084, 0.045], [0.0775, 0.04], [0.075, 0.025], [0.0755, 0.01], [0.0835, 0.004]], angle: 84, segments: 48, sharp: false },
  }, FOAM, [0, 0, 0], [0, -42, 0]),

  // Fit system: occipital cradle under the back rim with a ratchet dial.
  prim("fit_cradle", "Fit cradle", "shell", {
    type: "tube",
    params: {
      points: ([[-0.084, 0.0, 0.0], [-0.08, -0.024, -0.058], [-0.05, -0.06, -0.094], [0, -0.072, -0.106], [0.05, -0.06, -0.094], [0.08, -0.024, -0.058], [0.084, 0.0, 0.0]] as V3[]).map(([x, y, zz]) => [x, y, z(zz)] as V3),
      radius: 0.0016, width: 0.012, faceNormal: [0, 0, -1], closed: false, sharp: false,
    },
  }, HARD),
  prim("dial_housing", "Fit dial housing", "shell", {
    type: "roundedBox", params: { width: 0.052, height: 0.026, depth: 0.014, radius: 0.0065 },
  }, HARD, [0, -0.074, z(-0.106)], [-6, 0, 0], [1, 1, iz]),
  kit("fit_dial", "Fit dial", "dial_housing", "knob", { preset: "rubber", color: "#2A2B2E" }, [0, 0, -0.0066], [0, 180, 0], [1, 1, 1], { radius: 0.0125 }),
  kit("dial_accent", "Dial indicator", "dial_housing", "led", { preset: "plastic_gloss", color: "#E9A23B", emissive: "#E9A23B", emissiveIntensity: 0.4 }, [0.019, 0, -0.0066], [0, 180, 0]),

  // Rear safety light.
  prim("light_housing", "Rear light housing", "shell", {
    type: "roundedBox", params: { width: 0.046, height: 0.014, depth: 0.008, radius: 0.0038 },
  }, HARD, [0, 0.032, -0.1035], [13, 0, 0], [1, 1, iz]),
  prim("rear_light", "Rear light", "light_housing", {
    type: "roundedBox", params: { width: 0.038, height: 0.007, depth: 0.004, radius: 0.0018 },
  }, { preset: "plastic_gloss", color: "#FF3B30", emissive: "#FF2A1F", emissiveIntensity: 2.2 }, [0, 0, -0.0034]),
  kit("rear_led", "Rear LED", "light_housing", "led", { preset: "plastic_gloss", color: "#FF3B30", emissive: "#FF3B30" }, [0.0, 0.0, -0.0055], [0, 180, 0], [1.3, 1.3, 1.3]),

  // Straps: front and rear straps meet at a divider below each ear, then run to the chin buckle.
  strap("strap_front_l", "Left front strap", [[-0.087, 0.012, 0.052], [-0.091, -0.02, 0.042], [-0.089, -0.058, 0.018], [-0.086, -0.083, 0.002]], [-1, 0, 0.15]),
  strap("strap_front_r", "Right front strap", [[0.087, 0.012, 0.052], [0.091, -0.02, 0.042], [0.089, -0.058, 0.018], [0.086, -0.083, 0.002]], [1, 0, 0.15]),
  strap("strap_rear_l", "Left rear strap", [[-0.066, -0.008, -0.09], [-0.078, -0.03, -0.066], [-0.085, -0.06, -0.03], [-0.086, -0.083, -0.004]], [-1, 0, -0.25]),
  strap("strap_rear_r", "Right rear strap", [[0.066, -0.008, -0.09], [0.078, -0.03, -0.066], [0.085, -0.06, -0.03], [0.086, -0.083, -0.004]], [1, 0, -0.25]),
  prim("divider_l", "Left strap divider", "shell", { type: "roundedBox", params: { width: 0.006, height: 0.024, depth: 0.03, radius: 0.0028 } }, HARD, [-0.0865, -0.086, z(-0.001)], [0, 0, 6], [1, 1, iz]),
  prim("divider_r", "Right strap divider", "shell", { type: "roundedBox", params: { width: 0.006, height: 0.024, depth: 0.03, radius: 0.0028 } }, HARD, [0.0865, -0.086, z(-0.001)], [0, 0, -6], [1, 1, iz]),
  strap("chin_strap_l", "Left chin strap", [[-0.086, -0.09, 0.0], [-0.077, -0.114, 0.026], [-0.054, -0.132, 0.052], [-0.03, -0.14, 0.066]], [-0.45, -0.55, 0.7]),
  strap("chin_strap_r", "Right chin strap", [[0.086, -0.09, 0.0], [0.077, -0.114, 0.026], [0.054, -0.132, 0.052], [0.03, -0.14, 0.066]], [0.45, -0.55, 0.7]),
  kit("chin_buckle", "Chin buckle", "shell", "buckle_side_release", HARD, [0, -0.142, z(0.069)], [38, 0, 90], [0.8, 0.8, 0.8]),
];

export const bikeHelmet: Template | null = {
  id: "bike_helmet",
  name: "Commuter Bike Helmet",
  keywords: ["bike helmet", "bicycle helmet", "cycling helmet", "skate helmet", "helmet", "bike lid"],
  category: "bike helmet",
  description: "Vented commuter bike helmet with a matte shell, peaked visor, dial fit system, chin buckle and a rear safety light",
  targetPriceUsd: 89,
  parts,
};
