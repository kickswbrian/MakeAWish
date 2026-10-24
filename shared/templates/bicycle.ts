import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: Dutch-style city bicycle, side view facing +Z (the drive side), front wheel toward +X.
 * Floor coordinates throughout: y = 0 is the ground, the bike's center plane is z = 0, and every
 * part hangs off the down tube (root, a tube whose points are already in floor coordinates).
 * 700c wheels: axles 1.06 m apart at y = 0.34, gum-wall tyres, polished box-section rims and
 * 18 tangent-laced spokes per side (each side is one closed zig-zag tube whose returns hide inside
 * the rim and the hub flange). Diamond frame with a 73 degree seat tube and 71 degree head tube,
 * swept-back bars, a sprung leather saddle, a 40T chainring driving a 16T cog, full fenders, a
 * wicker basket on a front rack, lights and a kickstand.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

const FRAME: PartMaterial = { preset: "plastic_gloss", color: "#2F5D50" };
const ALU: PartMaterial = { preset: "metal_polished", color: "#D6D9DE" };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#E6E8EB" };
const STEEL: PartMaterial = { preset: "metal_brushed", color: "#9EA3AA" };
const CHAIN: PartMaterial = { preset: "metal_brushed", color: "#45474B" };
const TYRE: PartMaterial = { preset: "rubber", color: "#1D1E20" };
const GUMWALL: PartMaterial = { preset: "rubber", color: "#B98A55" };
const LEATHER: PartMaterial = { preset: "leather", color: "#7B4A2D" };
const WICKER: PartMaterial = { preset: "knit", color: "#C9A26B" };
const BLACK: PartMaterial = { preset: "plastic_matte", color: "#1E1F22" };
const LAMP_GLASS: PartMaterial = { preset: "glass", color: "#FFF6DD", emissive: "#FFF1C9", emissiveIntensity: 1.6 };
const TAIL_RED: PartMaterial = { preset: "plastic_gloss", color: "#E0262E", emissive: "#FF2A2A", emissiveIntensity: 1.2 };

// ---------- Geometry (floor coordinates) ----------

const D = Math.PI / 180;
const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const at = (p: V2, z = 0): V3 => [p[0], p[1], z];

const RA: V2 = [-0.53, 0.34]; // rear axle
const FA: V2 = [0.53, 0.34]; // front axle
const BB: V2 = [-0.09, 0.27]; // bottom bracket
const ST_DIR: V2 = [-Math.cos(73 * D), Math.sin(73 * D)];
const HT_DIR: V2 = [-Math.cos(71 * D), Math.sin(71 * D)];
const HT_FWD: V2 = [HT_DIR[1], -HT_DIR[0]];
const HB = add(add(FA, HT_FWD, -0.045), HT_DIR, 0.39); // head tube bottom (fork crown)
const HT = add(HB, HT_DIR, 0.17); // head tube top
const ST_TOP = add(BB, ST_DIR, 0.53);
const ST_ROT = -Math.atan2(ST_DIR[0], ST_DIR[1]) / D; // rotation about Z that stands Y along the seat tube
const HT_ROT = -Math.atan2(HT_DIR[0], HT_DIR[1]) / D;

const WHEEL_R = 0.34;
const RIM_R = 0.307;

// ---------- Wheels ----------

const RIM_PROFILE: V2[] = [[0.2875, -0.006], [0.294, -0.0095], [0.3045, -0.0105], [0.307, -0.0088], [0.3075, 0], [0.307, 0.0088], [0.3045, 0.0105], [0.294, 0.0095], [0.2875, 0.006], [0.2865, 0], [0.2875, -0.006]];

function hubProfile(flangeR: number, barrelR: number, half: number): V2[] {
  return [
    [0.005, -half - 0.018], [0.0095, -half - 0.018], [0.0095, -half - 0.008], [barrelR, -half - 0.005], [flangeR, -half - 0.003], [flangeR + 0.0012, -half], [flangeR, -half + 0.003], [barrelR, -half + 0.005],
    [barrelR * 0.92, 0], [barrelR, half - 0.005], [flangeR, half - 0.003], [flangeR + 0.0012, half], [flangeR, half + 0.003], [barrelR, half + 0.005], [0.0095, half + 0.008], [0.0095, half + 0.018], [0.005, half + 0.018],
  ];
}

/**
 * One side's spokes as a closed zig-zag: spokes sorted by rim angle, alternating rim->hub, hub->hub
 * (a chord hidden in the flange), hub->rim, rim->rim (a short chord hidden inside the rim).
 */
function spokePath(hubR: number, flangeZ: number, offsetDeg: number): V3[] {
  const n = 18, rimR = 0.297;
  const spokes = Array.from({ length: n }, (_, k) => {
    const h = offsetDeg + k * 20;
    return { h, r: h + (k % 2 === 0 ? 40 : -40) };
  }).sort((a, b) => ((a.r % 360) + 360) % 360 - (((b.r % 360) + 360) % 360));
  const hubPt = (deg: number): V3 => [Math.cos(deg * D) * hubR, Math.sin(deg * D) * hubR, flangeZ];
  const rimPt = (deg: number): V3 => [Math.cos(deg * D) * rimR, Math.sin(deg * D) * rimR, 0];
  const out: V3[] = [];
  spokes.forEach((s, i) => {
    if (i % 2 === 0) out.push(rimPt(s.r), hubPt(s.h));
    else out.push(hubPt(s.h), rimPt(s.r));
  });
  return out.map(v);
}

function wheel(k: "front" | "rear", center: V2): Part[] {
  const L = k === "front" ? "Front" : "Rear";
  const tyre = `${k}_tyre`;
  const flangeR = k === "front" ? 0.027 : 0.04;
  const half = k === "front" ? 0.033 : 0.03;
  return [
    prim(tyre, `${L} tyre`, "down_tube", { type: "torus", params: { radius: WHEEL_R - 0.0185, tube: 0.0185, arc: 360 } }, GUMWALL, at(center)),
    prim(`${k}_tread`, `${L} tread`, tyre, { type: "torus", params: { radius: WHEEL_R - 0.0142, tube: 0.0145, arc: 360 } }, TYRE, [0, 0, 0], [0, 0, 0], [1, 1, 1.22]),
    prim(`${k}_rim`, `${L} rim`, tyre, { type: "lathe", params: { points: RIM_PROFILE, angle: 360, segments: 128, sharp: false } }, ALU, [0, 0, 0], [90, 0, 0]),
    prim(`${k}_hub`, `${L} hub`, tyre, { type: "lathe", params: { points: hubProfile(flangeR, k === "front" ? 0.016 : 0.031, half), angle: 360, segments: 64, sharp: false } }, ALU, [0, 0, 0], [90, 0, 0]),
    prim(`${k}_spokes_right`, `${L} spokes (right)`, tyre, { type: "tube", params: { points: spokePath(flangeR - 0.004, half, 0), radius: 0.0011, closed: true, sharp: true } }, STEEL),
    prim(`${k}_spokes_left`, `${L} spokes (left)`, tyre, { type: "tube", params: { points: spokePath(flangeR - 0.004, -half, 10), radius: 0.0011, closed: true, sharp: true } }, STEEL),
  ];
}

// ---------- Drivetrain ----------

/** Gear outline: rounded teeth around a pitch radius. */
function gear(teeth: number, rTip: number, rRoot: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    out.push([r4(Math.cos(a) * rTip), r4(Math.sin(a) * rTip)]);
    const b = ((i + 0.5) / teeth) * Math.PI * 2;
    out.push([r4(Math.cos(b) * rRoot), r4(Math.sin(b) * rRoot)]);
  }
  return out;
}

/** Spider windows in the chainring: five arc-shaped cut-outs between the arms. */
function ringWindows(): V2[][] {
  const out: V2[][] = [];
  for (let w = 0; w < 5; w++) {
    const a0 = w * 72 + 12, a1 = (w + 1) * 72 - 12;
    const outer: V2[] = [], inner: V2[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (a0 + ((a1 - a0) * i) / 6) * D;
      outer.push([r4(Math.cos(a) * 0.066), r4(Math.sin(a) * 0.066)]);
    }
    for (let i = 6; i >= 0; i--) {
      const a = (a0 + 6 + ((a1 - a0 - 12) * i) / 6) * D;
      inner.push([r4(Math.cos(a) * 0.036), r4(Math.sin(a) * 0.036)]);
    }
    out.push([...outer, ...inner]);
  }
  return out;
}

const CHAIN_Z = 0.05;
const RING_R = 0.0805; // chain line around the ring
const COG_R = 0.0335;

/** Closed chain loop: big wrap around the chainring, small wrap around the cog, straight runs. */
function chainPath(): V3[] {
  const dx = RA[0] - BB[0], dy = RA[1] - BB[1];
  const d = Math.hypot(dx, dy);
  const alpha = Math.atan2(dy, dx);
  const beta = Math.acos((RING_R - COG_R) / d);
  const pts: V3[] = [];
  // Around the cog's far side, from alpha + beta down to alpha - beta.
  for (let i = 0; i <= 10; i++) {
    const a = alpha + beta - (2 * beta * i) / 10;
    pts.push([RA[0] + Math.cos(a) * COG_R, RA[1] + Math.sin(a) * COG_R, CHAIN_Z]);
  }
  // Around the chainring's far side, from alpha - beta on to alpha + beta - 2 pi.
  for (let i = 0; i <= 20; i++) {
    const a = alpha - beta - ((2 * Math.PI - 2 * beta) * i) / 20;
    pts.push([BB[0] + Math.cos(a) * RING_R, BB[1] + Math.sin(a) * RING_R, CHAIN_Z]);
  }
  return pts.map(v);
}

const CRANK = 0.17;
const CRANK_DEG = -38; // right crank, from +X

function crank(side: 1 | -1): Part[] {
  const k = side > 0 ? "right" : "left";
  const L = side > 0 ? "Right" : "Left";
  const deg = side > 0 ? CRANK_DEG : CRANK_DEG + 180;
  const end = add(BB, [Math.cos(deg * D), Math.sin(deg * D)], CRANK);
  const mid = add(BB, [Math.cos(deg * D), Math.sin(deg * D)], CRANK / 2);
  const z = side * 0.064;
  return [
    prim(`crank_${k}`, `${L} crank arm`, "down_tube", { type: "roundedBox", params: { width: CRANK + 0.03, height: 0.024, depth: 0.012, radius: 0.0055 } }, ALU, at(mid, z), [0, 0, deg]),
    prim(`pedal_spindle_${k}`, `${L} pedal spindle`, "down_tube", { type: "cylinder", params: { radiusTop: 0.0055, radiusBottom: 0.0055, height: 0.03, bevel: 0.001, open: false } }, STEEL, at(end, z + side * 0.018), [90, 0, 0]),
    prim(`pedal_${k}`, `${L} pedal`, "down_tube", { type: "roundedBox", params: { width: 0.095, height: 0.022, depth: 0.075, radius: 0.007 } }, BLACK, at(end, z + side * 0.07)),
    prim(`pedal_reflector_${k}`, `${L} pedal reflector`, `pedal_${k}`, { type: "roundedBox", params: { width: 0.004, height: 0.012, depth: 0.04, radius: 0.0015 } }, { preset: "plastic_gloss", color: "#F2A21C" }, [0.0475, 0, 0]),
  ];
}

// ---------- Fenders ----------

const FENDER_PROFILE: V2[] = [[0.362, -0.026], [0.37, -0.02], [0.3745, 0], [0.37, 0.02], [0.362, 0.026], [0.3595, 0.0235], [0.367, 0.0175], [0.3712, 0], [0.367, -0.0175], [0.3595, -0.0235], [0.362, -0.026]];

/** Point on a circle around a wheel, by the lathe's sweep angle u (0 = straight down, 90 = forward). */
const around = (c: V2, r: number, u: number, z = 0): V3 => [c[0] + Math.sin(u * D) * r, c[1] - Math.cos(u * D) * r, z];

function fender(k: "front" | "rear", c: V2, start: number, sweep: number, stayAt: number): Part[] {
  const L = k === "front" ? "Front" : "Rear";
  const stay: V3[] = [[c[0], c[1], -0.058], around(c, 0.366, stayAt, -0.03), around(c, 0.3775, stayAt, -0.016), around(c, 0.379, stayAt, 0), around(c, 0.3775, stayAt, 0.016), around(c, 0.366, stayAt, 0.03), [c[0], c[1], 0.058]];
  return [
    prim(`${k}_fender`, `${L} fender`, "down_tube", { type: "lathe", params: { points: FENDER_PROFILE, angle: sweep, segments: 96, sharp: false } }, FRAME, at(c), [90, start, 0]),
    prim(`${k}_fender_stay`, `${L} fender stay`, "down_tube", { type: "tube", params: { points: stay.map(v), radius: 0.0022, closed: false, sharp: false } }, STEEL),
  ];
}

// ---------- Cockpit ----------

const STEM_TOP = add(HT, HT_DIR, 0.06);
const BAR: V2 = [HT[0] + 0.05, HT[1] + 0.095]; // handlebar clamp
const BAR_PTS: V3[] = (() => {
  const half: V3[] = [[BAR[0] - 0.175, BAR[1] + 0.02, 0.285], [BAR[0] - 0.07, BAR[1] + 0.018, 0.282], [BAR[0] - 0.012, BAR[1] + 0.009, 0.215], [BAR[0], BAR[1] + 0.002, 0.11], [BAR[0], BAR[1], 0.0]];
  return [...half, ...half.slice(0, -1).reverse().map(([x, y, z]): V3 => [x, y, -z])];
})();

// ---------- Saddle ----------

const SADDLE_C: V2 = [-0.285, 0.958];
const SADDLE_OUTLINE: V2[] = (() => {
  // Top view (x forward, z across): narrow nose, wide sprung cantle.
  const right: V2[] = [[0.135, 0.022], [0.1, 0.034], [0.05, 0.045], [0.0, 0.07], [-0.05, 0.1], [-0.095, 0.112], [-0.125, 0.1]];
  const left = right.map(([x, z]): V2 => [x, -z]);
  return [[0.148, 0], ...left, [-0.138, 0], ...right.slice().reverse()].map(([x, z]): V2 => [r4(x), r4(z)]);
})();

function spring(z: number): V3[] {
  const pts: V3[] = [];
  const turns = 6, n = turns * 12;
  for (let i = 0; i <= n; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([SADDLE_C[0] - 0.085 + Math.cos(a) * 0.0115, 0.885 + (0.05 * i) / n, z + Math.sin(a) * 0.0115]);
  }
  return pts.map(v);
}

// ---------- Basket ----------

const BASKET: V3 = [0.6, 0.762, 0];
const BASKET_PROFILE: V2[] = [[0, 0], [0.128, 0], [0.138, 0.008], [0.152, 0.19], [0.146, 0.19], [0.133, 0.014], [0, 0.009]];

// ---------- Assembly ----------

const tube = (id: string, name: string, pts: V3[], radius: number, material: PartMaterial = FRAME): Part =>
  prim(id, name, "down_tube", { type: "tube", params: { points: pts.map(v), radius, closed: false, sharp: false } }, material);

const parts: Part[] = [
  // Main triangle.
  prim("down_tube", "Down tube", null, { type: "tube", params: { points: [at(add(BB, [0.012, -0.004])), at(add(HB, HT_DIR, 0.035))].map(v), radius: 0.0175, closed: false, sharp: false } }, FRAME),
  tube("top_tube", "Top tube", [at(add(BB, ST_DIR, 0.49)), at(add(HT, HT_DIR, -0.03))], 0.0145),
  tube("seat_tube", "Seat tube", [at(add(BB, ST_DIR, -0.01)), at(ST_TOP)], 0.0148),
  prim("head_tube", "Head tube", "down_tube", { type: "cylinder", params: { radiusTop: 0.0195, radiusBottom: 0.0205, height: 0.17, bevel: 0.003, open: false } }, FRAME, at(add(HB, HT_DIR, 0.085)), [0, 0, HT_ROT]),
  prim("headset_top", "Headset top cup", "down_tube", { type: "cylinder", params: { radiusTop: 0.019, radiusBottom: 0.0215, height: 0.012, bevel: 0.002, open: false } }, CHROME, at(add(HT, HT_DIR, 0.006)), [0, 0, HT_ROT]),
  prim("headset_bottom", "Headset bottom cup", "down_tube", { type: "cylinder", params: { radiusTop: 0.0215, radiusBottom: 0.0215, height: 0.01, bevel: 0.002, open: false } }, CHROME, at(add(HB, HT_DIR, -0.005)), [0, 0, HT_ROT]),
  prim("bb_shell", "Bottom bracket shell", "down_tube", { type: "cylinder", params: { radiusTop: 0.021, radiusBottom: 0.021, height: 0.072, bevel: 0.003, open: false } }, FRAME, at(BB), [90, 0, 0]),

  // Rear triangle: seat stays and chain stays, each one bent tube from dropout to dropout.
  tube("seat_stays", "Seat stays", [at(RA, -0.062), at(add(RA, [0.15, 0.17]), -0.045), at(add(BB, ST_DIR, 0.47), -0.012), at(add(BB, ST_DIR, 0.5), 0), at(add(BB, ST_DIR, 0.47), 0.012), at(add(RA, [0.15, 0.17]), 0.045), at(RA, 0.062)], 0.0078),
  tube("chain_stays", "Chain stays", [at(RA, -0.064), at(add(RA, [0.14, -0.012]), -0.058), at(add(BB, [-0.05, 0.004]), -0.03), at(BB, -0.018), at(BB, 0.018), at(add(BB, [-0.05, 0.004]), 0.03), at(add(RA, [0.14, -0.012]), 0.058), at(RA, 0.064)], 0.0092),
  prim("dropout_right", "Right dropout", "down_tube", { type: "roundedBox", params: { width: 0.045, height: 0.032, depth: 0.006, radius: 0.0025 } }, FRAME, [RA[0] + 0.012, RA[1] + 0.006, 0.064], [0, 0, 18]),
  prim("dropout_left", "Left dropout", "down_tube", { type: "roundedBox", params: { width: 0.045, height: 0.032, depth: 0.006, radius: 0.0025 } }, FRAME, [RA[0] + 0.012, RA[1] + 0.006, -0.064], [0, 0, 18]),

  // Fork: crown and one bent tube for both blades, raked forward to the axle.
  prim("fork_crown", "Fork crown", "down_tube", { type: "roundedBox", params: { width: 0.036, height: 0.024, depth: 0.118, radius: 0.009 } }, CHROME, at(add(HB, HT_DIR, -0.022)), [0, 0, HT_ROT]),
  tube("fork", "Fork", [at(FA, -0.052), at(add(add(HB, HT_DIR, -0.33), HT_FWD, 0.03), -0.05), at(add(HB, HT_DIR, -0.2), -0.049), at(add(HB, HT_DIR, -0.03), -0.046), at(add(HB, HT_DIR, -0.03), 0.046), at(add(HB, HT_DIR, -0.2), 0.049), at(add(add(HB, HT_DIR, -0.33), HT_FWD, 0.03), 0.05), at(FA, 0.052)], 0.0105),

  // Cockpit: stem, swept-back city bar, leather grips, bell.
  tube("stem", "Stem", [at(add(HT, HT_DIR, -0.01)), at(STEM_TOP), at(add(BAR, [-0.012, 0.0]))], 0.0128, CHROME),
  prim("bar_clamp", "Handlebar clamp", "down_tube", { type: "cylinder", params: { radiusTop: 0.0155, radiusBottom: 0.0155, height: 0.04, bevel: 0.003, open: false } }, CHROME, at(BAR), [90, 0, 0]),
  tube("handlebar", "Handlebar", BAR_PTS, 0.0112, CHROME),
  prim("grip_right", "Right grip", "down_tube", { type: "capsule", params: { radius: 0.0165, length: 0.085 } }, LEATHER, [BAR[0] - 0.13, BAR[1] + 0.019, 0.2845], [0, 0, 90]),
  prim("grip_left", "Left grip", "down_tube", { type: "capsule", params: { radius: 0.0165, length: 0.085 } }, LEATHER, [BAR[0] - 0.13, BAR[1] + 0.019, -0.2845], [0, 0, 90]),
  prim("bell", "Bell", "down_tube", { type: "sphere", params: { radius: 0.024, angle: 90 } }, CHROME, [BAR[0] - 0.02, BAR[1] + 0.016, -0.2]),

  // Seatpost, clamp, and a sprung leather saddle.
  prim("seatpost", "Seatpost", "down_tube", { type: "cylinder", params: { radiusTop: 0.0136, radiusBottom: 0.0136, height: 0.22, bevel: 0.002, open: false } }, CHROME, at(add(ST_TOP, ST_DIR, 0.03)), [0, 0, ST_ROT]),
  prim("seat_clamp", "Seat clamp", "down_tube", { type: "cylinder", params: { radiusTop: 0.0185, radiusBottom: 0.0185, height: 0.022, bevel: 0.003, open: false } }, CHROME, at(add(ST_TOP, ST_DIR, -0.008)), [0, 0, ST_ROT]),
  prim("saddle", "Saddle", "down_tube", { type: "extrude", params: { shape: SADDLE_OUTLINE, depth: 0.05, bevel: 0.02, smooth: true } }, LEATHER, at(SADDLE_C), [90, 0, 0]),
  tube("saddle_rails", "Saddle rails", [[SADDLE_C[0] - 0.085, 0.885, -0.042], [SADDLE_C[0] - 0.03, 0.9, -0.03], [SADDLE_C[0] + 0.06, 0.922, -0.016], [SADDLE_C[0] + 0.115, 0.932, 0], [SADDLE_C[0] + 0.06, 0.922, 0.016], [SADDLE_C[0] - 0.03, 0.9, 0.03], [SADDLE_C[0] - 0.085, 0.885, 0.042]], 0.0036, CHROME),
  prim("saddle_rail_clamp", "Saddle rail clamp", "down_tube", { type: "roundedBox", params: { width: 0.04, height: 0.02, depth: 0.05, radius: 0.005 } }, CHROME, [add(ST_TOP, ST_DIR, 0.135)[0], add(ST_TOP, ST_DIR, 0.135)[1], 0]),
  prim("saddle_spring_right", "Saddle spring", "down_tube", { type: "tube", params: { points: spring(0.042), radius: 0.0022, closed: false, sharp: false } }, CHROME),
  prim("saddle_spring_left", "Saddle spring", "down_tube", { type: "tube", params: { points: spring(-0.042), radius: 0.0022, closed: false, sharp: false } }, CHROME),

  // Wheels.
  ...wheel("front", FA),
  ...wheel("rear", RA),

  // Drivetrain: chainring with spider windows, cog, chain, cranks and pedals.
  prim("chainring", "Chainring", "down_tube", { type: "extrude", params: { shape: gear(40, 0.0855, 0.0805), holes: ringWindows(), depth: 0.004, bevel: 0.0008, smooth: false } }, ALU, at(BB, CHAIN_Z)),
  prim("crank_bolt", "Crank bolt", "down_tube", { type: "cylinder", params: { radiusTop: 0.012, radiusBottom: 0.013, height: 0.008, bevel: 0.002, open: false } }, ALU, at(BB, 0.072), [90, 0, 0]),
  prim("cog", "Rear cog", "down_tube", { type: "extrude", params: { shape: gear(16, 0.0375, 0.0335), depth: 0.004, bevel: 0.0006, smooth: false } }, STEEL, at(RA, CHAIN_Z)),
  prim("chain", "Chain", "down_tube", { type: "tube", params: { points: chainPath(), radius: 0.0038, closed: true, sharp: true } }, CHAIN),
  ...crank(1),
  ...crank(-1),

  // Fenders.
  ...fender("front", FA, 52, 182, 80),
  ...fender("rear", RA, 108, 168, 252),

  // Front rack and wicker basket.
  prim("rack_platform", "Front rack platform", "down_tube", { type: "roundedBox", params: { width: 0.24, height: 0.008, depth: 0.15, radius: 0.003 } }, BLACK, [BASKET[0], BASKET[1] - 0.004, 0]),
  tube("rack_struts", "Front rack struts", [[FA[0], FA[1], -0.06], [BASKET[0] + 0.06, BASKET[1] - 0.008, -0.062], [BASKET[0] + 0.07, BASKET[1] - 0.008, 0], [BASKET[0] + 0.06, BASKET[1] - 0.008, 0.062], [FA[0], FA[1], 0.06]], 0.0045, BLACK),
  tube("rack_brace", "Front rack brace", [[BASKET[0] - 0.11, BASKET[1] - 0.008, 0], [add(HB, HT_DIR, 0.06)[0] + 0.01, add(HB, HT_DIR, 0.06)[1], 0]], 0.005, BLACK),
  prim("basket", "Wicker basket", "down_tube", { type: "lathe", params: { points: BASKET_PROFILE, angle: 360, segments: 128, sharp: true, flutes: 44, fluteDepth: 0.025, fluteFade: "even" } }, WICKER, BASKET),
  prim("basket_rim", "Basket rim", "basket", { type: "torus", params: { radius: 0.15, tube: 0.008, arc: 360 } }, WICKER, [0, 0.19, 0], [90, 0, 0]),

  // Lights and kickstand.
  prim("headlight", "Headlight", "down_tube", { type: "cylinder", params: { radiusTop: 0.024, radiusBottom: 0.02, height: 0.045, bevel: 0.004, open: false } }, CHROME, [BASKET[0] + 0.14, BASKET[1] - 0.03, 0], [0, 0, -90]),
  prim("headlight_lens", "Headlight lens", "headlight", { type: "sphere", params: { radius: 0.021, angle: 70 } }, LAMP_GLASS, [0, 0.016, 0]),
  prim("taillight", "Rear light", "down_tube", { type: "roundedBox", params: { width: 0.012, height: 0.03, depth: 0.04, radius: 0.004 } }, TAIL_RED, around(RA, 0.378, 248), [0, 0, -28]),
  tube("kickstand", "Kickstand", [at(add(RA, [0.17, -0.02]), -0.06), at(add(RA, [0.12, -0.12]), -0.09), [RA[0] + 0.06, 0.012, -0.16]], 0.007, BLACK),
];

export const bicycle: Template | null = {
  id: "bicycle",
  name: "Classic City Bicycle",
  keywords: ["bicycle", "bike", "city bike", "commuter bike", "e bike", "ebike", "electric bike", "road bike", "cruiser bike", "dutch bike", "push bike"],
  category: "bicycle",
  description: "Dutch-style city bicycle with a forest green steel frame, gum-wall 700c tyres, swept-back bars, a sprung leather saddle, full fenders, a wicker front basket, lights and a kickstand",
  targetPriceUsd: 649,
  parts,
};
