import type { DeformParams } from "../../deform.ts";
import { meshTemplate } from "../mesh-template.ts";

/**
 * Down puffer jacket over a 3D scan: horizontal baffle channels are in the geometry, the scan's
 * hoodie is cut away above the funnel collar, and the collar binding, center-front zip and the zipped hand and
 * chest pockets are detail modules.
 */

// Sleeve axis from the shoulder toward the cuff (model frame, meters): arms out and slightly forward.
const SLEEVE = { r: { o: [0.25, 0.47, 0.02], d: [0.836, -0.505, 0.211] }, l: { o: [-0.25, 0.48, 0.03], d: [-0.843, -0.499, 0.203] } } as const;
const SLEEVE_K: Record<string, number> = { long: 1, three_quarter: 0.72 };
const LENGTH_K: Record<string, number> = { cropped: 0.68, regular: 1, long: 1.6 };
const FIT: Record<string, [number, number]> = { fitted: [0.94, 0.94], regular: [1, 1], oversized: [1.1, 1.12] };

function deform(c: Record<string, string>, node: string): DeformParams {
  const [fx, fz] = FIT[c.fit] ?? [1, 1];
  const p: DeformParams = { fx, fz };
  if (node === "sleeve_r" || node === "sleeve_l") {
    const s = SLEEVE[node === "sleeve_r" ? "r" : "l"];
    // s0 sits past the armhole split so the seam with the body never moves.
    Object.assign(p, { sox: s.o[0], soy: s.o[1], soz: s.o[2], sdx: s.d[0], sdy: s.d[1], sdz: s.d[2], s0: 0.09, sk: SLEEVE_K[c.sleeves] ?? 1 });
  } else {
    Object.assign(p, { ly: 0.33, lk: LENGTH_K[c.length] ?? 1 });
  }
  return p;
}

export const jacketPuffer = meshTemplate({
  id: "jacket_puffer",
  model: "jacket_puffer",
  name: "Puffer jacket",
  category: "jacket",
  kind: "outerwear",
  keywords: ["puffer", "puffer jacket", "down jacket", "quilted jacket", "puffy coat", "puffer coat", "down coat"],
  description: "Channel-quilted down puffer: stand collar, center-front zip, zipped hand pockets and a zipped chest pocket",
  targetPriceUsd: 150,
  controls: {
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "body length (long is a knee-length puffer coat)" },
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "fit and puffiness through body and sleeves" },
    sleeves: { options: ["long", "three_quarter"], default: "long", description: "sleeve length" },
  },
  slots: {
    shell: { description: "quilted body and sleeves", nodes: ["body", "sleeve_l", "sleeve_r", "collar"], default: { preset: "nylon", color: "#1C1D21" } },
    hardware: { description: "zippers", nodes: [], default: { preset: "plastic_matte", color: "#1A1A1C" } },
    trim: { description: "collar and bands", nodes: [], default: { preset: "nylon", color: "#1C1D21" } },
    lining: { description: "lining", nodes: [], default: { preset: "nylon", color: "#2B2D33" } },
    thread: { description: "stitching", nodes: [], default: { preset: "cotton", color: "#1C1D21" } },
    accent: { description: "contrast details (zip pulls, trims)", nodes: [], default: { preset: "nylon", color: "#C2462B" } },
    label: { description: "labels and tags", nodes: [], default: { preset: "cotton", color: "#1A1A1C" } },
  },
  root: "body",
  deform,
  names: { body: "Body", sleeve_l: "Left sleeve", sleeve_r: "Right sleeve", collar: "Stand collar" },
  modules: [
    // The scan's collar is cut just under the hood line: a bound edge covers the cut.
    { module: "rib_band", zone: "collar", params: { height: 0.042, thickness: 0.006, pitch: 0.01, rib: "1x1", align: "center" }, name: "Collar binding", material: "shell" },
    { module: "topstitch", zone: "neckline", params: { rows: 1 }, name: "Collar seam" },
    { module: "zipper_path", zone: "placket", params: { style: "plastic", pull: "tab", tape: "auto", tape_width: 0.005 }, name: "Front zip" },
    { module: "zipper_path", zone: "pocket_front_*", params: { style: "invisible", pull: "cord" }, name: "Hand pocket zip" },
    { module: "zipper_path", zone: "chest_right_zip", params: { style: "invisible", pull: "cord" }, name: "Chest pocket zip" },
    // Baffle seams: sunk stitch lines in the scan's channel valleys (front) and the same 5 cm pitch on the back.
    { module: "quilting_stitch", zone: "quilt_front_*", params: { pitch: 0.003 }, name: "Front baffle seam" },
    { module: "quilting_stitch", zone: "quilt_back_*", params: { pitch: 0.003 }, name: "Back baffle seam" },
    { module: "woven_label", zone: "neck_label" },
  ],
  display: "form",
});
