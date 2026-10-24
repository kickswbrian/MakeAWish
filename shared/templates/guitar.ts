import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: dreadnought acoustic guitar standing upright, soundboard facing +Z, ~1.05 m tall.
 * The soundboard (root) is the body outline extruded 4 mm thick, centered on the origin, so its
 * front face is at z = ZF and the body's bottom edge at y = 0. The mahogany rim and back sit behind
 * it. The neck meets the body at y = 0.505 and the nut sits at y = NUT (650 mm scale: the saddle is
 * at NUT - 0.65). The headstock tilts back 14 degrees about the nut; `hs()` maps headstock-frame
 * points into the soundboard frame so the strings can run onto the tuner posts.
 * Frets and strings are each one tube whose connecting runs hide inside the fretboard, headstock
 * and bridge. Bass strings are on the viewer's left (-X).
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const D2R = Math.PI / 180;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale }, material: { ...material } };
}

const SPRUCE: PartMaterial = { preset: "wood", color: "#D8AE74", roughness: 0.32 };
const MAHOGANY: PartMaterial = { preset: "wood", color: "#7A3F22", roughness: 0.35 };
const ROSEWOOD: PartMaterial = { preset: "wood", color: "#34211A", roughness: 0.5 };
const IVORY: PartMaterial = { preset: "plastic_gloss", color: "#F0E7D3" };
const TORT: PartMaterial = { preset: "plastic_gloss", color: "#4A2313", roughness: 0.2 };
const PEARL: PartMaterial = { preset: "plastic_gloss", color: "#F4F1EA", roughness: 0.15 };
const CHROME: PartMaterial = { preset: "metal_polished", color: "#DDE0E4" };
const NICKEL: PartMaterial = { preset: "metal_polished", color: "#CFCBC2" };
const BRONZE: PartMaterial = { preset: "metal_polished", color: "#D4BF97" };
const HOLE: PartMaterial = { preset: "plastic_matte", color: "#120C08" };
const BLACK: PartMaterial = { preset: "plastic_gloss", color: "#151517" };

// ---------- Body ----------

/** Right half of the dreadnought outline, bottom center to top center. */
const HALF: V2[] = [
  [0.07, 0.004], [0.13, 0.02], [0.172, 0.05], [0.193, 0.09], [0.197, 0.13], [0.19, 0.175], [0.172, 0.215], [0.149, 0.252],
  [0.135, 0.285], [0.137, 0.316], [0.147, 0.352], [0.152, 0.39], [0.148, 0.43], [0.134, 0.465], [0.105, 0.491], [0.06, 0.503],
];
const OUTLINE: V2[] = [[0, 0], ...HALF, [0, 0.506], ...[...HALF].reverse().map(([x, y]): V2 => [-x, y])];

const TOP_T = 0.004;
const ZF = TOP_T / 2; // soundboard face
const BODY_D = 0.1;
const BODY_Z = ZF - TOP_T + 0.001 - BODY_D / 2;
const BACK_Z = BODY_Z - BODY_D / 2;

const HOLE_C: V2 = [0, 0.36];
const HOLE_R = 0.049;

/** Teardrop pickguard hugging the rosette on the treble side, in soundhole-centered coordinates. */
function pickguard(): V2[] {
  const rin = 0.0695;
  const a0 = -98, a1 = 30; // round end below the hole, pointed tip at its upper right
  const inner: V2[] = [];
  const outer: V2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 at the round end, 1 at the tip
    const a = (a0 + (a1 - a0) * t) * D2R;
    const w = t < 0.3 ? 0.062 * Math.sqrt(Math.max(0, 1 - ((t - 0.3) / 0.3) ** 2)) : 0.062 * (1 - (t - 0.3) / 0.7) ** 0.85;
    inner.push([r4(Math.cos(a) * rin), r4(Math.sin(a) * rin)]);
    outer.push([r4(Math.cos(a) * (rin + w)), r4(Math.sin(a) * (rin + w))]);
  }
  return [...inner.reverse(), ...outer.slice(1, -1)];
}

// ---------- Neck ----------

const NUT = 0.865;
const SCALE = 0.65;
const SADDLE_Y = NUT - SCALE;
const FB_END = 0.41;
const FB_T = 0.006;
const HW_NUT = 0.0219, HW_END = 0.0285;
const hw = (y: number) => HW_NUT + ((NUT - y) / (NUT - FB_END)) * (HW_END - HW_NUT);
const fretY = (n: number) => NUT - SCALE * (1 - 2 ** (-n / 12));
const NECK_Y0 = 0.49;
const NECK_TOP = 0.882;

/** All 20 frets as one wire: crowned runs across the board, joined by runs hidden inside it. */
function fretPath(): V3[] {
  const pts: V3[] = [];
  const zTop = ZF + FB_T + 0.0002, zIn = ZF + FB_T / 2;
  for (let n = 1; n <= 20; n++) {
    const y = fretY(n);
    const xo = hw(y) - 0.0007, xi = hw(y) - 0.003;
    const run: V3[] = [[-xi, y, zIn], [-xo, y, zTop], [xo, y, zTop], [xi, y, zIn]];
    pts.push(...(n % 2 ? run : run.reverse()));
  }
  return pts.map(v);
}

const dot = (id: string, name: string, n: number, x = 0): Part => {
  const y = (fretY(n - 1) + fretY(n)) / 2;
  return prim(id, name, "fretboard", { type: "cylinder", params: { radiusTop: 0.0031, radiusBottom: 0.0031, height: 0.0008, bevel: 0.0002, open: false } }, PEARL, [x, y, ZF + FB_T - 0.0003], [90, 0, 0]);
};

// ---------- Headstock ----------

const HS_TILT = -14;
const HS_ORIGIN: V3 = [0, NUT + 0.004, ZF - 0.0085];
const HS_T = 0.015;
const ht = HS_TILT * D2R;
/** Headstock frame -> soundboard frame. */
const hs = (x: number, y: number, z: number): V3 => [x, HS_ORIGIN[1] + y * Math.cos(ht) - z * Math.sin(ht), HS_ORIGIN[2] + y * Math.sin(ht) + z * Math.cos(ht)];

const HEADSTOCK: V2[] = [
  [-0.0235, -0.012], [0.0235, -0.012], [0.03, 0.03], [0.0355, 0.12], [0.0382, 0.17], [0.0372, 0.183], [0.031, 0.19], [0, 0.188],
  [-0.031, 0.19], [-0.0372, 0.183], [-0.0382, 0.17], [-0.0355, 0.12], [-0.03, 0.03],
];
const POST_X = 0.0235;
const POST_Y = [0.052, 0.092, 0.132];
const POST_H = 0.013;

function tuner(i: number, sx: 1 | -1): Part[] {
  const side = sx < 0 ? "bass" : "treble";
  const k = `${sx < 0 ? "l" : "r"}${i + 1}`;
  const y = POST_Y[i];
  return [
    prim(`post_${k}`, `Tuner post ${side} ${i + 1}`, "headstock", { type: "cylinder", params: { radiusTop: 0.0031, radiusBottom: 0.0042, height: POST_H, bevel: 0.0008, open: false } }, CHROME, [sx * POST_X, y, HS_T / 2 + POST_H / 2 - 0.001], [90, 0, 0]),
    prim(`tuner_${k}`, `Tuner key ${side} ${i + 1}`, "headstock", {
      type: "lathe",
      params: { points: [[0, -0.009], [0.0066, -0.009], [0.0069, 0.008], [0.0028, 0.012], [0.0024, 0.022], [0.0058, 0.0265], [0.0094, 0.032], [0.0096, 0.041], [0.0052, 0.0458], [0, 0.0466]], angle: 360, segments: 48, sharp: false },
    }, CHROME, [sx * POST_X, y, -HS_T / 2 - 0.003], [0, 0, -sx * 90], [1, 1, 0.42]),
  ];
}

// ---------- Strings ----------

const BRIDGE_Y = SADDLE_Y - 0.004;
const BRIDGE_D = 0.009;
const PIN_Y = SADDLE_Y - 0.011;
const SADDLE_TOP = ZF + BRIDGE_D + 0.0036;
const NUT_TOP = ZF + FB_T + 0.0019;

/** All six strings as one wire: bridge pin -> saddle -> nut -> tuner post, alternating up and down. */
function stringPath(): V3[] {
  const posts: V3[] = [
    [-POST_X + 0.0034, POST_Y[0], 0], [-POST_X + 0.0034, POST_Y[1], 0], [-POST_X + 0.0034, POST_Y[2], 0],
    [POST_X - 0.0034, POST_Y[2], 0], [POST_X - 0.0034, POST_Y[1], 0], [POST_X - 0.0034, POST_Y[0], 0],
  ];
  const zPost = HS_T / 2 + POST_H - 0.004;
  const pts: V3[] = [];
  for (let i = 0; i < 6; i++) {
    const xb = (i - 2.5) * 0.0104, xn = (i - 2.5) * 0.0071;
    const p = posts[i];
    const run: V3[] = [
      [xb, PIN_Y, ZF + BRIDGE_D / 2], [xb, PIN_Y, ZF + BRIDGE_D + 0.001], [xb, SADDLE_Y, SADDLE_TOP], [xn, NUT + 0.0025, NUT_TOP],
      hs(p[0], p[1], zPost), hs(p[0] * 1.15, p[1], 0),
    ];
    pts.push(...(i % 2 ? run.reverse() : run));
  }
  return pts.map(v);
}

const pin = (i: number): Part =>
  prim(`bridge_pin_${i + 1}`, `Bridge pin ${i + 1}`, "bridge", { type: "sphere", params: { radius: 0.0033, angle: 90 } }, IVORY, [(i - 2.5) * 0.0104, PIN_Y - BRIDGE_Y, BRIDGE_D / 2 - 0.0004], [90, 0, 0], [1, 1, 0.8]);

// ---------- Assembly ----------

const parts: Part[] = [
  prim("soundboard", "Soundboard", null, { type: "extrude", params: { shape: OUTLINE, depth: TOP_T, bevel: 0.0012, smooth: true } }, SPRUCE),
  prim("body", "Body", "soundboard", { type: "extrude", params: { shape: OUTLINE, depth: BODY_D, bevel: 0.007, smooth: true } }, MAHOGANY, [0, 0, BODY_Z]),
  prim("binding", "Binding", "soundboard", { type: "tube", params: { points: OUTLINE.map(([x, y]) => v([x, y, ZF - 0.0016])), radius: 0.0021, closed: true, sharp: false } }, IVORY),
  prim("back_binding", "Back binding", "soundboard", { type: "tube", params: { points: OUTLINE.map(([x, y]) => v([x * 0.996, y * 0.998 + 0.0005, BACK_Z + 0.004])), radius: 0.0019, closed: true, sharp: false } }, IVORY),

  // Soundhole cut through the top and into the body, with a dark interior and a two-ring rosette.
  { ...prim("soundhole_cut_top", "Soundhole cutter", "soundboard", { type: "cylinder", params: { radiusTop: HOLE_R, radiusBottom: HOLE_R, height: 0.02, bevel: 0, open: false, segments: 96 } }, SPRUCE, [HOLE_C[0], HOLE_C[1], 0], [90, 0, 0]), csg: { op: "subtract", withPartId: "soundboard" } },
  { ...prim("soundhole_cut_body", "Soundhole body cutter", "soundboard", { type: "cylinder", params: { radiusTop: HOLE_R, radiusBottom: HOLE_R, height: 0.07, bevel: 0, open: false, segments: 96 } }, MAHOGANY, [HOLE_C[0], HOLE_C[1], 0], [90, 0, 0]), csg: { op: "subtract", withPartId: "body" } },
  prim("soundhole", "Soundhole", "soundboard", { type: "cylinder", params: { radiusTop: HOLE_R + 0.001, radiusBottom: HOLE_R + 0.001, height: 0.002, bevel: 0, open: false } }, HOLE, [HOLE_C[0], HOLE_C[1], -0.033], [90, 0, 0]),
  prim("rosette", "Rosette", "soundboard", { type: "torus", params: { radius: 0.0595, tube: 0.0042, arc: 360 } }, { preset: "wood", color: "#3A2216", roughness: 0.3 }, [HOLE_C[0], HOLE_C[1], ZF - 0.0002], [0, 0, 0], [1, 1, 0.12]),
  prim("rosette_inner", "Rosette inner ring", "soundboard", { type: "torus", params: { radius: 0.0535, tube: 0.0011, arc: 360 } }, IVORY, [HOLE_C[0], HOLE_C[1], ZF - 0.0001], [0, 0, 0], [1, 1, 0.3]),
  prim("rosette_outer", "Rosette outer ring", "soundboard", { type: "torus", params: { radius: 0.0655, tube: 0.0011, arc: 360 } }, IVORY, [HOLE_C[0], HOLE_C[1], ZF - 0.0001], [0, 0, 0], [1, 1, 0.3]),
  prim("pickguard", "Pickguard", "soundboard", { type: "extrude", params: { shape: pickguard(), depth: 0.0009, bevel: 0.0003, smooth: true } }, TORT, [HOLE_C[0], HOLE_C[1], ZF + 0.00035]),

  // Bridge with a compensated bone saddle and six bridge pins.
  prim("bridge", "Bridge", "soundboard", {
    type: "extrude",
    params: { shape: [[-0.0775, -0.0085], [-0.045, -0.0125], [0, -0.0155], [0.045, -0.0125], [0.0775, -0.0085], [0.079, 0], [0.0775, 0.0085], [0.045, 0.0115], [0, 0.0125], [-0.045, 0.0115], [-0.0775, 0.0085], [-0.079, 0]], depth: BRIDGE_D, bevel: 0.0028, smooth: true },
  }, ROSEWOOD, [0, BRIDGE_Y, ZF + BRIDGE_D / 2 - 0.0003]),
  prim("saddle", "Saddle", "bridge", { type: "roundedBox", params: { width: 0.074, height: 0.0032, depth: 0.0086, radius: 0.0012 } }, IVORY, [0, SADDLE_Y - BRIDGE_Y, SADDLE_TOP - 0.0043 - (ZF + BRIDGE_D / 2 - 0.0003)], [0, 0, 2.5]),
  ...[0, 1, 2, 3, 4, 5].map(pin),

  // Neck: a tapering half-round mahogany shaft behind the fretboard, with a carved heel at the body.
  prim("neck", "Neck", "soundboard", { type: "lathe", params: { points: [[0, 0], [hw(NECK_Y0 + 0.015) + 0.0004, 0], [HW_NUT + 0.0004, NUT - NECK_Y0], [HW_NUT + 0.0004, NECK_TOP - NECK_Y0], [0, NECK_TOP - NECK_Y0]], angle: 180, segments: 48, sharp: true } }, MAHOGANY, [0, NECK_Y0, ZF], [0, 90, 0], [0.92, 1, 1]),
  prim("heel", "Neck heel", "soundboard", {
    type: "extrude",
    params: { shape: [[-0.007, 0.596], [-0.007, 0.54], [-0.007, 0.49], [-0.086, 0.49], [-0.086, 0.5], [-0.079, 0.511], [-0.066, 0.523], [-0.052, 0.537], [-0.04, 0.552], [-0.031, 0.567], [-0.025, 0.581], [-0.02, 0.593]], depth: 0.05, bevel: 0.006, smooth: false },
  }, MAHOGANY, [0, 0, 0], [0, -90, 0]),
  prim("fretboard", "Fretboard", "soundboard", { type: "extrude", params: { shape: [[-HW_END, FB_END], [HW_END, FB_END], [HW_NUT, NUT], [-HW_NUT, NUT]], depth: FB_T, bevel: 0.001, smooth: false } }, ROSEWOOD, [0, 0, ZF + FB_T / 2]),
  prim("frets", "Frets", "fretboard", { type: "tube", params: { points: fretPath(), radius: 0.0011, closed: false, sharp: true } }, NICKEL, [0, 0, -(ZF + FB_T / 2)]),
  dot("dot_3", "3rd fret marker", 3),
  dot("dot_5", "5th fret marker", 5),
  dot("dot_7", "7th fret marker", 7),
  dot("dot_9", "9th fret marker", 9),
  dot("dot_12a", "12th fret marker", 12, -0.009),
  dot("dot_12b", "12th fret marker", 12, 0.009),
  prim("nut", "Nut", "soundboard", { type: "roundedBox", params: { width: HW_NUT * 2 + 0.0006, height: 0.005, depth: NUT_TOP - ZF + 0.0002, radius: 0.0012 } }, IVORY, [0, NUT + 0.0025, (NUT_TOP + ZF) / 2]),

  // Headstock tilted back, with a rosewood face veneer, inlaid logo and six tuners.
  prim("headstock", "Headstock", "soundboard", { type: "extrude", params: { shape: HEADSTOCK, depth: HS_T, bevel: 0.0025, smooth: false } }, MAHOGANY, HS_ORIGIN, [HS_TILT, 0, 0]),
  prim("headstock_veneer", "Headstock veneer", "headstock", { type: "extrude", params: { shape: HEADSTOCK.map(([x, y]): V2 => [x * 0.985, Math.max(y, 0.004)]), depth: 0.0016, bevel: 0.0005, smooth: false } }, ROSEWOOD, [0, 0, HS_T / 2 - 0.0002]),
  prim("headstock_logo", "Headstock logo", "headstock", { type: "roundedBox", params: { width: 0.022, height: 0.0042, depth: 0.0008, radius: 0.0004 } }, { preset: "metal_polished", color: "#D9C08A" }, [0, 0.166, HS_T / 2 + 0.0011]),
  ...tuner(0, -1), ...tuner(1, -1), ...tuner(2, -1),
  ...tuner(0, 1), ...tuner(1, 1), ...tuner(2, 1),

  prim("strings", "Strings", "soundboard", { type: "tube", params: { points: stringPath(), radius: 0.00062, closed: false, sharp: true } }, BRONZE),

  // Strap buttons: one in the tail block, one on the heel.
  prim("end_pin", "End pin strap button", "body", { type: "lathe", params: { points: [[0, -0.0145], [0.0058, -0.014], [0.0064, -0.011], [0.0034, -0.009], [0.0034, -0.0055], [0.0062, -0.004], [0.0062, 0.001], [0, 0.001]], angle: 360, segments: 48, sharp: false } }, BLACK, [0, 0.0005, 0]),
  prim("heel_button", "Heel strap button", "heel", { type: "lathe", params: { points: [[0, -0.001], [0.0062, -0.001], [0.0062, 0.004], [0.0034, 0.0055], [0.0034, 0.009], [0.0064, 0.011], [0.0058, 0.014], [0, 0.0145]], angle: 360, segments: 48, sharp: false } }, BLACK, [-0.059, 0.531, 0], [0, 0, 45]),
];

export const guitar: Template | null = {
  id: "guitar",
  name: "Dreadnought Acoustic Guitar",
  keywords: ["guitar", "acoustic guitar", "dreadnought", "classical guitar", "folk guitar", "steel string guitar"],
  category: "guitar",
  description: "Full-size dreadnought acoustic guitar with a solid spruce top, mahogany back and sides, rosewood fretboard and bridge, ivory binding, tortoise pickguard and chrome tuners",
  targetPriceUsd: 549,
  parts,
};
