import type { Part, PartMaterial } from "../../product.ts";
import { gemSeatZ, hoopCenterRadius, hoopSection, huggieDepth } from "../../modules/jewelry.ts";
import type { FashionTemplate, V3, Zone } from "../types.ts";

/**
 * Fashion template: a pair of earrings on a small velvet T-bar display stand. The stand is the
 * base (root stand_base on the floor, a slim post, and the bar); every earring part is a child of
 * stand_bar, in its frame (origin at the bar's center, +Z toward the viewer).
 *
 * Hanging styles (hoops, huggies, drops) hang face-on in front of the bar from short velvet pegs
 * through the ring, so their hinge and profile read like a product photo; studs sit on the bar's
 * front face with the post and butterfly back hidden inside it. The right earring is turned a little
 * so the pair shows both the face and the band's depth.
 *
 * Each earring body is a jewelry kit module (hoop, huggie, stud, drop, gem) so it can be tapped and
 * edited; zones per earring (earlobe, drop_point, face, hoop_front with _left/_right) are in the
 * bar's frame and move with the style, size and thickness controls.
 */

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const v = (p: V3): V3 => [r5(p[0]), r5(p[1]), r5(p[2])];
const D2R = Math.PI / 180;

const GOLD: PartMaterial = { preset: "metal_polished", color: "#E3BA5F", roughness: 0.12 };
const DIAMOND: PartMaterial = { preset: "gem", color: "#F4F8FF" };
const PEARL: PartMaterial = { preset: "pearl", color: "#F3EDE1" };
const VELVET: PartMaterial = { preset: "velvet", color: "#2B2D31" };

type Size = "small" | "medium" | "large";
type Thick = "fine" | "regular" | "chunky";
const pick = <T>(table: Record<string, T>, key: string, fallback: string): T => table[key] ?? table[fallback];

/** Real dimensions per style, size and thickness (meters). */
function dims(c: Record<string, string>) {
  const size = c.size as Size, thick = c.thickness as Thick;
  const hoopD = pick({ small: 0.016, medium: 0.025, large: 0.04 }, size, "medium");
  const hoopT = pick({ fine: 0.0016, regular: 0.0026, chunky: 0.0045 }, thick, "regular");
  const statementD = pick({ small: 0.032, medium: 0.042, large: 0.055 }, size, "medium");
  const statementT = pick({ fine: 0.0045, regular: 0.006, chunky: 0.0085 }, thick, "regular");
  const huggieD = pick({ small: 0.01, medium: 0.012, large: 0.015 }, size, "medium");
  const huggieT = pick({ fine: 0.0018, regular: 0.0026, chunky: 0.0036 }, thick, "regular");
  const studS = pick({ small: 0.004, medium: 0.0055, large: 0.007 }, size, "medium");
  const dropLen = pick({ small: 0.014, medium: 0.02, large: 0.03 }, size, "medium");
  const pearlS = pick({ small: 0.006, medium: 0.008, large: 0.01 }, size, "medium");
  return { hoopD, hoopT, statementD, statementT, huggieD, huggieT, studS, dropLen, pearlS };
}

/** What hangs at each earlobe point for a style: the ring (if any) and how far below it reaches. */
interface Body {
  kind: "hoop" | "huggie" | "stud";
  diameter: number;
  thickness: number;
  profile: string;
  /** Ring centerline radius, band radial and depth (rings only). */
  rc: number;
  radial: number;
  depth: number;
  /** Lowest point below the earlobe point. */
  hang: number;
}

function body(c: Record<string, string>): Body {
  const d = dims(c);
  if (c.style === "stud") return { kind: "stud", diameter: d.studS, thickness: 0, profile: "", rc: 0, radial: 0, depth: 0, hang: d.studS / 2 };
  if (c.style === "huggie" || c.style === "drop") {
    const D = c.style === "drop" ? Math.min(d.huggieD, 0.011) : d.huggieD;
    const rc = D / 2 - d.huggieT / 2;
    const ring = 2 * rc + d.huggieT / 2;
    return { kind: "huggie", diameter: D, thickness: d.huggieT, profile: "", rc, radial: d.huggieT, depth: huggieDepth(d.huggieT), hang: ring + (c.style === "drop" ? d.dropLen : 0) };
  }
  const statement = c.style === "statement";
  const D = statement ? d.statementD : d.hoopD, T = statement ? d.statementT : d.hoopT, profile = statement ? "chunky" : "round";
  const { radial, depth } = hoopSection(profile, T);
  const rc = hoopCenterRadius(D, profile, T);
  return { kind: "hoop", diameter: D, thickness: T, profile, rc, radial, depth, hang: 2 * rc + radial / 2 };
}

/** Stand and earring placement for these controls (bar frame). */
function layout(c: Record<string, string>) {
  const b = body(c);
  const hanging = b.kind !== "stud";
  // Small pieces get a smaller stand: the stage fits the whole product, so the stand sets the zoom.
  const big = b.kind === "hoop";
  const barH = big ? 0.011 : 0.0085, barD = 0.0115, pegR = big ? 0.0011 : 0.0009;
  const spacing = big ? Math.max(0.034, b.diameter + 0.016) : b.kind === "huggie" ? 0.026 : 0.021;
  const barW = spacing + (big ? Math.max(0.024, b.diameter * 0.5) : b.kind === "huggie" ? 0.018 : 0.016);
  // Ring tops rest on pegs near the bar's lower edge: the inner top of the band sits on the peg.
  const pegY = -barH / 2 + pegR + 0.0012;
  const lobeY = hanging ? pegY + pegR + b.radial / 2 : 0;
  // Hanging rings clear the bar's front face, turned or not.
  const turn = 16;
  let lobeZ = barD / 2;
  if (hanging) {
    const outer = b.rc + b.radial / 2;
    const dy = -barH / 2 - (lobeY - b.rc);
    const reach = dy < outer ? Math.sqrt(Math.max(0, outer * outer - dy * dy)) : 0;
    lobeZ = barD / 2 + b.depth / 2 + 0.0007 + Math.sin(turn * D2R) * reach;
  }
  const baseH = big ? 0.008 : 0.006;
  const baseR = Math.min(0.03, Math.max(0.016, barW * 0.42));
  const postR = big ? 0.0036 : 0.0028;
  const lowest = lobeY - b.hang;
  const barY = Math.max(big ? 0.048 + b.diameter * 0.45 : b.kind === "huggie" ? 0.036 : 0.032, baseH + 0.009 - lowest);
  const ears = [
    { side: "left", name: "Left", at: [-spacing / 2, lobeY, lobeZ] as V3, yaw: 0 },
    { side: "right", name: "Right", at: [spacing / 2, lobeY, lobeZ] as V3, yaw: hanging ? turn : 0 },
  ];
  return { b, hanging, barH, barD, barW, barY, baseH, baseR, postR, pegR, pegY, ears };
}

/** Earring-local point / direction -> bar frame. */
const toBar = (at: V3, yaw: number, p: V3): V3 => {
  const c = Math.cos(yaw * D2R), s = Math.sin(yaw * D2R);
  return [at[0] + p[0] * c + p[2] * s, at[1] + p[1], at[2] - p[0] * s + p[2] * c];
};
const dirToBar = (yaw: number, d: V3): V3 => toBar([0, 0, 0], yaw, d);

function prim(id: string, name: string, parent: string | null, geometry: Part["geometry"], material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation: v(rotation), scale: [1, 1, 1] }, material: { ...material } };
}

function kit(id: string, name: string, kitAsset: string, kitParams: Record<string, number | string>, material: PartMaterial, position: V3, yaw: number): Part {
  const params: Record<string, number | string> = {};
  for (const [k, val] of Object.entries(kitParams)) params[k] = typeof val === "number" ? r5(val) : val;
  return { id, name, kind: "kit", kitAsset, kitParams: params, parent: "stand_bar", transform: { position: v(position), rotation: [0, r5(yaw), 0], scale: [1, 1, 1] }, material: { ...material } };
}

function build(c: Record<string, string>): Part[] {
  const L = layout(c);
  const { b } = L;
  const d = dims(c);
  const parts: Part[] = [
    // Root: the base puck, centered on its origin, resting on the floor.
    prim("stand_base", "Velvet stand base", null, {
      type: "cylinder",
      params: { radiusTop: L.baseR * 0.96, radiusBottom: L.baseR, height: L.baseH, bevel: L.baseH * 0.38, open: false, segments: 96 },
    }, VELVET, [0, L.baseH / 2, 0]),
    prim("stand_post", "Velvet stand post", "stand_base", {
      type: "cylinder",
      params: { radiusTop: L.postR * 0.85, radiusBottom: L.postR, height: L.barY - L.baseH, bevel: 0.0005, open: false, segments: 48 },
    }, VELVET, [0, (L.barY - L.baseH) / 2 + L.baseH / 2 - 0.0002, -0.0005]),
    prim("stand_bar", "Velvet display bar", "stand_base", {
      type: "roundedBox",
      params: { width: L.barW, height: L.barH, depth: L.barD, radius: L.barH * 0.4 },
    }, VELVET, [0, L.barY - L.baseH / 2, 0]),
  ];
  for (const e of L.ears) {
    const N = e.name;
    if (L.hanging) {
      // Peg through the ring, from the bar's front face to just past the band's front.
      const len = e.at[2] + b.depth / 2 + 0.0006 - L.barD / 2 + 0.002;
      parts.push(prim(`stand_peg_${e.side}`, `${N} display peg`, "stand_bar", { type: "capsule", params: { radius: L.pegR, length: Math.max(0.001, len - 2 * L.pegR) } }, VELVET, [e.at[0], L.pegY, L.barD / 2 - 0.002 + len / 2], [90, 0, 0]));
    }
    if (b.kind === "hoop") {
      parts.push(kit(`hoop_${e.side}`, `${N} hoop`, "hoop", { diameter: b.diameter, thickness: b.thickness, profile: b.profile, closure: "hinged" }, GOLD, e.at, e.yaw));
    } else if (b.kind === "huggie") {
      parts.push(kit(`huggie_${e.side}`, `${N} huggie`, "huggie", { diameter: b.diameter, thickness: b.thickness, pave: "none" }, GOLD, e.at, e.yaw));
      if (c.style === "drop") {
        parts.push(kit(`drop_${e.side}`, `${N} pearl drop`, "drop", { length: d.dropLen, charm: "pearl", charm_size: d.pearlS, loop: b.depth + 0.0008 }, GOLD, toBar(e.at, e.yaw, [0, -2 * b.rc, 0]), e.yaw));
      }
    } else {
      parts.push(kit(`stud_${e.side}`, `${N} stud`, "stud", { head: "prong_setting", size: b.diameter, back: "butterfly" }, GOLD, e.at, e.yaw));
      parts.push(kit(`stone_${e.side}`, `${N} stone`, "gem", { cut: "round", setting: "none", size: b.diameter, metal: "gold" }, DIAMOND, toBar(e.at, e.yaw, [0, 0, gemSeatZ(b.diameter)]), e.yaw));
    }
  }
  return parts;
}

function zones(c: Record<string, string>): Record<string, Zone> {
  const L = layout(c);
  const { b } = L;
  const out: Record<string, Zone> = {};
  for (const e of L.ears) {
    const N = e.name.toLowerCase();
    const pt = (p: V3) => v(toBar(e.at, e.yaw, p));
    const front = v(dirToBar(e.yaw, [0, 0, 1]));
    out[`earlobe_${e.side}`] = { part: "stand_bar", label: `${N} earlobe`, at: v(e.at), normal: front, up: [0, 1, 0] };
    if (b.kind === "stud") {
      const zg = gemSeatZ(b.diameter);
      out[`drop_point_${e.side}`] = { part: "stand_bar", label: `below the ${N} stud`, at: pt([0, -b.diameter * 0.55, zg * 0.5]), normal: front, up: [0, 1, 0] };
      out[`face_${e.side}`] = { part: "stand_bar", label: `${N} stud face`, at: pt([0, 0, zg]), normal: front, up: [0, 1, 0], room: [b.diameter, b.diameter] };
      // A halo ring around the head (pavé, a bezel edge).
      const path: V3[] = [];
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        path.push(pt([Math.cos(a) * b.diameter * 0.66, Math.sin(a) * b.diameter * 0.66, zg * 0.55]));
      }
      path[path.length - 1] = path[0];
      out[`hoop_front_${e.side}`] = { part: "stand_bar", label: `around the ${N} stud`, path, normals: path.map(() => front) };
    } else {
      const bottom = -2 * b.rc;
      // Just inside the band's underside: a charm's jump ring hanging here reads as threaded on the band.
      out[`drop_point_${e.side}`] = { part: "stand_bar", label: `bottom of the ${N} ${b.kind}`, at: pt([0, bottom - b.radial * 0.42, 0]), normal: front, up: [0, 1, 0] };
      out[`face_${e.side}`] = { part: "stand_bar", label: `front of the ${N} ${b.kind}`, at: pt([0, bottom, b.depth / 2]), normal: front, up: [0, 1, 0], room: [b.radial * 2, b.radial] };
      // Front face of the band, lower arc, counter-clockwise (so W points toward the ring's center).
      const path: V3[] = [];
      for (let i = 0; i <= 28; i++) {
        const a = (200 + (140 * i) / 28) * D2R;
        path.push(pt([Math.cos(a) * b.rc, -b.rc + Math.sin(a) * b.rc, b.depth / 2 + 0.0003]));
      }
      out[`hoop_front_${e.side}`] = { part: "stand_bar", label: `front of the ${N} ${b.kind}`, path, normals: path.map(() => front) };
    }
  }
  return out;
}

export const earrings: FashionTemplate = {
  id: "earrings",
  name: "Earrings",
  category: "earrings",
  kind: "jewelry",
  keywords: [
    "earrings", "earring", "hoops", "hoop earrings", "gold hoops", "studs", "stud earrings", "diamond studs", "huggies",
    "huggie earrings", "drop earrings", "dangle earrings", "pearl earrings",
  ],
  description: "A pair of polished gold earrings on a velvet display stand: classic hinged hoops, huggies, studs or pearl drops.",
  targetPriceUsd: 85,
  controls: {
    style: { options: ["hoop", "huggie", "stud", "drop", "statement"], default: "hoop", description: "hoop, huggie (small thick hoop), stud (set stone), drop (huggie with a pearl dangle), statement (big chunky hoop)" },
    size: { options: ["small", "medium", "large"], default: "medium", description: "diameter or stone size (medium hoop 25 mm)" },
    thickness: { options: ["fine", "regular", "chunky"], default: "regular", description: "band thickness (regular hoop 2.6 mm)" },
  },
  slots: {
    metal: {
      description: "the earrings' metal",
      parts: ["hoop_left", "hoop_right", "huggie_left", "huggie_right", "stud_left", "stud_right", "drop_left", "drop_right"],
      default: GOLD,
    },
    stone: { description: "set stones", parts: ["stone_left", "stone_right"], default: DIAMOND },
    accent: { description: "pearls and accents added by styles", parts: [], default: PEARL },
    display: { description: "the velvet display stand", parts: ["stand_base", "stand_post", "stand_bar", "stand_peg_left", "stand_peg_right"], default: VELVET },
  },
  build,
  zones,
  modules: [],
  display: "stand",
};
