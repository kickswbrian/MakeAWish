import type { KitEntry } from "../kit.ts";

/**
 * Display forms and stands for fashion templates: the dress form a jacket is shown on, the hip form
 * under a skirt, the cap inside a waistband. Templates add them as base parts in their "display" slot,
 * sized from the garment; they are presentation, not part of the product.
 */
export const DISPLAY: KitEntry[] = [
  {
    id: "form_torso",
    name: "Dress form torso",
    description: "Fabric-covered dress form torso (hip to shoulders) with a neck and turned wood neck cap; origin at the bottom center, +Y up, +Z front.",
    size: [0.34, 0.62, 0.24],
    attach: {},
    material: "linen",
    family: "display",
    categories: ["any"],
    slot: "display",
    params: {
      width: { default: 0.34, min: 0.16, max: 0.6, description: "shoulder width" },
      depth: { default: 0.22, min: 0.1, max: 0.4, description: "chest depth" },
      height: { default: 0.52, min: 0.2, max: 0.9, description: "hip to shoulder line" },
      neck: { default: 0.1, min: 0.02, max: 0.2, description: "neck length above the shoulders" },
    },
  },
  {
    id: "form_hip",
    name: "Hip form",
    description: "Fabric-covered skirt/trouser form from the upper thigh to the waist with a wood waist cap; origin at the bottom center, +Y up, +Z front.",
    size: [0.32, 0.26, 0.22],
    attach: {},
    material: "linen",
    family: "display",
    categories: ["any"],
    slot: "display",
    params: {
      width: { default: 0.32, min: 0.12, max: 0.6, description: "hip width" },
      depth: { default: 0.22, min: 0.08, max: 0.4, description: "hip depth" },
      height: { default: 0.26, min: 0.06, max: 0.6, description: "height (bottom to waist cap)" },
      waist: { default: 0.82, min: 0.6, max: 1, description: "waist width as a fraction of the hips" },
    },
  },
  {
    id: "form_bust",
    name: "Jewelry bust",
    description: "Velvet jewelry display bust (chest, sloped shoulders and a tall neck) for necklaces; origin at the bottom center, +Y up, +Z front.",
    size: [0.2, 0.27, 0.11],
    attach: {},
    material: "velvet",
    family: "display",
    categories: ["any"],
    slot: "display",
    params: {
      width: { default: 0.2, min: 0.1, max: 0.36, description: "shoulder width" },
      height: { default: 0.27, min: 0.12, max: 0.45, description: "base to neck top" },
      neck: { default: 0.03, min: 0.018, max: 0.05, description: "neck radius" },
    },
  },
  {
    id: "form_stand",
    name: "Form stand",
    description: "Dress-form stand from the floor up: weighted round base or tripod, brushed pole and collar; origin at the floor center, pole up +Y to `height`.",
    size: [0.36, 0.5, 0.36],
    attach: {},
    material: "metal_brushed",
    family: "display",
    categories: ["any"],
    params: {
      height: { default: 0.5, min: 0.05, max: 1.6, description: "pole top above the floor" },
      base: { default: 0.17, min: 0.08, max: 0.3, description: "base radius" },
      style: { options: ["round", "tripod"], default: "round", description: "weighted round base or three wood legs" },
    },
  },
];

/** A cross-section of a display form: superellipse half-width a (x), half-depth b (z), center offset z. */
export interface FormRing {
  y: number;
  a: number;
  b: number;
  z: number;
}

/** Superellipse exponent of every display form's cross-sections. */
export const FORM_SE = 2.5;

/** Jewelry bust cross-sections, bottom to top (shared by the builder and the necklace drape). */
export function bustRings(p: { width: number; height: number; neck: number }): FormRing[] {
  const W = p.width / 2, D = W * 0.56, H = p.height, n = p.neck;
  const neckY = H * 0.7;
  return [
    { y: 0, a: 0.6 * W, b: 0.78 * D, z: 0 },
    { y: 0.18 * H, a: 0.66 * W, b: 0.88 * D, z: 0.02 * D },
    { y: 0.36 * H, a: 0.8 * W, b: 0.98 * D, z: 0.06 * D },
    { y: 0.48 * H, a: 0.94 * W, b: 0.94 * D, z: 0.05 * D },
    { y: 0.54 * H, a: 0.99 * W, b: 0.84 * D, z: 0.02 * D },
    { y: 0.575 * H, a: 0.95 * W, b: 0.74 * D, z: 0 },
    { y: 0.605 * H, a: 0.8 * W, b: 0.64 * D, z: -0.03 * D },
    { y: 0.635 * H, a: 0.6 * W, b: 0.56 * D, z: -0.06 * D },
    { y: 0.665 * H, a: Math.max(n * 1.7, 0.38 * W), b: Math.max(n * 1.45, 0.48 * D), z: -0.09 * D },
    { y: neckY, a: n * 1.2, b: n * 1.12, z: -0.1 * D },
    { y: neckY + 0.025, a: n * 1.02, b: n * 0.98, z: -0.1 * D },
    { y: H, a: n * 0.96, b: n * 0.93, z: -0.1 * D },
  ];
}

/** The ring at height y, interpolated between the profile's rings. */
export function ringAt(rings: FormRing[], y: number): FormRing {
  if (y <= rings[0].y) return { ...rings[0], y };
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    if (y <= r1.y) {
      const t = (y - r0.y) / Math.max(1e-6, r1.y - r0.y);
      return { y, a: r0.a + (r1.a - r0.a) * t, b: r0.b + (r1.b - r0.b) * t, z: r0.z + (r1.z - r0.z) * t };
    }
  }
  return { ...rings[rings.length - 1], y };
}

/** Point on a form ring at angle t (0 = +x, PI/2 = front), pushed `out` meters off the surface. */
export function ringPoint(r: FormRing, t: number, out = 0): [number, number, number] {
  const c = Math.cos(t), s = Math.sin(t), e = 2 / FORM_SE;
  const x = r.a * Math.sign(c) * Math.abs(c) ** e, z = r.b * Math.sign(s) * Math.abs(s) ** e;
  // Outward normal of the superellipse (|x/a|^SE + |z/b|^SE = 1), gradient direction.
  const gx = (Math.sign(x) * Math.abs(x / r.a) ** (FORM_SE - 1)) / r.a, gz = (Math.sign(z) * Math.abs(z / r.b) ** (FORM_SE - 1)) / r.b;
  const g = Math.hypot(gx, gz) || 1;
  return [x + (gx / g) * out, r.y, r.z + z + (gz / g) * out];
}

/** Display kits stand on their origin (bottom center) instead of centering on it: their local box. */
export function displayBox(id: string, p: Record<string, number | string | boolean> | undefined): { min: [number, number, number]; max: [number, number, number] } | null {
  const n = (k: string, d: number) => (typeof p?.[k] === "number" ? (p[k] as number) : d);
  if (id === "form_torso") return { min: [-n("width", 0.34) / 2, -0.03, -n("depth", 0.22) / 2], max: [n("width", 0.34) / 2, n("height", 0.52) + n("neck", 0.1) + 0.06, n("depth", 0.22) / 2] };
  if (id === "form_hip") return { min: [-n("width", 0.32) / 2, -0.03, -n("depth", 0.22) / 2], max: [n("width", 0.32) / 2, n("height", 0.26) + 0.045, n("depth", 0.22) / 2] };
  if (id === "form_bust") {
    const w = n("width", 0.2);
    return { min: [-w / 2, -0.012, -w * 0.3], max: [w / 2, n("height", 0.27) + 0.002, w * 0.3] };
  }
  if (id === "form_stand") return { min: [-n("base", 0.17), 0, -n("base", 0.17)], max: [n("base", 0.17), n("height", 0.5), n("base", 0.17)] };
  return null;
}
