import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: foldable consumer camera drone (arms deployed), nose facing +Z.
 * The shell (root) is the body's side profile (z, y) extruded 88 mm across, turned -90 degrees about
 * Y like the office chair's seat; its origin is the body center. Its child "belly" turns back to a
 * world-aligned frame and carries everything else via C() (positions relative to the body center,
 * +Z forward, +Y up). Front arms leave the body high at the shoulders, rear arms low at the hips, so
 * the front and rear rotors overlap in plan without touching. Each rotor is a motor pod, a motor
 * bell, a hub and two twisted blades; a three-axis gimbal hangs the camera under the nose.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

const BODY: PartMaterial = { preset: "plastic_matte", color: "#53575E" };
const DARK: PartMaterial = { preset: "plastic_matte", color: "#26282C" };
const MOTOR: PartMaterial = { preset: "metal_brushed", color: "#3B3E44" };
const PROP: PartMaterial = { preset: "plastic_matte", color: "#2A2C30" };
const RUBBER: PartMaterial = { preset: "rubber", color: "#1C1D20" };
const LENS: PartMaterial = { preset: "glass", color: "#11141A" };
const RED: PartMaterial = { preset: "plastic_gloss", color: "#FF3B30", emissive: "#FF3B30", emissiveIntensity: 2 };
const GREEN: PartMaterial = { preset: "plastic_gloss", color: "#3DFF7A", emissive: "#3DFF7A", emissiveIntensity: 2 };
const WHITE_LED: PartMaterial = { preset: "plastic_gloss", color: "#EAF6FF", emissive: "#EAF6FF", emissiveIntensity: 1.4 };

// ---------- Body ----------

const BODY_W = 0.092;
const TOP = 0.04, BOTTOM = -0.035;
const SHELL_Y = (TOP + BOTTOM) / 2;
const BELLY_Y = -0.032;
/** Body-center coordinates -> the belly's world-aligned frame. */
const C = (x: number, y: number, z: number): V3 => [x, y - BELLY_Y, z];

/** Plan-view outline (x, z): narrow rounded nose, wide shoulders, tucked tail. */
const PLAN: V2[] = (() => {
  const right: V2[] = [[0.018, 0.105], [0.031, 0.098], [0.038, 0.082], [0.043, 0.055], [0.046, 0.02], [0.046, -0.04], [0.045, -0.08], [0.041, -0.102], [0.03, -0.112]];
  const left = right.map(([x, z]): V2 => [-x, z]);
  // Counter-clockwise from the nose: down the left side, across the tail, up the right side.
  return [[0, 0.107], ...left, [0, -0.115], ...right.slice().reverse()];
})();

/** Side-view cutters (z, y): the sloped windscreen over the nose, the chin, and the tail chamfer. */
const NOSE_CUT: V2[] = [[0.0, 0.043], [0.03, 0.0395], [0.06, 0.033], [0.085, 0.0245], [0.1, 0.0175], [0.115, 0.012], [0.14, 0.012], [0.14, 0.08], [0.0, 0.08]];
const CHIN_CUT: V2[] = [[0.055, -0.0365], [0.075, -0.0335], [0.092, -0.027], [0.104, -0.017], [0.115, -0.006], [0.14, -0.006], [0.14, -0.07], [0.055, -0.07]];
const TAIL_CUT: V2[] = [[-0.075, 0.0425], [-0.095, 0.037], [-0.11, 0.029], [-0.125, 0.02], [-0.14, 0.02], [-0.14, 0.08], [-0.075, 0.08]];

const cutter = (id: string, name: string, shape: V2[]): Part => ({
  ...prim(id, name, "belly", { type: "extrude", params: { shape, depth: 0.14, bevel: 0, smooth: false } }, BODY, C(0, 0, 0), [0, -90, 0]),
  csg: { op: "subtract", withPartId: "shell" },
});

// ---------- Rotors ----------

/** Propeller blade outline along +X (hub at the origin), leading edge toward +Y, swept tip. */
function bladeOutline(): V2[] {
  const xs = [0.004, 0.01, 0.02, 0.032, 0.046, 0.06, 0.073, 0.084, 0.092, 0.097];
  const chord = (x: number) => 0.011 + 0.013 * Math.sin(Math.min(1, x / 0.07) * Math.PI * 0.62) - 0.009 * Math.max(0, (x - 0.06) / 0.04) ** 1.6;
  const mid = (x: number) => -0.004 * Math.max(0, (x - 0.03) / 0.07) ** 1.5;
  const trail = xs.map((x): V2 => [x, r4(mid(x) - 0.58 * chord(x))]);
  const lead = xs.map((x): V2 => [x, r4(mid(x) + 0.42 * chord(x))]).reverse();
  // Counter-clockwise: trailing edge out to the tip, leading edge back to the hub.
  return [...trail, [0.1, r4(mid(0.1) - 0.0015)], ...lead];
}

const PITCH = 12;

interface Rotor { k: string; label: string; x: number; y: number; z: number; front: boolean; yaw: number }

function rotor(r: Rotor): Part[] {
  const pod = `pod_${r.k}`, hub = `prop_hub_${r.k}`;
  const out: Part[] = [
    prim(pod, `${r.label} motor pod`, "belly", { type: "cylinder", params: { radiusTop: 0.0155, radiusBottom: 0.0165, height: 0.022, bevel: 0.004, open: false } }, BODY, C(r.x, r.y, r.z)),
    prim(`motor_${r.k}`, `${r.label} motor`, pod, { type: "cylinder", params: { radiusTop: 0.0128, radiusBottom: 0.0136, height: 0.012, bevel: 0.002, open: false } }, MOTOR, [0, 0.016, 0]),
    prim(hub, `${r.label} propeller hub`, pod, { type: "cylinder", params: { radiusTop: 0.0068, radiusBottom: 0.0085, height: 0.006, bevel: 0.0018, open: false } }, PROP, [0, 0.025, 0], [0, r.yaw, 0]),
    prim(`blade_${r.k}_a`, `${r.label} propeller blade`, hub, { type: "extrude", params: { shape: bladeOutline(), depth: 0.0022, bevel: 0.0008, smooth: true } }, PROP, [0, 0.0005, 0], [-90 + PITCH, 0, 0]),
    prim(`blade_${r.k}_b`, `${r.label} propeller blade`, hub, { type: "extrude", params: { shape: bladeOutline(), depth: 0.0022, bevel: 0.0008, smooth: true } }, PROP, [0, 0.0005, 0], [90 - PITCH, 180, 0]),
    // Landing leg under the pod with a rubber foot.
    prim(`leg_${r.k}`, `${r.label} landing leg`, pod, { type: "tube", params: { points: [[0, -0.006, 0], [Math.sign(r.x) * 0.002, (-0.062 - r.y) * 0.55, r.front ? 0.002 : -0.002], [Math.sign(r.x) * 0.004, -0.06 - r.y, r.front ? 0.003 : -0.003]], radius: 0.0048, closed: false, sharp: false } }, BODY),
    prim(`foot_${r.k}`, `${r.label} landing foot`, pod, { type: "sphere", params: { radius: 0.0058, angle: 180 } }, RUBBER, [Math.sign(r.x) * 0.004, -0.06 - r.y - 0.001, r.front ? 0.003 : -0.003]),
    kit(`led_${r.k}`, `${r.label} status LED`, pod, "led", r.front ? RED : GREEN, [0, -0.004, r.front ? 0.0158 : -0.0158], [0, r.front ? 0 : 180, 0]),
  ];
  return out;
}

const ROTORS: Rotor[] = [
  { k: "front_left", label: "Front left", x: -0.155, y: 0.008, z: 0.104, front: true, yaw: 20 },
  { k: "front_right", label: "Front right", x: 0.155, y: 0.008, z: 0.104, front: true, yaw: -35 },
  { k: "rear_left", label: "Rear left", x: -0.15, y: -0.014, z: -0.116, front: false, yaw: 70 },
  { k: "rear_right", label: "Rear right", x: 0.15, y: -0.014, z: -0.116, front: false, yaw: -5 },
];

/** Flat folding arm from the body to a rotor pod. */
function arm(r: Rotor): Part {
  const s = Math.sign(r.x);
  const pts: V3[] = r.front
    ? [C(s * 0.03, 0.012, 0.042), C(s * 0.08, 0.012, 0.075), C(s * 0.125, 0.009, 0.098), C(r.x, r.y, r.z)]
    : [C(s * 0.03, -0.021, -0.068), C(s * 0.08, -0.019, -0.098), C(s * 0.122, -0.016, -0.112), C(r.x, r.y, r.z)];
  return prim(`arm_${r.k}`, `${r.label} arm`, "belly", { type: "tube", params: { points: pts.map(v), radius: 0.0068, width: 0.021, faceNormal: [0, 1, 0], closed: false, sharp: false } }, BODY);
}

// ---------- Gimbal ----------

const CAM_Y = -0.0455, CAM_Z = 0.09;

const gimbal: Part[] = [
  prim("gimbal_yaw", "Gimbal yaw motor", "belly", { type: "cylinder", params: { radiusTop: 0.013, radiusBottom: 0.0115, height: 0.008, bevel: 0.002, open: false } }, DARK, C(0, -0.037, 0.076)),
  prim("gimbal_yoke", "Gimbal yoke", "belly", { type: "tube", params: { points: [C(0, -0.039, 0.076), C(0.012, -0.04, 0.078), C(0.022, -0.042, 0.084), C(0.0235, CAM_Y, CAM_Z)].map(v), radius: 0.0025, width: 0.009, faceNormal: [1, 0, 0], closed: false, sharp: false } }, DARK),
  prim("gimbal_roll", "Gimbal roll motor", "belly", { type: "cylinder", params: { radiusTop: 0.0085, radiusBottom: 0.0085, height: 0.007, bevel: 0.0018, open: false } }, DARK, C(0.0235, CAM_Y, CAM_Z), [0, 0, 90]),
  prim("camera", "Camera", "belly", { type: "roundedBox", params: { width: 0.034, height: 0.024, depth: 0.03, radius: 0.0075 } }, DARK, C(0, CAM_Y, CAM_Z)),
  prim("camera_pivot", "Camera pivot", "camera", { type: "cylinder", params: { radiusTop: 0.0065, radiusBottom: 0.0065, height: 0.004, bevel: 0.001, open: false } }, MOTOR, [-0.0175, 0, 0], [0, 0, 90]),
  kit("camera_lens", "Camera lens", "camera", "camera_lens", LENS, [0, 0, 0.015], [0, 0, 0], { radius: 0.0095 }),
];

// ---------- Assembly ----------

const vent = (i: number, s: 1 | -1): Part =>
  prim(`vent_${s > 0 ? "right" : "left"}_${i + 1}`, "Cooling vent", "belly", { type: "roundedBox", params: { width: 0.002, height: 0.0028, depth: 0.03, radius: 0.0009 } }, DARK, C(s * (BODY_W / 2 - 0.0002), 0.012 - i * 0.006, -0.03));

const parts: Part[] = [
  // The shell's plan outline is extruded top to bottom (turned +90 about X); the belly turns back.
  prim("shell", "Body", null, { type: "extrude", params: { shape: PLAN, depth: TOP - BOTTOM, bevel: 0.014, smooth: true } }, BODY, [0, SHELL_Y, 0], [90, 0, 0]),
  prim("belly", "Belly panel", "shell", { type: "roundedBox", params: { width: 0.066, height: 0.006, depth: 0.15, radius: 0.0025 } }, DARK, [0, 0, -(BELLY_Y - SHELL_Y)], [-90, 0, 0]),
  cutter("nose_cut", "Windscreen cut", NOSE_CUT),
  cutter("chin_cut", "Chin cut", CHIN_CUT),
  cutter("tail_cut", "Tail cut", TAIL_CUT),

  // Battery forming the top of the body, with charge LEDs and a power button.
  prim("battery", "Battery", "belly", { type: "roundedBox", params: { width: 0.07, height: 0.012, depth: 0.106, radius: 0.005 } }, BODY, C(0, 0.0365, -0.05), [-2, 0, 0]),
  prim("battery_grip", "Battery release clip", "battery", { type: "roundedBox", params: { width: 0.032, height: 0.004, depth: 0.012, radius: 0.0015 } }, DARK, [0, 0.0055, 0.042]),
  prim("power_button", "Power button", "battery", { type: "cylinder", params: { radiusTop: 0.0032, radiusBottom: 0.0034, height: 0.002, bevel: 0.0007, open: false } }, DARK, [-0.018, 0.0062, -0.04]),
  kit("battery_led_1", "Battery level LED", "battery", "led", WHITE_LED, [-0.008, 0.006, -0.04], [-90, 0, 0]),
  kit("battery_led_2", "Battery level LED", "battery", "led", WHITE_LED, [0.001, 0.006, -0.04], [-90, 0, 0]),
  kit("battery_led_3", "Battery level LED", "battery", "led", WHITE_LED, [0.01, 0.006, -0.04], [-90, 0, 0]),
  kit("battery_led_4", "Battery level LED", "battery", "led", DARK, [0.019, 0.006, -0.04], [-90, 0, 0]),

  // Forward obstacle-avoidance cameras in the nose.
  kit("sensor_left", "Left vision sensor", "belly", "camera_lens", LENS, C(-0.022, 0.006, 0.1035), [-10, -6, 0], { radius: 0.0042 }),
  kit("sensor_right", "Right vision sensor", "belly", "camera_lens", LENS, C(0.022, 0.006, 0.1035), [-10, 6, 0], { radius: 0.0042 }),
  kit("rear_sensor_left", "Rear vision sensor", "belly", "camera_lens", LENS, C(-0.02, 0.006, -0.1118), [0, 180, 0], { radius: 0.0036 }),
  kit("rear_sensor_right", "Rear vision sensor", "belly", "camera_lens", LENS, C(0.02, 0.006, -0.1118), [0, 180, 0], { radius: 0.0036 }),

  ...[0, 1, 2].flatMap((i) => [vent(i, 1), vent(i, -1)]),

  ...ROTORS.map(arm),
  ...ROTORS.flatMap(rotor),
  ...gimbal,
];

export const drone: Template | null = {
  id: "drone",
  name: "Foldable 4K Camera Drone",
  keywords: ["drone", "quadcopter", "camera drone", "quadrocopter", "quad copter", "fpv drone", "mini drone", "racing drone"],
  category: "drone",
  description: "Foldable camera drone with a graphite body, four brushless rotors on folding arms, a 3-axis gimbal 4K camera, obstacle-sensing cameras, status LEDs and an intelligent flight battery",
  targetPriceUsd: 799,
  parts,
};
