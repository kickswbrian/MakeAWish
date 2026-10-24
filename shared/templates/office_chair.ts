import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: ergonomic mesh office chair, facing +Z.
 * The seat cushion (root) is a side-profile extrusion with a waterfall front edge; its origin is
 * the seat center, SY = 0.49 m above the floor, turned -90 degrees about Y so the profile runs front
 * to back. Its child "seat_shell" turns back to a floor-aligned frame and carries everything else
 * (positions via S(), in floor coordinates); base parts hang off the hub, whose frame is the floor. The mesh backrest is a shallow lathe
 * segment wrapped around an axis 0.55 m in front of it, so it curves around the sitter, reclines
 * with height and bulges forward at the lumbar; its frame, lumbar bar and knobs live in that frame.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

const FABRIC: PartMaterial = { preset: "knit", color: "#5B616B" };
const FRAME: PartMaterial = { preset: "plastic_matte", color: "#1D1E21" };
const ALU: PartMaterial = { preset: "metal_polished", color: "#D9DCE1" };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#E8EAED" };
const PAD: PartMaterial = { preset: "rubber", color: "#26272B" };

const SY = 0.49; // seat center height
const SHELL_Y = SY - 0.046;
/** Floor coordinates -> the seat shell's floor-aligned frame. */
const S = (x: number, y: number, z: number): V3 => [x, y - SHELL_Y, z];

// ---------- Seat ----------

/** Side profile of the cushion in (z, y) around the seat center: contoured top, waterfall front. */
const SEAT_PROFILE: V2[] = [
  [-0.236, -0.035], [-0.1, -0.036], [0.08, -0.036], [0.205, -0.034], [0.236, -0.02], [0.247, 0.004], [0.24, 0.026],
  [0.215, 0.038], [0.15, 0.032], [0.05, 0.027], [-0.08, 0.03], [-0.19, 0.04], [-0.232, 0.038], [-0.247, 0.014], [-0.246, -0.016],
];

// ---------- Base ----------

const ARM_PROFILE: V2[] = [[0.03, 0.092], [0.29, 0.085], [0.31, 0.089], [0.316, 0.1], [0.3, 0.108], [0.16, 0.121], [0.03, 0.142]];
const CASTER_SCALE = 1.15;

function baseArm(id: string, label: string, deg: number): Part[] {
  return [
    prim(`arm_${id}`, `${label} base arm`, "hub", { type: "extrude", params: { shape: ARM_PROFILE, depth: 0.05, bevel: 0.009, smooth: false } }, ALU, [0, 0, 0], [0, deg, 0]),
    prim(`socket_${id}`, `${label} caster socket`, `arm_${id}`, { type: "roundedBox", params: { width: 0.064, height: 0.028, depth: 0.064, radius: 0.012 } }, ALU, [0.305, 0.091, 0]),
    kit(`caster_${id}`, `${label} caster`, `socket_${id}`, "wheel_caster", FRAME, [0, -0.008, 0], [0, 0, 0], [CASTER_SCALE, CASTER_SCALE, CASTER_SCALE]),
  ];
}

// ---------- Backrest ----------

const R = 0.55; // wrap radius
const A = 48; // wrap angle, degrees
const AR = (A * Math.PI) / 180;
const BH = 0.52; // backrest height
const YB = 0.6; // backrest bottom (floor frame)
const ZA = 0.27; // wrap axis z (floor frame)
const T = 0.006; // mesh thickness
/** Front (sitter-side) radius of the mesh at local height y: reclines, bulges at the lumbar, curls back at the top. */
const rf = (y: number) => R + 0.13 * y - 0.022 * Math.exp(-(((y - 0.13) / 0.09) ** 2)) + 0.25 * Math.max(0, y - 0.36) ** 2;

// The mesh stops just inside the frame's centerline so its edges tuck in behind the frame.
const INSET_Y = 0.008;
const INSET_DEG = (0.007 / R) * (180 / Math.PI);
const INSET_T = (INSET_DEG * Math.PI) / 180;

function meshProfile(): V2[] {
  const n = 22;
  const ys = Array.from({ length: n + 1 }, (_, i) => INSET_Y + ((BH - 2 * INSET_Y) * i) / n);
  const back = ys.map((y): V2 => [r4(rf(y) + T), r4(y)]);
  const front = ys.map((y): V2 => [r4(rf(y)), r4(y)]).reverse();
  return [[r4(rf(INSET_Y)), INSET_Y], ...back, ...front];
}

/** Closed rounded rectangle traced on the mesh mid-surface, in the backrest's frame. */
function framePath(): V3[] {
  const hs = (AR / 2) * R;
  const y0 = 0, y1 = BH, rc = 0.035;
  const pts: V2[] = [];
  const line = (a: V2, b: V2, n: number) => {
    for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < 5; i++) {
      const a = ((a0 + (90 * i) / 5) * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * rc, cy + Math.sin(a) * rc]);
    }
  };
  line([hs, y0 + rc], [hs, y1 - rc], 7);
  arc(hs - rc, y1 - rc, 0);
  line([hs - rc, y1], [-(hs - rc), y1], 7);
  arc(-(hs - rc), y1 - rc, 90);
  line([-hs, y1 - rc], [-hs, y0 + rc], 7);
  arc(-(hs - rc), y0 + rc, 180);
  line([-(hs - rc), y0], [hs - rc, y0], 7);
  arc(hs - rc, y0 + rc, 270);
  return pts.map(([s, y]) => {
    const t = AR / 2 + s / R - INSET_T;
    // Sits on the sitter side of the mesh, its back touching the mesh face (the mesh wraps into it).
    const r = rf(y) - 0.0122;
    return v([Math.sin(t) * r, y, Math.cos(t) * r]);
  });
}

// Lumbar bar: a slim band behind the mesh that pokes out past both sides of the frame.
const LUM_Y0 = 0.14, LUM_H = 0.036, LUM_EXT = 2.4; // degrees past each side
function lumbarProfile(): V2[] {
  const n = 6;
  const ys = Array.from({ length: n + 1 }, (_, i) => LUM_Y0 + (LUM_H * i) / n);
  const inner = (y: number) => rf(y) + T + 0.0015;
  const back = ys.map((y): V2 => [r4(inner(y) + 0.012), r4(y)]);
  const front = ys.map((y): V2 => [r4(inner(y)), r4(y)]).reverse();
  return [[r4(inner(LUM_Y0)), LUM_Y0], ...back, ...front];
}
const LUM_ANGLE = A + 2 * LUM_EXT;
const LUM_R = rf(LUM_Y0 + LUM_H / 2) + T + 0.0075;
const lumEnd = (LUM_ANGLE * Math.PI) / 180;

// Back mount: where the spine bolts to the back of the mesh.
const MOUNT_Y = 0.06;
const zBack = (y: number) => ZA - (rf(y) + T);
const MOUNT_H = 0.11;
// Flush with the furthest-back point of the mesh it covers (the lumbar bulge makes the back uneven).
const MOUNT_Z = Math.min(...Array.from({ length: 12 }, (_, i) => zBack(MOUNT_Y - MOUNT_H / 2 + (MOUNT_H * i) / 11))) - 0.011 + 0.002;

// ---------- Armrests ----------

function armrest(sx: 1 | -1, k: "l" | "r", L: "Left" | "Right"): Part[] {
  const path: V3[] = [S(sx * 0.1, 0.426, -0.03), S(sx * 0.2, 0.426, -0.03), S(sx * 0.25, 0.43, -0.031), S(sx * 0.268, 0.455, -0.034), S(sx * 0.272, 0.5, -0.038), S(sx * 0.272, 0.6, -0.045)];
  return [
    prim(`arm_bracket_${k}`, `${L} armrest bracket`, "seat_shell", { type: "tube", params: { points: path.map(v), radius: 0.008, width: 0.048, faceNormal: [sx, 1, 0], closed: false, sharp: false } }, FRAME),
    prim(`arm_post_${k}`, `${L} armrest post`, "seat_shell", { type: "roundedBox", params: { width: 0.034, height: 0.14, depth: 0.062, radius: 0.012 } }, FRAME, S(sx * 0.272, 0.622, -0.045)),
    prim(`arm_button_${k}`, `${L} armrest button`, `arm_post_${k}`, { type: "roundedBox", params: { width: 0.016, height: 0.026, depth: 0.008, radius: 0.0035 } }, ALU, [0, 0.035, 0.031]),
    prim(`arm_pad_${k}`, `${L} armrest pad`, "seat_shell", { type: "roundedBox", params: { width: 0.088, height: 0.03, depth: 0.26, radius: 0.0135 } }, PAD, S(sx * 0.275, 0.704, -0.02)),
  ];
}

// ---------- Assembly ----------

const SPINE: V3[] = [S(0, 0.41, -0.07), S(0, 0.405, -0.17), S(0, 0.415, -0.26), S(0, 0.45, -0.307), S(0, 0.53, -0.322), S(0, 0.6, -0.316), S(0, YB + 0.045, MOUNT_Z - 0.003)];

const lumKnob = (id: string, name: string, t: number, deg: number): Part => {
  const y = LUM_Y0 + LUM_H / 2;
  return kit(id, name, "lumbar_bar", "knob", FRAME, [Math.sin(t) * LUM_R, y, Math.cos(t) * LUM_R], [0, deg, 0], [1, 1, 1], { radius: 0.019 });
};

const parts: Part[] = [
  // Root: the cushion's side profile (z, y) extruded across the width; rotated so the profile runs front to back.
  prim("seat", "Seat", null, { type: "extrude", params: { shape: SEAT_PROFILE, depth: 0.5, bevel: 0.02, smooth: true } }, FABRIC, [0, SY, 0], [0, -90, 0]),
  // The shell turns back to the floor-aligned frame; every other part hangs off it (offset by SHELL_Y).
  prim("seat_shell", "Seat shell", "seat", { type: "roundedBox", params: { width: 0.46, height: 0.024, depth: 0.44, radius: 0.01 } }, FRAME, [0, SHELL_Y - SY, 0], [0, 90, 0]),

  // Tilt mechanism and controls under the seat.
  prim("mechanism", "Tilt mechanism", "seat_shell", { type: "roundedBox", params: { width: 0.2, height: 0.05, depth: 0.25, radius: 0.014 } }, FRAME, S(0, 0.41, -0.01)),
  kit("tension_knob", "Tension knob", "mechanism", "knob", FRAME, [0, -0.025, 0.085], [90, 0, 0], [1, 1, 1], { radius: 0.022 }),
  prim("height_lever", "Height lever", "seat_shell", { type: "tube", params: { points: [S(0.09, 0.405, 0.04), S(0.15, 0.404, 0.05), S(0.2, 0.401, 0.07)].map(v), radius: 0.0045, closed: false, sharp: false } }, ALU),
  prim("height_lever_grip", "Height lever grip", "seat_shell", { type: "capsule", params: { radius: 0.0085, length: 0.035 } }, FRAME, S(0.215, 0.4, 0.078), [0, -20, 90]),
  prim("tilt_lever", "Tilt lock lever", "seat_shell", { type: "tube", params: { points: [S(-0.09, 0.405, 0.0), S(-0.15, 0.404, 0.01), S(-0.2, 0.401, 0.03)].map(v), radius: 0.0045, closed: false, sharp: false } }, ALU),
  prim("tilt_lever_grip", "Tilt lever grip", "seat_shell", { type: "capsule", params: { radius: 0.0085, length: 0.035 } }, FRAME, S(-0.215, 0.4, 0.038), [0, 20, 90]),

  // Gas lift: polished cylinder in a two-stage telescoping cover.
  prim("gas_cylinder", "Gas cylinder", "seat_shell", { type: "cylinder", params: { radiusTop: 0.024, radiusBottom: 0.024, height: 0.26, bevel: 0.003, open: false } }, CHROME, S(0, 0.26, 0)),
  prim("cylinder_cover_upper", "Upper cylinder cover", "seat_shell", { type: "cylinder", params: { radiusTop: 0.0285, radiusBottom: 0.0295, height: 0.09, bevel: 0.003, open: false } }, FRAME, S(0, 0.29, 0)),
  prim("cylinder_cover_lower", "Lower cylinder cover", "seat_shell", { type: "cylinder", params: { radiusTop: 0.033, radiusBottom: 0.0345, height: 0.11, bevel: 0.004, open: false } }, FRAME, S(0, 0.195, 0)),

  // Five-star base: the hub's frame is the floor frame.
  prim("hub", "Base hub", "seat_shell", { type: "lathe", params: { points: [[0, 0.088], [0.046, 0.088], [0.05, 0.095], [0.05, 0.128], [0.045, 0.143], [0.036, 0.15], [0, 0.15]], angle: 360, segments: 96, sharp: false } }, ALU, S(0, 0, 0)),
  ...baseArm("front", "Front", -90),
  ...baseArm("right", "Right", -18),
  ...baseArm("back_right", "Back right", 54),
  ...baseArm("back_left", "Back left", 126),
  ...baseArm("left", "Left", 198),

  // Spine: a flat bar from the mechanism, around behind the seat, up to the backrest mount.
  prim("spine", "Backrest spine", "seat_shell", { type: "tube", params: { points: SPINE.map(v), radius: 0.011, width: 0.066, faceNormal: [0, 1, 1], closed: false, sharp: false } }, FRAME),
  prim("back_mount", "Backrest mount", "seat_shell", { type: "roundedBox", params: { width: 0.13, height: MOUNT_H, depth: 0.022, radius: 0.009 } }, FRAME, S(0, YB + MOUNT_Y, MOUNT_Z)),

  // Mesh backrest wrapped around the sitter, with its frame, lumbar bar and lumbar knobs.
  prim("backrest", "Backrest", "seat_shell", { type: "lathe", params: { points: meshProfile(), angle: A - 2 * INSET_DEG, segments: 64, sharp: true } }, FABRIC, S(0, YB, ZA), [0, 180 - A / 2 + INSET_DEG, 0]),
  prim("back_frame", "Backrest frame", "backrest", { type: "tube", params: { points: framePath(), radius: 0.012, closed: true, sharp: false } }, FRAME),
  prim("lumbar_bar", "Lumbar support", "backrest", { type: "lathe", params: { points: lumbarProfile(), angle: LUM_ANGLE, segments: 64, sharp: true } }, FRAME, [0, 0, 0], [0, -LUM_EXT - INSET_DEG, 0]),
  lumKnob("lumbar_knob_r", "Right lumbar knob", 0, -90),
  lumKnob("lumbar_knob_l", "Left lumbar knob", lumEnd, 90 + LUM_ANGLE),

  ...armrest(-1, "l", "Left"),
  ...armrest(1, "r", "Right"),
];

export const officeChair: Template | null = {
  id: "office_chair",
  name: "Ergonomic Mesh Office Chair",
  keywords: ["office chair", "chair", "desk chair", "gaming chair", "task chair", "computer chair", "swivel chair", "ergonomic chair"],
  category: "office chair",
  description: "Ergonomic office chair with a wraparound mesh backrest, adjustable lumbar support, contoured knit seat, padded armrests and a polished five-star base on casters",
  targetPriceUsd: 349,
  parts,
};
