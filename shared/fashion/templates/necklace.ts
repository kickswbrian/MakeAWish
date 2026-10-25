import type { Part, PartMaterial } from "../../product.ts";
import { bustRings, FORM_SE, ringAt, ringPoint } from "../../modules/display.ts";
import type { FashionTemplate, V3, Zone } from "../types.ts";

/**
 * Fashion template: a chain necklace draped on a velvet jewelry bust. The bust (form_bust kit) is
 * the root; the chain is a chain kit along a path lying on the bust's surface, from the clasp at the
 * back of the neck around to its lowest point at the front, where the pendant hangs.
 *
 * The drape is computed from the same cross-sections the bust is built from, so the chain rests on
 * the shoulders and chest at every length. Zones: drop_point (the pendant's bail), face (the
 * pendant's front), chain_front (the front arc, for stations and pavé) and clasp (back of the neck).
 */

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const v = (p: V3): V3 => [r5(p[0]), r5(p[1]), r5(p[2])];

const GOLD: PartMaterial = { preset: "metal_polished", color: "#E3BA5F", roughness: 0.12 };
const DIAMOND: PartMaterial = { preset: "gem", color: "#F4F8FF" };
const PEARL: PartMaterial = { preset: "pearl", color: "#F3EDE1" };
const VELVET: PartMaterial = { preset: "velvet", color: "#2B2D31" };

const BUST = { width: 0.21, height: 0.24, neck: 0.025 };
const LINK: Record<string, number> = { fine: 0.0024, regular: 0.0036, chunky: 0.0068 };
const PENDANT_SIZE: Record<string, number> = { fine: 0.012, regular: 0.016, chunky: 0.022 };
const CHARMS = new Set(["heart", "star", "moon", "disc", "initial", "flower", "shell"]);

/** The chain's path on the bust: back of the neck (clasp) all the way round and back again. */
function drape(c: Record<string, string>) {
  const rings = bustRings(BUST);
  const H = BUST.height;
  const link = LINK[c.thickness] ?? LINK.regular;
  const size = c.chain === "paperclip" ? link * 2.2 : link;
  const out = size * 0.32 + 0.0006;
  const choker = c.length === "choker";
  // Where the chain rests at the back, and how far the front falls below that.
  const yBack = choker ? H * 0.78 : H * 0.69;
  const drop = choker ? 0 : c.length === "matinee" ? H * 0.4 : H * 0.2;
  const N = 88;
  const path: V3[] = [];
  const normals: V3[] = [];
  const base = ringAt(rings, yBack);
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (i / N) * Math.PI * 2;
    // Behind the neck the chain rests on the neck-base ring; in front it falls down the chest as a U
    // a little wider than the neck, lying on the surface (projected from the front).
    const f = Math.max(0, Math.sin(t)) ** 1.6;
    if (f === 0) {
      const p = ringPoint(base, t, out), q = ringPoint(base, t, out + 1);
      path.push(v(p));
      normals.push(v([q[0] - p[0], 0, q[2] - p[2]]));
      continue;
    }
    const y = yBack - drop * f;
    const r = ringAt(rings, y);
    const x = base.a * Math.cos(t) * (1 + 0.3 * f);
    const u = Math.min(1, Math.abs(x) / r.a);
    const zs = r.b * (1 - u ** FORM_SE) ** (1 / FORM_SE);
    const gx = (Math.sign(x) * u ** (FORM_SE - 1)) / r.a, gz = (zs / r.b) ** (FORM_SE - 1) / r.b;
    const g = Math.hypot(gx, gz) || 1;
    path.push(v([x + (gx / g) * out, y, r.z + zs + (gz / g) * out]));
    normals.push(v([gx / g, 0, gz / g]));
  }
  path[N] = path[0];
  const yFront = yBack - drop;
  const front = path[Math.round(N / 2)];
  return { rings, path, normals, front, yFront, size, out };
}

/** How far forward the chest reaches between two heights (a pendant hanging there must clear it). */
function chestZ(rings: ReturnType<typeof bustRings>, y0: number, y1: number): number {
  let z = -Infinity;
  for (let k = 0; k <= 8; k++) z = Math.max(z, ringPoint(ringAt(rings, y0 + ((y1 - y0) * k) / 8), Math.PI / 2)[2]);
  return z;
}

function pendantLayout(c: Record<string, string>) {
  const d = drape(c);
  const s = PENDANT_SIZE[c.thickness] ?? PENDANT_SIZE.regular;
  const len = CHARMS.has(c.pendant) ? s * 1.25 : c.pendant === "none" ? 0 : s * 1.1;
  const z = Math.max(d.front[2], chestZ(d.rings, d.yFront - len, d.yFront) + 0.0025);
  const bail: V3 = [0, d.front[1], z];
  return { d, s, len, bail };
}

function kit(id: string, name: string, kitAsset: string, kitParams: Record<string, number | string>, material: PartMaterial, position: V3, rotation: V3 = [0, 0, 0], extra: Partial<Part> = {}): Part {
  const params: Record<string, number | string> = {};
  for (const [k, val] of Object.entries(kitParams)) params[k] = typeof val === "number" ? r5(val) : val;
  return { id, name, kind: "kit", kitAsset, kitParams: params, parent: "bust", transform: { position: v(position), rotation, scale: [1, 1, 1] }, material: { ...material }, ...extra };
}

function build(c: Record<string, string>): Part[] {
  const L = pendantLayout(c);
  const { d } = L;
  const parts: Part[] = [
    { id: "bust", name: "Velvet jewelry bust", kind: "kit", kitAsset: "form_bust", kitParams: { ...BUST }, parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { ...VELVET } },
    kit("chain", "Chain", "chain", { link: c.chain === "rope" || c.chain === "curb" || c.chain === "paperclip" || c.chain === "figaro" || c.chain === "box" || c.chain === "bead" ? c.chain : "cable", size: d.size }, GOLD, [0, 0, 0], [0, 0, 0], { kitPath: d.path, kitNormals: d.normals }),
  ];
  // The clasp hangs at the back of the neck, facing back.
  const back = d.path[0];
  parts.push(kit("clasp", "Clasp", "clasp", { style: c.thickness === "chunky" ? "toggle" : "lobster", size: Math.max(0.008, d.size * 3) }, GOLD, [back[0], back[1], back[2] - 0.0008], [0, 180, 0]));
  if (CHARMS.has(c.pendant)) {
    parts.push(kit("pendant", "Pendant", "charm", { shape: c.pendant, size: L.s }, GOLD, L.bail));
  } else if (c.pendant === "gem" || c.pendant === "pearl") {
    parts.push(kit("pendant", c.pendant === "gem" ? "Solitaire pendant" : "Pearl pendant", "drop", { length: L.len, charm: c.pendant, charm_size: L.s * 0.6, loop: d.size * 0.9 + 0.0012 }, GOLD, L.bail));
  }
  return parts;
}

function zones(c: Record<string, string>): Record<string, Zone> {
  const L = pendantLayout(c);
  const { d } = L;
  const N = d.path.length - 1;
  // Front third of the chain, left to right as the shopper sees it.
  const a = Math.round(N * 0.36), b = Math.round(N * 0.64);
  const out: Record<string, Zone> = {
    drop_point: { part: "bust", label: "front of the chain (pendant)", at: v(L.bail), normal: [0, 0, 1], up: [0, 1, 0] },
    chain_front: { part: "bust", label: "front of the chain", path: d.path.slice(a, b + 1), normals: d.normals.slice(a, b + 1) },
    clasp: { part: "bust", label: "clasp at the back", at: d.path[0], normal: [0, 0, -1], up: [0, 1, 0] },
  };
  if (c.pendant !== "none") {
    out.face = { part: "bust", label: "pendant front", at: v([0, L.bail[1] - L.len * 0.6, L.bail[2] + 0.002]), normal: [0, 0, 1], up: [0, 1, 0], room: [L.s * 0.7, L.s * 0.7] };
  }
  return out;
}

export const necklace: FashionTemplate = {
  id: "necklace",
  name: "Necklace",
  category: "necklace",
  kind: "jewelry",
  keywords: ["necklace", "necklaces", "chain necklace", "pendant", "pendant necklace", "choker", "gold chain", "charm necklace", "locket"],
  description: "A polished gold chain necklace on a velvet bust: cable, curb, rope, paperclip or bead chain, choker to matinee length, with a charm, solitaire or pearl pendant.",
  targetPriceUsd: 95,
  controls: {
    length: { options: ["choker", "princess", "matinee"], default: "princess", description: "choker (around the neck), princess (collarbone, 45 cm), matinee (mid-chest, 55 cm)" },
    chain: { options: ["cable", "curb", "rope", "paperclip", "figaro", "box", "bead"], default: "cable", description: "chain link style" },
    thickness: { options: ["fine", "regular", "chunky"], default: "regular", description: "link size (fine 2.4 mm, regular 3.6 mm, chunky 7 mm)" },
    pendant: { options: ["none", "heart", "star", "moon", "disc", "initial", "flower", "shell", "gem", "pearl"], default: "gem", description: "what hangs at the front: none, a charm shape, a solitaire stone or a pearl" },
  },
  slots: {
    metal: { description: "the chain, clasp and pendant metal", parts: ["chain", "clasp", "pendant"], default: GOLD },
    stone: { description: "set stones", parts: [], default: DIAMOND },
    accent: { description: "pearls and accents", parts: [], default: PEARL },
    display: { description: "the velvet bust", parts: ["bust"], default: VELVET },
  },
  build,
  zones,
  modules: [],
  display: "stand",
};
