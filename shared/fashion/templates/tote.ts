import { toteBag, TOTE_GEOMETRY as G } from "../../templates/tote_bag.ts";
import type { Part } from "../../product.ts";
import type { FashionTemplate, V3, Zone } from "../types.ts";

/**
 * The structured tote as a fashion template: the hand-built tote body (tapered extrusion with a
 * leather rim, base and riveted handles) plus zones and controls. Size scales the whole bag; zones
 * live in the body's frame so they scale with it.
 */

const SIZE: Record<string, number> = { mini: 0.62, small: 0.82, medium: 1, large: 1.18 };
const BASE = toteBag!.parts;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v4 = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const sideNormal = (sx: number): V3 => {
  const t = Math.tan((G.SLANT * Math.PI) / 180);
  const l = Math.hypot(1, t);
  return v4([sx / l, -t / l, 0]);
};

function zones(): Record<string, Zone> {
  const F = G.FRONT + 0.0004;
  const handle = (s: number): Zone => {
    const path = G.handlePath(s);
    return { part: `handle_${s > 0 ? "f" : "b"}`, label: `${s > 0 ? "front" : "back"} handle`, path: path.map(v4), normals: path.map((): V3 => [0, 0, s]) };
  };
  const rimY = G.YT - G.TRIM_H - 0.002;
  const front = (y: number): V3[] => Array.from({ length: 13 }, (_, i) => v4([-G.hw(y) + 0.012 + ((2 * G.hw(y) - 0.024) * i) / 12, y, F + G.SKIN]));
  const out: Record<string, Zone> = {
    front_center: { part: "tote_body", label: "front center", at: [0, 0.035, F], normal: [0, 0, 1], room: [0.2, 0.1] },
    front_panel: { part: "tote_body", label: "front panel", at: [0, -0.015, F], normal: [0, 0, 1], room: [0.24, 0.15] },
    back_panel: { part: "tote_body", label: "back panel", at: [0, -0.015, -F], normal: [0, 0, -1], room: [0.24, 0.15] },
    handle_front: handle(1),
    handle_back: handle(-1),
    top_edge: { part: "tote_body", label: "front rim edge", path: front(G.YT - 0.004), normals: front(G.YT).map((): V3 => [0, 0, 1]) },
    edge_front: { part: "tote_body", label: "front rim seam", path: front(rimY), normals: front(rimY).map((): V3 => [0, 0, 1]) },
    zip_top: {
      part: "tote_body", label: "top opening",
      path: [[-G.hw(G.YT) + 0.03, G.YT + 0.001, 0], [G.hw(G.YT) - 0.03, G.YT + 0.001, 0]],
      normals: [[0, 1, 0], [0, 1, 0]],
    },
  };
  for (const [sx, k] of [[-1, "left"], [1, "right"]] as const) {
    const y = 0.02, ya = G.YT - 0.03;
    out[`side_${k}`] = { part: "tote_body", label: `${k} side`, at: v4([sx * G.hw(y), y, 0]), normal: sideNormal(sx), room: [0.1, 0.12] };
    out[`strap_anchor_${k}`] = { part: "tote_body", label: `${k} strap anchor`, at: v4([sx * G.hw(ya), ya, 0]), normal: sideNormal(sx) };
    for (const [sz, kz] of [[1, "front"], [-1, "back"]] as const) {
      out[`foot_${kz}_${k}`] = { part: "tote_body", label: `${kz} ${k} foot`, at: v4([sx * (G.HB - 0.035), G.YB - 0.0012, sz * (G.FRONT - 0.03)]), normal: [0, -1, 0], up: [0, 0, 1] };
    }
  }
  return out;
}

export const tote: FashionTemplate = {
  id: "tote_bag",
  name: "Structured tote",
  category: "tote bag",
  kind: "bag",
  keywords: ["canvas tote", "shopper", "shopper bag", "beach tote", "grocery tote", "market tote", "shopping bag", "beach bag", "market bag"],
  description: "Structured tote with a bound rim, reinforced base and riveted handles",
  targetPriceUsd: 85,
  controls: {
    size: { options: ["mini", "small", "medium", "large"], default: "medium", description: "overall size" },
  },
  slots: {
    shell: { description: "body panels", parts: ["tote_body"], default: { preset: "canvas", color: "#2F3B52" } },
    trim: { description: "rim band, base and handle tabs", parts: ["rim_trim", "base_panel", "handle_tab_f_l", "handle_tab_f_r", "handle_tab_b_l", "handle_tab_b_r"], default: { preset: "leather", color: "#9C5B32" } },
    handle: { description: "handles", parts: ["handle_f", "handle_b"], default: { preset: "leather", color: "#9C5B32" } },
    lining: { description: "inside pocket and lining", parts: ["inner_pocket"], default: { preset: "canvas", color: "#E4D8C0" } },
    hardware: { description: "rivets, snap, rings, feet", parts: [], default: { preset: "metal_polished", color: "#C9A45C" } },
    thread: { description: "stitching", parts: [], default: { preset: "cotton", color: "#E4D8C0" } },
    accent: { description: "accents (scarf, charm)", parts: [], default: { preset: "satin", color: "#E8798E" } },
    label: { description: "labels and patches", parts: ["brand_patch"], default: { preset: "leather", color: "#9C5B32" } },
  },
  build: (c) => {
    const s = SIZE[c.size] ?? 1;
    return BASE.map((p): Part => (p.parent === null ? { ...p, transform: { ...p.transform, scale: [s, s, s] } } : p));
  },
  zones,
  modules: [],
  display: "pedestal",
};
