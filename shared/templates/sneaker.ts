import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: modern running / lifestyle sneaker (left shoe, US 9, ~0.30 long).
 * Shown in side profile: the toe points to +X (viewer's right), the lateral side faces the viewer
 * (+Z), the ground is y = 0. Upper, sole and overlays are side-profile extrusions (outline in XY,
 * extruded across the shoe's width along Z) with big bevels so every section is rounded.
 * The upper's top line: toe y = 0.045, instep ~0.09, ankle opening floor y = 0.08, heel collar 0.118.
 * The lateral side's flat face is at z = +0.046 (upper) / +0.053 (midsole).
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const geo = (type: Geometry["type"], params: Record<string, unknown>) => ({ type, params }) as unknown as Geometry;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

/** Euler XYZ (degrees) that turns a kit part's +Z to `normal` and its +Y toward `up`. */
function mount(normal: V3, up: V3): V3 {
  const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
  const n = normal.map((c) => c / len(normal)) as V3;
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  const u0 = [up[0] - d * n[0], up[1] - d * n[1], up[2] - d * n[2]] as V3;
  const u = u0.map((c) => c / len(u0)) as V3;
  const x: V3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
  const deg = (a: number) => r4((a * 180) / Math.PI);
  const m13 = Math.max(-1, Math.min(1, n[0]));
  if (Math.abs(m13) < 0.9999) return [deg(Math.atan2(-n[1], n[2])), deg(Math.asin(m13)), deg(Math.atan2(-u[0], x[0]))];
  return [deg(Math.atan2(u[2], u[1])), deg(Math.asin(m13)), 0];
}

/** y on a polyline [x, y] at x (linear between samples). */
function lineAt(pts: V2[], x: number): number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  if (x <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i][0]) {
      const t = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
    }
  }
  return p[p.length - 1][1];
}

// Palette: slate-blue knit, deep navy suede overlays, coral accents, off-white foam, gum rubber.
const MAIN: PartMaterial = { preset: "knit", color: "#45627D" };
const SUEDE: PartMaterial = { preset: "suede", color: "#25364A" };
const CORAL: PartMaterial = { preset: "plastic_matte", color: "#FF6B4A" };
const FOAM: PartMaterial = { preset: "plastic_matte", color: "#F3F0EA" };
const GUM: PartMaterial = { preset: "rubber", color: "#B9844F" };
const LACE: PartMaterial = { preset: "cotton", color: "#F3F0EA" };
const LINING: PartMaterial = { preset: "knit", color: "#D9DDE2" };
const METAL: PartMaterial = { preset: "metal_brushed", color: "#C9CCD2" };

// ---- Side profiles (XY, counter-clockwise: along the bottom to the toe, back over the top) ----
const UPPER_W = 0.092, UPPER_B = 0.022;
const UPPER_TOP: V2[] = [[0.145, 0.047], [0.135, 0.063], [0.11, 0.077], [0.07, 0.09], [0.03, 0.1], [-0.005, 0.11], [-0.03, 0.114], [-0.07, 0.106], [-0.105, 0.111], [-0.13, 0.122]];
const UPPER: V2[] = [
  [-0.138, 0.034], [-0.09, 0.033], [-0.04, 0.03], [0.02, 0.027], [0.08, 0.025], [0.125, 0.026], [0.142, 0.033],
  ...UPPER_TOP, [-0.148, 0.108], [-0.153, 0.075], [-0.149, 0.046],
];
const SOLE_W = 0.114;
const MIDSOLE: V2[] = [
  [-0.14, 0.013], [-0.12, 0.0065], [-0.06, 0.005], [0, 0.005], [0.06, 0.006], [0.1, 0.0095], [0.13, 0.017], [0.149, 0.026],
  [0.146, 0.034], [0.13, 0.036], [0.09, 0.033], [0.04, 0.034], [-0.02, 0.038], [-0.08, 0.043], [-0.13, 0.047], [-0.153, 0.04], [-0.156, 0.025],
];
const OUTSOLE: V2[] = [
  [-0.142, 0.009], [-0.12, 0.0012], [-0.06, 0], [0, 0], [0.06, 0.0008], [0.1, 0.004], [0.13, 0.011], [0.15, 0.021],
  [0.146, 0.024], [0.128, 0.017], [0.098, 0.011], [0.06, 0.008], [0, 0.0075], [-0.06, 0.0075], [-0.118, 0.0088], [-0.136, 0.015],
];
const TOE_CAP: V2[] = [[0.07, 0.03], [0.125, 0.026], [0.144, 0.033], [0.1485, 0.047], [0.141, 0.058], [0.124, 0.061], [0.1, 0.053], [0.08, 0.043]];
const HEEL_COUNTER: V2[] = [[-0.15, 0.036], [-0.1, 0.034], [-0.062, 0.034], [-0.07, 0.052], [-0.09, 0.07], [-0.12, 0.077], [-0.14, 0.078], [-0.155, 0.07], [-0.1555, 0.048]];
const OPENING: V2[] = [[-0.124, 0.2], [-0.125, 0.1], [-0.116, 0.083], [-0.08, 0.081], [-0.045, 0.085], [-0.026, 0.097], [-0.019, 0.12], [-0.021, 0.2]];
// Swoosh-like (unbranded) sweep on the lateral side: wide at the heel, tapering to a point at midfoot.
const SWEEP: V2[] = [[-0.118, 0.05], [-0.07, 0.053], [-0.02, 0.06], [0.034, 0.076], [-0.01, 0.073], [-0.06, 0.071], [-0.1, 0.074], [-0.12, 0.072]];

/** Plan-view footprint of a left shoe as [x, z] (lateral side +z), shrunk by `inset`. */
const FOOT: V2[] = [
  [0.151, 0.004], [0.137, 0.03], [0.108, 0.046], [0.06, 0.053], [0.0, 0.051], [-0.06, 0.046], [-0.11, 0.042], [-0.142, 0.033], [-0.157, 0.013],
  [-0.159, -0.008], [-0.147, -0.03], [-0.112, -0.039], [-0.06, -0.037], [-0.01, -0.041], [0.05, -0.051], [0.1, -0.049], [0.131, -0.036], [0.147, -0.018],
];
const footprint = (inset: number): V2[] => FOOT.map(([x, z]) => [r4(x * (1 - inset / 0.155) - 0.0), r4(z * (1 - inset / 0.05))]);

/** Invisible cutter that trims `target` to the footprint (a slab with a footprint-shaped hole, lying flat). */
const trimTo = (id: string, target: string, inset: number): Part => ({
  ...prim(id, `${target.replace(/_/g, " ")} shape`, target, geo("extrude", { shape: [[-0.4, -0.3], [0.4, -0.3], [0.4, 0.3], [-0.4, 0.3]], holes: [footprint(inset)], depth: 0.4, bevel: 0, smooth: true }), MAIN, [0, 0.1, 0], [90, 0, 0]),
  csg: { op: "subtract", withPartId: target },
});

const topY = (x: number) => lineAt(UPPER_TOP, x);
/** Upper surface normal on the top line at x (pointing out, in the XY plane). */
const topNormal = (x: number): V3 => {
  const e = 0.004, dy = (topY(x + e) - topY(x - e)) / (2 * e);
  return [-dy, 1, 0];
};

// Padded collar: a rolled edge around the ankle opening, lateral front -> heel -> medial front.
const COLLAR: V3[] = (() => {
  const side = (s: number) => [-0.03, -0.05, -0.075, -0.1].map((x) => [x, topY(x) - 0.002, s * 0.0395] as V3);
  return ([...side(1), [-0.118, topY(-0.118) - 0.001, 0.03], [-0.127, topY(-0.127), 0], [-0.118, topY(-0.118) - 0.001, -0.03], ...side(-1).reverse()] as V3[]).map(v);
})();

// Laces: eyelet stations along the throat (x), eyelet rows at z = +-EYE_Z.
const EYES = [0.058, 0.04, 0.022, 0.004, -0.014];
const EYE_Z = 0.027;
const TONGUE_T = 0.0045;
const TONGUE_PATH: V3[] = [[0.07, topY(0.07) + 0.002, 0], [0.04, topY(0.04) + 0.0035, 0], [0.0, topY(0.0) + 0.004, 0], [-0.03, 0.118, 0], [-0.046, 0.132, 0]].map((p) => v(p as V3));

const parts: Part[] = [
  prim("upper", "Upper", null, geo("extrude", { shape: UPPER, depth: UPPER_W, bevel: UPPER_B, smooth: true }), MAIN),
  {
    ...prim("ankle_opening", "Ankle opening", "upper", geo("extrude", { shape: OPENING, depth: 0.068, bevel: 0.008, smooth: true }), MAIN),
    csg: { op: "subtract", withPartId: "upper" },
  },
  trimTo("upper_shape", "upper", 0.006),
  prim("collar", "Padded collar", "upper", geo("tube", { points: COLLAR, radius: 0.0062 }), MAIN),
  prim("insole", "Insole", "upper", geo("roundedBox", { width: 0.11, height: 0.004, depth: 0.064, radius: 0.0019 }), LINING, [-0.07, 0.0812, 0]),

  // ---- Sole unit ----
  prim("midsole", "Midsole", "upper", geo("extrude", { shape: MIDSOLE, depth: SOLE_W, bevel: 0.016, smooth: true }), FOAM),
  trimTo("midsole_shape", "midsole", 0),
  prim("outsole", "Outsole", "upper", geo("extrude", { shape: OUTSOLE, depth: SOLE_W - 0.002, bevel: 0.004, smooth: true }), GUM),
  trimTo("outsole_shape", "outsole", 0.001),

  // ---- Overlays ----
  prim("toe_cap", "Toe bumper", "upper", geo("extrude", { shape: TOE_CAP, depth: UPPER_W + 0.008, bevel: 0.012, smooth: true }), SUEDE),
  trimTo("toe_cap_shape", "toe_cap", 0.003),
  prim("heel_counter", "Heel counter", "upper", geo("extrude", { shape: HEEL_COUNTER, depth: UPPER_W + 0.004, bevel: UPPER_B + 0.002, smooth: true }), SUEDE),
  trimTo("heel_counter_shape", "heel_counter", 0.004),
  prim("side_sweep", "Side accent", "upper", geo("extrude", { shape: SWEEP, depth: 0.004, bevel: 0.0012, smooth: true }), CORAL, [0, 0, UPPER_W / 2 + 0.0012]),
  prim("heel_tab", "Heel pull tab", "upper", geo("tube", { points: [[-0.146, 0.098, 0], [-0.152, 0.125, 0], [-0.143, 0.137, 0], [-0.131, 0.124, 0], [-0.128, 0.108, 0]], radius: 0.0018, width: 0.02, faceNormal: [-1, 0, 0] }), CORAL),

  // ---- Tongue with its patch ----
  prim("tongue", "Tongue", "upper", geo("tube", { points: TONGUE_PATH, radius: TONGUE_T, width: 0.046, faceNormal: [0, 1, 0] }), MAIN),
  kit("brand_patch", "Brand patch", "upper", "brand_patch", CORAL, [-0.037, 0.1245 + TONGUE_T * 0.8, 0], mount([0.66, 0.75, 0], [-0.75, 0.66, 0]), { width: 0.028, height: 0.017 }),

  // ---- Eyelets and laces ----
  ...EYES.flatMap((x, i) => {
    const y = topY(x);
    const n = topNormal(x);
    const rot = mount(n, [-1, 0, 0]);
    const lift = TONGUE_T + 0.004;
    return [
      ...([-1, 1] as const).map((s) => kit(`eyelet_${s < 0 ? "m" : "l"}${i + 1}`, `${s < 0 ? "Medial" : "Lateral"} eyelet ${i + 1}`, "upper", "grommet", METAL, [x, y - 0.0003, s * EYE_Z], rot)),
      prim(`lace_${i + 1}`, `Lace ${i + 1}`, "upper", geo("tube", {
        points: [[x, y + 0.0015, -EYE_Z], [x - 0.002, y + lift, -0.014], [x - 0.003, y + lift + 0.0008, 0], [x - 0.002, y + lift, 0.014], [x, y + 0.0015, EYE_Z]].map((p) => v(p as V3)),
        radius: 0.0021,
      }), LACE),
    ];
  }),
  prim("lace_bow_loop", "Lace bow", "upper", geo("tube", {
    points: [[-0.016, topY(-0.016) + 0.013, 0.004], [-0.004, topY(-0.016) + 0.022, 0.03], [0.012, topY(-0.016) + 0.016, 0.046], [0.006, topY(-0.016) + 0.008, 0.03], [-0.01, topY(-0.016) + 0.012, 0.01]].map((p) => v(p as V3)),
    radius: 0.0021,
  }), LACE),
  prim("lace_end", "Lace end", "upper", geo("tube", {
    points: [[-0.014, topY(-0.016) + 0.012, 0.006], [0.0, topY(-0.016) + 0.006, 0.03], [0.012, topY(0.012) - 0.004, 0.047], [0.02, topY(0.02) - 0.02, 0.05]].map((p) => v(p as V3)),
    radius: 0.0021,
  }), LACE),
];

export const sneaker: Template | null = {
  id: "sneaker",
  name: "Everyday running sneaker",
  keywords: ["sneaker", "shoe", "trainer", "running shoe", "runner", "kick", "tennis shoe", "gym shoe", "basketball shoe", "footwear"],
  category: "sneaker",
  description: "Running-inspired sneaker with a knit upper, suede toe cap and heel counter, cushioned foam midsole, gum outsole and a sweeping side accent",
  targetPriceUsd: 130,
  parts,
};
