import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Trucker (denim) jacket over a scanned-quality base: body, two sleeves, fold-over collar and chest
 * pocket flaps, with its baked seams and topstitching kept as fold normals. Buttons, labels and
 * stitching are detail modules on zones taken from where the original hardware sat.
 */

// Sleeve axis from the shoulder point toward the cuff (model frame, meters), per side.
const SLEEVE = { r: { o: [0.2, 0.5, 0], d: [0.76, -0.65, 0] }, l: { o: [-0.2, 0.5, 0], d: [-0.76, -0.65, 0] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.7, short: 0.32 };
const LENGTH_K: Record<string, number> = { cropped: 0.67, regular: 1, long: 1.3 };
const FIT: Record<string, [number, number]> = { fitted: [0.95, 0.95], regular: [1, 1], oversized: [1.12, 1.12], boxy: [1.08, 1.02] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  // Length moves everything below the armpit (body only: sleeves hang from above it).
  if (node === "body") Object.assign(p, { ly: 0.36, lk: LENGTH_K[c.length] ?? 1 });
  if (node === "sleeve_r" || node === "sleeve_l") {
    const s = SLEEVE[node === "sleeve_r" ? "r" : "l"];
    const sk = (SLEEVE_K[c.sleeves] ?? 1) * (c.fit === "oversized" ? 1.04 : 1);
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.06, sk });
  }
  return p;
}

export const jacketTrucker = meshTemplate({
  id: "jacket_trucker",
  model: "jacket_trucker",
  name: "Trucker jacket",
  category: "jacket",
  kind: "outerwear",
  keywords: ["denim jacket", "jean jacket", "trucker jacket", "trucker", "jacket", "sherpa jacket", "corduroy jacket"],
  description: "Classic trucker jacket: pointed fold-over collar, button front, flap chest pockets, buttoned cuffs and waist tabs",
  targetPriceUsd: 90,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (cropped ends at the waist)" },
    fit: { options: ["fitted", "regular", "boxy", "oversized"], default: "regular", description: "fit through body and sleeves" },
    sleeves: { options: ["long", "three_quarter", "short"], default: "long", description: "sleeve length" },
    collar: { options: ["classic", "none"], default: "classic", description: "pointed collar or collarless" },
    flaps: { options: ["flap", "none"], default: "flap", description: "chest pocket flaps" },
  },
  slots: {
    shell: { description: "body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r", "pocket_flaps"], default: { preset: "denim", color: "#2E4A6B" } },
    collar: { description: "collar (contrast it: corduroy, sherpa)", nodes: ["collar"], default: { preset: "denim", color: "#2E4A6B" }, follows: ["lining:sherpa,fleece,corduroy,suede", "shell"] },
    hardware: { description: "buttons and rivets", nodes: [], default: { preset: "metal_brushed", color: "#B08D57" } },
    thread: { description: "topstitching", nodes: [], default: { preset: "cotton", color: "#C9892E" } },
    trim: { description: "bands, bows and trims", nodes: [], default: { preset: "denim", color: "#2E4A6B" } },
    lining: { description: "lining and inside bands", nodes: [], default: { preset: "sherpa", color: "#EDE3D1" } },
    accent: { description: "contrast details", nodes: [], default: { preset: "leather", color: "#8A4B2A" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#B3261E" } },
  },
  root: "body",
  deform,
  hide: (c) => [...(c.collar === "none" ? ["collar"] : []), ...(c.flaps === "none" ? ["pocket_flaps"] : [])],
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Collar", pocket_flaps: "Chest pocket flaps" },
  modules: [
    { module: "button", zone: "placket", params: { count: 4, style: "jeans_tack", radius: 0.0085 }, name: "Front buttons" },
    { module: "button", zone: "flap_button_*", params: { style: "jeans_tack", radius: 0.0075 }, name: "Flap button" },
    { module: "button", zone: "cuff_button_*", params: { style: "jeans_tack", radius: 0.0075 }, name: "Cuff button" },
    { module: "button", zone: "waist_button_*", params: { style: "jeans_tack", radius: 0.0075 }, name: "Waist tab button" },
    { module: "topstitch", zone: "yoke_front", params: { rows: 2 } },
    { module: "topstitch", zone: "yoke_back", params: { rows: 2 } },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
});
