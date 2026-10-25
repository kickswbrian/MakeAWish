import type { Part, PartMaterial } from "../../product.ts";
import type { FashionTemplate, V3, Zone } from "../types.ts";

/**
 * Fashion template: a bracelet on a velvet wrist bar, the way a jeweler shows one. The stand (base
 * puck, post and a padded bar running along X) is the base; the bracelet loops around the bar in the
 * YZ plane and sags below it, so the lower arc hangs free for charms. The whole stand is turned so
 * the loop is seen three-quarter instead of edge-on.
 *
 * Styles: a chain loop (chain kit), a charm bracelet (chain plus three charms on the lower arc), a
 * tennis bracelet (a pavé row of stones all the way round) or a solid bangle (hoop kit).
 * Zones (base frame): drop_point (bottom of the loop), hoop_front (the lower arc), clasp (the top).
 */

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const v = (p: V3): V3 => [r5(p[0]), r5(p[1]), r5(p[2])];

const GOLD: PartMaterial = { preset: "metal_polished", color: "#E3BA5F", roughness: 0.12 };
const DIAMOND: PartMaterial = { preset: "gem", color: "#F4F8FF" };
const PEARL: PartMaterial = { preset: "pearl", color: "#F3EDE1" };
const VELVET: PartMaterial = { preset: "velvet", color: "#2B2D31" };

const BAR_R = 0.026;
const BAR_LEN = 0.06;
const BAR_Y = 0.105;
const LINK: Record<string, number> = { fine: 0.0024, regular: 0.0036, chunky: 0.0068 };
const BANGLE_T: Record<string, number> = { fine: 0.0024, regular: 0.004, chunky: 0.0075 };
const STONE: Record<string, number> = { fine: 0.0018, regular: 0.0026, chunky: 0.0036 };

/** The loop around the bar for these controls: center below the bar's axis, radius, wire size. */
function loop(c: Record<string, string>) {
  const style = c.style;
  const link = LINK[c.thickness] ?? LINK.regular;
  const wire = style === "bangle" ? BANGLE_T[c.thickness] ?? BANGLE_T.regular : style === "tennis" ? (STONE[c.thickness] ?? STONE.regular) * 1.2 : link * 0.6;
  // Chains sag; a tennis line is stiffer; a bangle is a 64 mm circle hanging from the top.
  const R = style === "bangle" ? 0.032 - wire / 2 : BAR_R + wire / 2 + (style === "tennis" ? 0.003 : 0.0055);
  const cy = BAR_R + wire / 2 - R;
  const N = 72;
  const path: V3[] = [];
  const normals: V3[] = [];
  for (let i = 0; i <= N; i++) {
    // Start at the top (the clasp), run toward the viewer and down.
    const a = Math.PI / 2 - (i / N) * Math.PI * 2;
    path.push(v([0, cy + Math.sin(a) * R, Math.cos(a) * R]));
    normals.push(v([0, Math.sin(a), Math.cos(a)]));
  }
  path[N] = path[0];
  return { R, cy, wire, link, path, normals, N };
}

function prim(id: string, name: string, parent: string | null, geometry: Part["geometry"], position: V3, rotation: V3 = [0, 0, 0]): Part {
  return { id, name, kind: "primitive", geometry, parent, transform: { position: v(position), rotation, scale: [1, 1, 1] }, material: { ...VELVET } };
}

function kit(id: string, name: string, kitAsset: string, kitParams: Record<string, number | string>, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], extra: Partial<Part> = {}): Part {
  const params: Record<string, number | string> = {};
  for (const [k, val] of Object.entries(kitParams)) params[k] = typeof val === "number" ? r5(val) : val;
  return { id, name, kind: "kit", kitAsset, kitParams: params, parent: "stand_base", transform: { position: v(position), rotation, scale: [1, 1, 1] }, material: { ...material }, ...extra };
}

const CHARMS: [string, string][] = [["heart", "Heart charm"], ["star", "Star charm"], ["moon", "Moon charm"]];

function build(c: Record<string, string>): Part[] {
  const L = loop(c);
  const baseH = 0.008, baseR = 0.034, postR = 0.0045;
  const parts: Part[] = [
    // Root: the base puck, turned so the bracelet reads three-quarter.
    prim("stand_base", "Velvet stand base", null, { type: "cylinder", params: { radiusTop: baseR * 0.96, radiusBottom: baseR, height: baseH, bevel: baseH * 0.38, open: false, segments: 96 } }, [0, baseH / 2, 0], [0, 30, 0]),
    prim("stand_post", "Velvet stand post", "stand_base", { type: "cylinder", params: { radiusTop: postR * 0.85, radiusBottom: postR, height: BAR_Y - baseH - BAR_R * 0.6, bevel: 0.0005, open: false, segments: 48 } }, [0, (BAR_Y - BAR_R * 0.6) / 2 - baseH / 2, -0.004]),
    prim("stand_bar", "Velvet wrist bar", "stand_base", { type: "capsule", params: { radius: BAR_R, length: BAR_LEN } }, [0, BAR_Y - baseH / 2, 0], [0, 0, 90]),
  ];
  // Kits hang off the base (unrolled frame): the bar's axis runs along X at height BAR_Y - baseH / 2.
  const at = (p: V3): V3 => [p[0], p[1] + BAR_Y - baseH / 2, p[2]];
  const path = L.path.map(at);
  const side: V3 = [0, 90, 0];
  if (c.style === "bangle") {
    // Hoop kit: a ring in its XY plane hanging from its top: turned to loop around the bar.
    parts.push(kit("bangle", "Bangle", "hoop", { diameter: 2 * L.R + L.wire, thickness: L.wire, profile: c.thickness === "chunky" ? "chunky" : "round", closure: "endless" }, GOLD, at([0, BAR_R + L.wire / 2, 0]), side));
  } else if (c.style === "tennis") {
    parts.push(kit("stones", "Tennis line", "pave", { stone: STONE[c.thickness] ?? STONE.regular, metal: "gold" }, DIAMOND, [0, 0, 0], [0, 0, 0], { kitPath: path, kitNormals: L.normals }));
  } else {
    parts.push(kit("chain", "Chain", "chain", { link: ["curb", "rope", "paperclip", "figaro", "box", "bead"].includes(c.chain) ? c.chain : "cable", size: L.link }, GOLD, [0, 0, 0], [0, 0, 0], { kitPath: path, kitNormals: L.normals }));
    parts.push(kit("clasp", "Clasp", "clasp", { style: c.thickness === "chunky" ? "toggle" : "lobster", size: Math.max(0.008, L.link * 3) }, GOLD, at([0.0045, L.cy + L.R, 0]), side));
  }
  if (c.style === "charm") {
    CHARMS.forEach(([shape, name], k) => {
      const a = -Math.PI / 2 + (k - 1) * 0.42;
      parts.push(kit(`charm_${shape}`, name, "charm", { shape, size: c.thickness === "chunky" ? 0.016 : 0.012 }, GOLD, at([0, L.cy + Math.sin(a) * L.R - L.wire * 0.3, Math.cos(a) * L.R]), side));
    });
  }
  return parts;
}

function zones(c: Record<string, string>): Record<string, Zone> {
  const L = loop(c);
  const at = (p: V3): V3 => v([p[0], p[1] + BAR_Y - 0.004, p[2]]);
  const a = Math.round(L.N * 0.32), b = Math.round(L.N * 0.68);
  // Charms face along the bar (+X), the side of the loop the turned stand shows.
  return {
    drop_point: { part: "stand_base", label: "bottom of the bracelet", at: at([0, L.cy - L.R - L.wire * 0.3, 0]), normal: [1, 0, 0], up: [0, 1, 0] },
    hoop_front: { part: "stand_base", label: "lower arc of the bracelet", path: L.path.slice(a, b + 1).map(at), normals: L.normals.slice(a, b + 1) },
    clasp: { part: "stand_base", label: "top of the bracelet (clasp)", at: at([0, L.cy + L.R, 0]), normal: [1, 0, 0], up: [0, 1, 0] },
  };
}

export const bracelet: FashionTemplate = {
  id: "bracelet",
  name: "Bracelet",
  category: "bracelet",
  kind: "jewelry",
  keywords: ["bracelet", "bracelets", "bangle", "bangles", "cuff bracelet", "charm bracelet", "tennis bracelet", "chain bracelet", "anklet"],
  description: "A polished gold bracelet on a velvet wrist bar: a chain loop, a charm bracelet, a diamond tennis line or a solid bangle.",
  targetPriceUsd: 70,
  controls: {
    style: { options: ["chain", "charm", "tennis", "bangle"], default: "chain", description: "chain loop, chain with charms, tennis (a row of set stones) or solid bangle" },
    chain: { options: ["cable", "curb", "rope", "paperclip", "figaro", "box", "bead"], default: "curb", description: "chain link style (chain and charm styles)" },
    thickness: { options: ["fine", "regular", "chunky"], default: "regular", description: "link, band or stone size" },
  },
  slots: {
    metal: { description: "the bracelet's metal", parts: ["chain", "clasp", "bangle", "charm_heart", "charm_star", "charm_moon"], default: GOLD },
    stone: { description: "set stones", parts: ["stones"], default: DIAMOND },
    accent: { description: "pearls and accents", parts: [], default: PEARL },
    display: { description: "the velvet wrist bar", parts: ["stand_base", "stand_post", "stand_bar"], default: VELVET },
  },
  build,
  zones,
  modules: [],
  display: "stand",
};
