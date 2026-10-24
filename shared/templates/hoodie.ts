import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: pullover hoodie on an invisible torso form ("ghost mannequin"), facing +Z, ~0.75 m tall.
 * The body (root) is a softly fluted lathe from the hem (y = 0) to the shoulders, squashed front to
 * back by ZS so its cross-section is an oval. Its direct children only ever turn about Z and carry
 * a 1/ZS depth scale, so they come out unsquashed; lathe children that should follow the oval
 * (hem rib, kangaroo pocket) keep the squash. The hood rim is an unsquashed frame at the origin:
 * the hood, neck opening, drawcords and pocket cutters hang off it in plain floor coordinates.
 * Sleeves hang from the shoulders, angled out SLEEVE_ANGLE degrees, ending in ribbed cuffs.
 */

type V2 = [number, number];
type V3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const D2R = Math.PI / 180;

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale: v(scale) }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>, scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: v(rotation), scale: v(scale) }, material: { ...material } };
}

const FLEECE: PartMaterial = { preset: "cotton", color: "#8C9A7E" };
const CORD: PartMaterial = { preset: "cotton", color: "#EEEAE0" };
const AGLET: PartMaterial = { preset: "metal_brushed", color: "#C9CCD1" };
const PATCH: PartMaterial = { preset: "canvas", color: "#F1ECDF" };

// ---------- Torso ----------

const ZS = 0.52; // depth squash of the body
/** Direct children of the body: positions in its (pre-squash) frame, depth scale undone. */
const C = (x: number, y: number, z: number): V3 => [x, y, z / ZS];
const unsquash = (sx = 1, sy = 1, sz = 1): V3 => [sx, sy, sz / ZS];

/** Body profile [radius, y], hem to neck. */
const TORSO: V2[] = [
  [0, 0.06], [0.244, 0.06], [0.257, 0.082], [0.262, 0.12], [0.264, 0.2], [0.267, 0.32], [0.268, 0.42], [0.263, 0.5], [0.249, 0.56],
  [0.222, 0.603], [0.18, 0.637], [0.13, 0.658], [0.09, 0.668], [0, 0.672],
];
/** Body radius at height y (linear between profile points). */
function rAt(y: number): number {
  for (let i = 1; i < TORSO.length - 1; i++) {
    const [r0, y0] = TORSO[i], [r1, y1] = TORSO[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return TORSO[1][0];
}
/** Front surface depth (floor frame, after squash) at height y. */
const zFront = (y: number) => rAt(y) * ZS;

// ---------- Hood rim (neckline loop) ----------

/** The hood's rolled front edge around the neck: low V at the front, high behind the neck. */
function rimPoint(phi: number): V3 {
  const c = Math.cos(phi * D2R), s = Math.sin(phi * D2R);
  const y = 0.566 + 0.118 * ((1 - c) / 2) ** 0.4;
  return [0.128 * s, y, 0.012 + (c >= 0 ? 0.128 : 0.112) * c];
}
const RIM: V3[] = Array.from({ length: 36 }, (_, i) => v(rimPoint(i * 10)));
const RIM_R = 0.0135;

/** Hood lying on the upper back: a flattened teardrop, pointed end down, top tucked under the rim. */
const HOOD: V2[] = [[0, -0.2], [0.035, -0.185], [0.08, -0.14], [0.122, -0.075], [0.148, -0.01], [0.158, 0.045], [0.152, 0.09], [0.128, 0.122], [0.08, 0.142], [0, 0.148]];
const HOOD_AT: V3 = [0, 0.522, -0.158];
const HOOD_TILT = 9;
const HOOD_FLAT = 0.2;

// ---------- Sleeves ----------

const SLEEVE_ANGLE = 14;
const SHOULDER: V2 = [0.198, 0.556];
const SLEEVE_END = -0.565;

function sleeve(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const N = sx > 0 ? "Right" : "Left";
  return [
    prim(`sleeve_${k}`, `${N} sleeve`, "body", {
      type: "lathe",
      params: {
        points: [[0, SLEEVE_END + 0.004], [0.049, SLEEVE_END], [0.059, SLEEVE_END + 0.03], [0.063, -0.47], [0.065, -0.36], [0.068, -0.22], [0.072, -0.1], [0.074, -0.03], [0.068, 0.02], [0.045, 0.05], [0, 0.056]],
        angle: 360, segments: 96, flutes: 7, fluteDepth: 0.06, fluteFade: "bottom", sharp: false,
      },
    }, FLEECE, C(sx * SHOULDER[0], SHOULDER[1], 0), [0, 0, sx * SLEEVE_ANGLE], unsquash(1, 1, 0.86)),
    prim(`cuff_${k}`, `${N} cuff`, `sleeve_${k}`, {
      type: "lathe",
      params: {
        points: [[0, SLEEVE_END - 0.052], [0.03, SLEEVE_END - 0.058], [0.041, SLEEVE_END - 0.06], [0.045, SLEEVE_END - 0.054], [0.0465, SLEEVE_END - 0.03], [0.049, SLEEVE_END + 0.002], [0.04, SLEEVE_END + 0.01], [0, SLEEVE_END + 0.012]],
        angle: 360, flutes: 30, fluteDepth: 0.05, fluteFade: "even", sharp: false,
      },
    }, FLEECE),
  ];
}

// ---------- Kangaroo pocket ----------

const POCKET_ANGLE = 80;
const PY0 = 0.072, PY1 = 0.31;
function pocketProfile(): V2[] {
  const n = 8;
  const ys = Array.from({ length: n + 1 }, (_, i) => PY0 + ((PY1 - PY0) * i) / n);
  const outer = ys.map((y): V2 => [r4(rAt(y) + 0.0085), r4(y)]);
  const inner = ys.map((y): V2 => [r4(rAt(y) - 0.004), r4(y)]).reverse();
  return [[r4(rAt(PY0) - 0.004), PY0], ...outer, [r4(rAt(PY1) + 0.004), PY1 + 0.0035], ...inner];
}
// Slanted hand openings: a cutter outside each upper corner, its inner face on the opening line.
const OPEN_TOP: V2 = [0.112, PY1 + 0.01], OPEN_BOT: V2 = [0.172, 0.16];
function pocketCutter(sx: 1 | -1): Part {
  const dx = OPEN_BOT[0] - OPEN_TOP[0], dy = OPEN_BOT[1] - OPEN_TOP[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len; // outward (up and out)
  const ang = Math.atan2(ny, nx) / D2R;
  const mid: V2 = [(OPEN_TOP[0] + OPEN_BOT[0]) / 2, (OPEN_TOP[1] + OPEN_BOT[1]) / 2];
  const c: V3 = [sx * (mid[0] + nx * 0.1), mid[1] + ny * 0.1, 0.12];
  return {
    ...prim(`pocket_cut_${sx > 0 ? "r" : "l"}`, "Pocket opening cutter", "hood_rim", { type: "roundedBox", params: { width: 0.2, height: 0.5, depth: 0.12, radius: 0.004 } }, FLEECE, c, [0, 0, sx * ang]),
    csg: { op: "subtract", withPartId: "pocket" },
  };
}

// ---------- Drawcords ----------

function drawcord(sx: 1 | -1): Part[] {
  const k = sx > 0 ? "r" : "l";
  const N = sx > 0 ? "Right" : "Left";
  const x = sx * 0.036;
  const phi = Math.asin(0.036 / 0.128) / D2R;
  const p = rimPoint(sx * phi);
  const exit: V3 = [x, p[1] - 0.004, p[2] + RIM_R * 0.92];
  const tipY = 0.392;
  const path: V3[] = [
    [x, exit[1] + 0.002, exit[2] - 0.006],
    [x * 1.04, exit[1] - 0.03, zFront(exit[1] - 0.03) + 0.0115],
    [x * 1.1, 0.48, zFront(0.48) + 0.0065],
    [x * 1.16, tipY + 0.022, zFront(tipY + 0.022) + 0.0062],
  ];
  return [
    kit(`grommet_${k}`, `${N} cord eyelet`, "hood_rim", "grommet", AGLET, exit, [-12, 0, 0]),
    prim(`drawcord_${k}`, `${N} drawcord`, "hood_rim", { type: "tube", params: { points: path.map(v), radius: 0.0034, closed: false, sharp: false } }, CORD),
    prim(`aglet_${k}`, `${N} aglet`, `drawcord_${k}`, { type: "cylinder", params: { radiusTop: 0.0043, radiusBottom: 0.004, height: 0.026, bevel: 0.0012, open: false } }, AGLET, [x * 1.165, tipY + 0.008, zFront(tipY + 0.008) + 0.006], [0, 0, sx * 1.5]),
  ];
}

// Logo patch on the left chest, turned to the body's surface normal there.
const PATCH_X = 0.105, PATCH_Y = 0.47;
const PATCH_TILT = (() => {
  const a = rAt(PATCH_Y), b = a * ZS, z = b * Math.sqrt(1 - (PATCH_X / a) ** 2);
  return Math.atan((b * b * PATCH_X) / (a * a * z)) / D2R;
})();

// ---------- Assembly ----------

const parts: Part[] = [
  prim("body", "Body", null, { type: "lathe", params: { points: TORSO, angle: 360, segments: 128, flutes: 11, fluteDepth: 0.014, fluteFade: "bottom", sharp: false } }, FLEECE, [0, 0, 0], [0, 0, 0], [1, 1, ZS]),
  prim("hem", "Ribbed hem", "body", {
    type: "lathe",
    params: { points: [[0.23, 0.003], [0.246, 0.0], [0.2505, 0.006], [0.252, 0.035], [0.2515, 0.066], [0.246, 0.074], [0.23, 0.076]], angle: 360, flutes: 96, fluteDepth: 0.011, fluteFade: "even", sharp: false },
  }, FLEECE),
  ...sleeve(1),
  ...sleeve(-1),

  // Hood: the rolled rim around the neck (an unsquashed frame for everything up top), the hood
  // lying on the upper back, and the neck opening carved into the body.
  prim("hood_rim", "Hood rim", "body", { type: "tube", params: { points: RIM, radius: RIM_R, closed: true, sharp: false } }, FLEECE, [0, 0, 0], [0, 0, 0], unsquash()),
  prim("hood", "Hood", "hood_rim", { type: "lathe", params: { points: HOOD, angle: 360, segments: 96, sharp: false } }, FLEECE, HOOD_AT, [HOOD_TILT, 0, 0], [1, 1, HOOD_FLAT]),
  prim("hood_crown", "Hood collar", "hood_rim", { type: "torus", params: { radius: 0.112, tube: 0.034, arc: 200 } }, FLEECE, [0, 0.664, 0.0], [-100, 0, -10], [1.1, 1.0, 0.75]),
  prim("hood_seam", "Hood seam", "hood", { type: "tube", params: { points: HOOD.slice(1, -1).map(([r, y]): V3 => v([0, y, -(r + 0.0025 / HOOD_FLAT)])), radius: 0.0024, closed: false, sharp: false } }, FLEECE),
  { ...prim("neck_cutter", "Neck opening cutter", "hood_rim", { type: "cylinder", params: { radiusTop: 0.11, radiusBottom: 0.11, height: 0.32, bevel: 0, open: false } }, FLEECE, [0, 0.66, 0.014], [0, 0, 0], [1, 1, 0.86]), csg: { op: "subtract", withPartId: "body" } },

  // Kangaroo pocket following the body's curve, with slanted hand openings.
  prim("pocket", "Kangaroo pocket", "body", { type: "lathe", params: { points: pocketProfile(), angle: POCKET_ANGLE, segments: 64, sharp: true } }, FLEECE, [0, 0, 0], [0, -POCKET_ANGLE / 2, 0]),
  pocketCutter(1),
  pocketCutter(-1),

  ...drawcord(1),
  ...drawcord(-1),

  // Size label sewn inside the back neck, and a woven logo patch on the left chest.
  kit("neck_label", "Neck label", "hood_rim", "brand_patch", { preset: "satin", color: "#2B2D31" }, [0, 0.625, 0.014 - 0.11 * 0.86 + 0.0006], [0, 0, 0], { width: 0.042, height: 0.026 }),
  kit("logo_patch", "Logo patch", "hood_rim", "brand_patch", PATCH, [PATCH_X, PATCH_Y, ZS * Math.sqrt(rAt(PATCH_Y) ** 2 - PATCH_X ** 2) + 0.0008], [0, PATCH_TILT, 0], { width: 0.055, height: 0.03 }),
];

export const hoodie: Template | null = {
  id: "hoodie",
  name: "Heavyweight Pullover Hoodie",
  keywords: ["hoodie", "hoody", "hooded sweatshirt", "sweatshirt", "pullover", "pullover hoodie", "zip hoodie", "zip up hoodie", "hooded jumper"],
  category: "hoodie",
  description: "Heavyweight brushed-fleece pullover hoodie with a lined hood, cotton drawcords with metal aglets, kangaroo pocket, ribbed cuffs and hem and a woven chest patch",
  targetPriceUsd: 79,
  parts,
};
