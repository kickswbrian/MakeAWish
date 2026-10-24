import type { Geometry, Part, PartMaterial } from "../product.ts";
import type { Template } from "./index.ts";

/**
 * Template: 75% mechanical keyboard (82 keys + volume knob), keys facing up, front edge toward +Z.
 * The case (root) is a CNC aluminium wedge: its side profile (z, y) in floor coordinates extruded
 * 0.326 m across and turned -90 degrees about Y (local X = world Z). A key well is carved out of its
 * top by an invisible cutter. Its child "plate" carries the deck in a frame tilted TILT degrees toward
 * the typist (x right, y up out of the deck, z toward the front); plate top is y = PT. Every keycap is
 * its row's sculpted side profile (cylindrical dish, taller back rows) extruded to its width.
 */

type V2 = [number, number];
type V3 = [number, number, number];
type M3 = number[][];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const v = (p: V3): V3 => [r5(p[0]), r5(p[1]), r5(p[2])];

function prim(id: string, name: string, parent: string | null, geometry: Geometry, material: PartMaterial, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: [r4(rotation[0]), r4(rotation[1]), r4(rotation[2])], scale }, material: { ...material } };
}

function kit(id: string, name: string, parent: string, kitAsset: string, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], kitParams?: Record<string, number>): Part {
  return { id, name, kind: "kit", kitAsset, ...(kitParams ? { kitParams } : {}), parent, transform: { position: v(position), rotation: [r4(rotation[0]), r4(rotation[1]), r4(rotation[2])], scale: [1, 1, 1] }, material: { ...material } };
}

// ---------- Rotation helpers (Euler XYZ in degrees, as the renderer uses) ----------

const D = Math.PI / 180;
const rx = (a: number): M3 => [[1, 0, 0], [0, Math.cos(a * D), -Math.sin(a * D)], [0, Math.sin(a * D), Math.cos(a * D)]];
const ry = (a: number): M3 => [[Math.cos(a * D), 0, Math.sin(a * D)], [0, 1, 0], [-Math.sin(a * D), 0, Math.cos(a * D)]];
const mul = (a: M3, b: M3): M3 => a.map((row) => b[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * b[k][j], 0)));
const tr = (m: M3): M3 => m[0].map((_, i) => m.map((row) => row[i]));
const apply = (m: M3, p: V3): V3 => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]) as V3;
function euler(m: M3): V3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]) / D, y / D, Math.atan2(-m[0][1], m[0][0]) / D];
  return [Math.atan2(m[2][1], m[1][1]) / D, y / D, 0];
}

// ---------- Materials ----------

const CASE: PartMaterial = { preset: "plastic_matte", color: "#3E4A5B", roughness: 0.36, metalness: 0.6 };
const ALPHA: PartMaterial = { preset: "plastic_matte", color: "#ECE6D8" };
const MOD: PartMaterial = { preset: "plastic_matte", color: "#7E8794" };
const ACCENT: PartMaterial = { preset: "plastic_matte", color: "#E2663B" };
const KNOB: PartMaterial = { preset: "metal_brushed", color: "#E2663B" };
const STEEL: PartMaterial = { preset: "metal_polished", color: "#D5D9DF" };
const FOOT: PartMaterial = { preset: "rubber", color: "#1B1C1F" };

// ---------- Geometry ----------

const U = 0.019; // key pitch
const TILT = 6; // typing angle, degrees
const CASE_W = 0.326, CASE_L = 0.142; // footprint (width, length along the deck)
const HC = 0.0205; // world height of the plate's center
const PT = 0.0015; // plate top in the plate frame
const RIM = 0.0075; // case top above the plate
const KEY_LIFT = 0.0042; // keycap bottom above the plate
const BOTTOM = 0.005; // case underside above the floor (rubber feet below)

const CASE_ROT: M3 = ry(-90);
const DECK_ROT: M3 = rx(TILT);

/** Case side profile (z, y) in floor coordinates: flat bottom, top parallel to the deck, rounded front lip. */
const CASE_PROFILE: V2[] = (() => {
  const half = (CASE_L / 2) * Math.cos(TILT * D);
  const top = (z: number) => {
    // The plane y' = PT + RIM of the deck frame, as world height at world z.
    const h = PT + RIM;
    return HC + h * Math.cos(TILT * D) - (z - h * Math.sin(TILT * D)) * Math.tan(TILT * D);
  };
  const pts: V2[] = [[-half + 0.004, BOTTOM], [half - 0.006, BOTTOM], [half - 0.0015, BOTTOM + 0.003], [half, BOTTOM + 0.008], [half, top(half) - 0.0015], [half - 0.0015, top(half)], [-half + 0.0015, top(-half)], [-half, top(-half) - 0.0015], [-half, BOTTOM + 0.004]];
  return pts.map(([z, y]): V2 => [r5(z), r5(y)]);
})();

// ---------- Keycaps ----------

/** Per-row sculpt: [front top height, back top height] above the keycap bottom. Row 0 is the F-row. */
const SCULPT: V2[] = [[0.0079, 0.0097], [0.0079, 0.0097], [0.0073, 0.0087], [0.007, 0.0079], [0.0077, 0.0077], [0.008, 0.0075]];

/** Keycap side profile (z, y): tapered sides, cylindrical dish on top. */
function capProfile(row: number): V2[] {
  const [hf, hb] = SCULPT[row];
  const zt = 0.0064;
  const top = (z: number) => hb + ((z + zt) / (2 * zt)) * (hf - hb) - 0.00075 * (1 - (z / zt) ** 2);
  const dish = [0.6, 0.25, -0.25, -0.6].map((f): V2 => [f * zt, top(f * zt)]);
  const pts: V2[] = [[-0.009, 0], [0.009, 0], [zt, hf], ...dish, [-zt, hb]];
  return pts.map(([z, y]): V2 => [r5(z), r5(y)]);
}

type Color = "a" | "m" | "x";
/** [id, name, width in units, color, gap before in units] */
type KeyDef = [string, string, number, Color, number?];

const ROWS: KeyDef[][] = [
  [
    ["esc", "Esc", 1, "x"],
    ["f1", "F1", 1, "m", 0.25], ["f2", "F2", 1, "m"], ["f3", "F3", 1, "m"], ["f4", "F4", 1, "m"],
    ["f5", "F5", 1, "a", 0.25], ["f6", "F6", 1, "a"], ["f7", "F7", 1, "a"], ["f8", "F8", 1, "a"],
    ["f9", "F9", 1, "m", 0.25], ["f10", "F10", 1, "m"], ["f11", "F11", 1, "m"], ["f12", "F12", 1, "m"],
    ["delete", "Delete", 1, "m", 0.25],
  ],
  [
    ["grave", "Grave", 1, "a"], ["1", "1", 1, "a"], ["2", "2", 1, "a"], ["3", "3", 1, "a"], ["4", "4", 1, "a"], ["5", "5", 1, "a"], ["6", "6", 1, "a"],
    ["7", "7", 1, "a"], ["8", "8", 1, "a"], ["9", "9", 1, "a"], ["0", "0", 1, "a"], ["minus", "Minus", 1, "a"], ["equal", "Equals", 1, "a"],
    ["backspace", "Backspace", 2, "m"], ["home", "Home", 1, "m"],
  ],
  [
    ["tab", "Tab", 1.5, "m"], ["q", "Q", 1, "a"], ["w", "W", 1, "a"], ["e", "E", 1, "a"], ["r", "R", 1, "a"], ["t", "T", 1, "a"], ["y", "Y", 1, "a"],
    ["u", "U", 1, "a"], ["i", "I", 1, "a"], ["o", "O", 1, "a"], ["p", "P", 1, "a"], ["lbracket", "Left bracket", 1, "a"], ["rbracket", "Right bracket", 1, "a"],
    ["backslash", "Backslash", 1.5, "a"], ["page_up", "Page Up", 1, "m"],
  ],
  [
    ["caps", "Caps Lock", 1.75, "m"], ["a", "A", 1, "a"], ["s", "S", 1, "a"], ["d", "D", 1, "a"], ["f", "F", 1, "a"], ["g", "G", 1, "a"], ["h", "H", 1, "a"],
    ["j", "J", 1, "a"], ["k", "K", 1, "a"], ["l", "L", 1, "a"], ["semicolon", "Semicolon", 1, "a"], ["quote", "Quote", 1, "a"],
    ["enter", "Enter", 2.25, "x"], ["page_down", "Page Down", 1, "m"],
  ],
  [
    ["lshift", "Left Shift", 2.25, "m"], ["z", "Z", 1, "a"], ["x", "X", 1, "a"], ["c", "C", 1, "a"], ["v", "V", 1, "a"], ["b", "B", 1, "a"],
    ["n", "N", 1, "a"], ["m", "M", 1, "a"], ["comma", "Comma", 1, "a"], ["period", "Period", 1, "a"], ["slash", "Slash", 1, "a"],
    ["rshift", "Right Shift", 1.75, "m"], ["up", "Up arrow", 1, "m"], ["end", "End", 1, "m"],
  ],
  [
    ["lctrl", "Left Ctrl", 1.25, "m"], ["lwin", "Left Super", 1.25, "m"], ["lalt", "Left Alt", 1.25, "m"], ["space", "Space bar", 6.25, "a"],
    ["ralt", "Right Alt", 1, "m"], ["fn", "Fn", 1, "m"], ["rctrl", "Right Ctrl", 1, "m"], ["left", "Left arrow", 1, "m"], ["down", "Down arrow", 1, "m"], ["right", "Right arrow", 1, "m"],
  ],
];

const rowZ = (row: number) => -3.125 * U + (row === 0 ? 0.5 : row + 0.75) * U;
const MAT: Record<Color, PartMaterial> = { a: ALPHA, m: MOD, x: ACCENT };

function keycaps(): Part[] {
  const out: Part[] = [];
  ROWS.forEach((row, r) => {
    let col = 0;
    for (const [id, name, w, color, gap] of row) {
      col += gap ?? 0;
      const x = -8 * U + (col + w / 2) * U;
      col += w;
      out.push(prim(`key_${id}`, `${name} key`, "plate", { type: "extrude", params: { shape: capProfile(r), depth: w * U - 0.0012, bevel: 0.0011, smooth: false } }, MAT[color], [x, PT + KEY_LIFT, rowZ(r)], [0, -90, 0]));
    }
  });
  return out;
}

/** Homing bump near the front of a home-row keycap (keycap frame: x = deck z, z = -deck x). */
const homing = (key: string): Part =>
  prim(`${key}_homing_bar`, "Homing bump", key, { type: "roundedBox", params: { width: 0.0011, height: 0.0007, depth: 0.0048, radius: 0.0003 } }, ALPHA, [0.0042, SCULPT[3][0] + 0.00005, 0]);

// ---------- Case hardware (case frame: local x = world z, local z = -world x) ----------

const CASE_INV = tr(CASE_ROT);
const inCase = (p: V3): V3 => apply(CASE_INV, p);
const rotInCase = (world: M3): V3 => euler(mul(CASE_INV, world));

const foot = (id: string, x: number, z: number): Part =>
  kit(id, "Rubber foot", "case", "rubber_foot", FOOT, inCase([x, BOTTOM, z]), rotInCase(rx(90)));

const backZ = -(CASE_L / 2) * Math.cos(TILT * D);

// ---------- Assembly ----------

const parts: Part[] = [
  prim("case", "Case", null, { type: "extrude", params: { shape: CASE_PROFILE, depth: CASE_W, bevel: 0.0028, smooth: false } }, CASE, [0, 0, 0], euler(CASE_ROT)),
  // The deck frame: tilted toward the typist; everything on the deck hangs off it.
  prim("plate", "Switch plate", "case", { type: "roundedBox", params: { width: 16 * U + 0.006, height: 0.003, depth: 6.25 * U + 0.006, radius: 0.001 } }, CASE, inCase([0, HC, 0]), euler(mul(CASE_INV, DECK_ROT))),
  {
    ...prim("key_well_cut", "Key well cut", "plate", { type: "roundedBox", params: { width: 16 * U + 0.0072, height: 0.04, depth: 6.25 * U + 0.0072, radius: 0.0025 } }, CASE, [0, PT - 0.001 + 0.02, 0]),
    csg: { op: "subtract", withPartId: "case" },
  },
  ...keycaps(),
  homing("key_f"),
  homing("key_j"),
  kit("volume_knob", "Volume knob", "plate", "knob", KNOB, [7.5 * U, PT, rowZ(0)], [-90, 0, 0], { radius: 0.0098 }),
  kit("usb_c_port", "USB-C port", "case", "usb_port", STEEL, inCase([-0.11, 0.0205, backZ]), rotInCase(ry(180))),
  foot("foot_front_left", -0.135, 0.052),
  foot("foot_front_right", 0.135, 0.052),
  foot("foot_back_left", -0.135, -0.052),
  foot("foot_back_right", 0.135, -0.052),
];

export const keyboard: Template | null = {
  id: "keyboard",
  name: "75% Mechanical Keyboard",
  keywords: ["keyboard", "mechanical keyboard", "gaming keyboard", "wireless keyboard", "custom keyboard", "keeb", "75 keyboard", "tkl keyboard", "computer keyboard"],
  category: "keyboard",
  description: "75% hot-swappable mechanical keyboard with a CNC aluminium gasket case, sculpted cream and grey PBT keycaps with orange accents, a volume knob and USB-C",
  targetPriceUsd: 179,
  parts,
};
