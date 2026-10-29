import { isEnumParam, kitById } from "./kit.ts";
import { displayBox } from "./modules/display.ts";
import { MESH_MODELS } from "./meshes.ts";
import { subtreeIds, type Part, type Product } from "./product.ts";
import { toPartSpace, toProductSpace } from "./frames.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Approximate bounding boxes without three.js, matching how the renderer builds each geometry
 * (centered boxes, cylinders and capsules along Y, lathes around Y, extrudes centered on Z).
 * Boxes are conservative: a torus arc or a partial lathe gets its full-ring box.
 */

export interface Box { min: Vec3; max: Vec3 }

/** The part's own geometry in its local frame (before its transform). */
export function localBox(part: Part): Box | null {
  if (part.kind === "mesh") {
    const [model, node] = (part.meshAsset ?? "").split("/");
    const b = MESH_MODELS[model]?.bounds?.[node];
    return b ? { min: [...b.min], max: [...b.max] } : null;
  }
  if (part.kind === "kit") {
    const kit = part.kitAsset ? kitById(part.kitAsset) : undefined;
    if (!kit) return null;
    if (part.kitPath?.length) {
      // A path kit hugs its path: the path's box, padded by the kit's thickness.
      const pad = Math.max(0.002, Math.min(kit.size[1], kit.size[2]) / 2);
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const q of part.kitPath) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], q[i] - pad);
        max[i] = Math.max(max[i], q[i] + pad);
      }
      return { min, max };
    }
    const shown = kit.family === "display" ? displayBox(kit.id, part.kitParams) : null;
    if (shown) return shown;
    const s: Vec3 = [...kit.size];
    // Size-like params stretch the catalog box: length along X, height along Y, radius everywhere.
    for (const [name, spec] of Object.entries(kit.params ?? {})) {
      const v = part.kitParams?.[name];
      if (typeof v !== "number" || isEnumParam(spec) || !spec.default) continue;
      const k = v / spec.default;
      if (name === "length") s[0] *= k;
      else if (name === "height") s[1] *= k;
      else if (name === "radius") for (let i = 0; i < 3; i++) s[i] *= k;
    }
    return { min: [-s[0] / 2, -s[1] / 2, -s[2] / 2], max: [s[0] / 2, s[1] / 2, s[2] / 2] };
  }
  const g = part.geometry;
  if (!g) return null;
  const sym = (x: number, y: number, z: number): Box => ({ min: [-x, -y, -z], max: [x, y, z] });
  switch (g.type) {
    case "roundedBox":
      return sym(g.params.width / 2, g.params.height / 2, g.params.depth / 2);
    case "cylinder": {
      const r = Math.max(g.params.radiusTop, g.params.radiusBottom);
      return sym(r, g.params.height / 2, r);
    }
    case "capsule":
      return sym(g.params.radius, g.params.length / 2 + g.params.radius, g.params.radius);
    case "sphere": {
      const r = g.params.radius;
      // A dome sweeps down from the top: angle 90 stops at the equator.
      const low = g.params.angle >= 90 ? (g.params.angle >= 180 ? -r : -r * Math.sin(((g.params.angle - 90) * Math.PI) / 180)) : r * Math.cos((g.params.angle * Math.PI) / 180);
      const w = g.params.angle >= 90 ? r : r * Math.sin((g.params.angle * Math.PI) / 180);
      return { min: [-w, low, -w], max: [w, r, w] };
    }
    case "torus": {
      const o = g.params.radius + g.params.tube;
      return sym(o, o, g.params.tube);
    }
    case "lathe": {
      const pts = g.params.points;
      const r = Math.max(...pts.map((p) => p[0])) * (1 + (g.params.fluteDepth ?? 0));
      return { min: [-r, Math.min(...pts.map((p) => p[1])), -r], max: [r, Math.max(...pts.map((p) => p[1])), r] };
    }
    case "extrude": {
      const xs = g.params.shape.map((p) => p[0]), ys = g.params.shape.map((p) => p[1]);
      const b = g.params.bevel ?? 0;
      return { min: [Math.min(...xs) - b, Math.min(...ys) - b, -g.params.depth / 2], max: [Math.max(...xs) + b, Math.max(...ys) + b, g.params.depth / 2] };
    }
    case "tube": {
      const r = g.params.width ? Math.max(g.params.width / 2, g.params.radius) : g.params.radius;
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const p of g.params.points) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i] - r);
        max[i] = Math.max(max[i], p[i] + r);
      }
      return { min, max };
    }
  }
  return null;
}

/** The part's own geometry, as an axis-aligned box in product space. */
export function partBox(product: Product, id: string): Box | null {
  const part = product.parts[id];
  const local = part && localBox(part);
  if (!local) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const corner: Vec3 = [c & 1 ? local.max[0] : local.min[0], c & 2 ? local.max[1] : local.min[1], c & 4 ? local.max[2] : local.min[2]];
    const p = toProductSpace(product, id, corner);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return { min, max };
}

/** Distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box, b: Box): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d += Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]) ** 2;
  return Math.sqrt(d);
}

/** Cutters: parts that only exist to be carved out of another part (`csg.withPartId`), never drawn. */
function cutterIds(product: Product): Set<string> {
  return new Set(Object.values(product.parts).filter((p) => p.csg).map((p) => p.id));
}

/** The whole product's box. */
export function productBox(product: Product): Box | null {
  const cutters = cutterIds(product);
  let out: Box | null = null;
  for (const id of Object.keys(product.parts)) {
    if (cutters.has(id)) continue;
    const b = partBox(product, id);
    if (!b) continue;
    out = out ? { min: out.min.map((v, i) => Math.min(v, b.min[i])) as Vec3, max: out.max.map((v, i) => Math.max(v, b.max[i])) as Vec3 } : b;
  }
  return out;
}

/** How far a gap must be before a part counts as floating: a few mm, more on big products. */
function contactTolerance(product: Product): number {
  const b = productBox(product);
  const extent = b ? Math.max(...b.max.map((v, i) => v - b.min[i])) : 0.3;
  return Math.max(0.004, 0.012 * extent);
}

/**
 * Parts that touch nothing: not their parent, not any other part outside their own subtree.
 * Children of a floating part come along with it, so only the topmost floating part is listed.
 */
export function floatingParts(product: Product, only?: Iterable<string>): string[] {
  const tol = contactTolerance(product);
  const cutters = cutterIds(product);
  const boxes = new Map<string, Box>();
  for (const id of Object.keys(product.parts)) {
    if (cutters.has(id)) continue;
    const b = partBox(product, id);
    if (b) boxes.set(id, b);
  }
  const out: string[] = [];
  const candidates = only ? [...only] : Object.keys(product.parts);
  for (const id of candidates) {
    const part = product.parts[id];
    const box = boxes.get(id);
    if (!part?.parent || !box) continue;
    const mine = new Set(subtreeIds(product, id));
    let touching = false;
    for (const [other, b] of boxes) {
      if (mine.has(other)) continue;
      if (boxGap(box, b) <= tol) {
        touching = true;
        break;
      }
    }
    if (!touching) out.push(id);
  }
  return out;
}

/**
 * Where a floating part should go (a new position in its parent's frame), or null when it touches
 * something already. Two fixes, in order:
 *  1. the position was written in product space instead of the parent's frame (a common slip):
 *     read it that way if that lands it on the product;
 *  2. otherwise slide it straight toward the nearest part until it sits a little into its surface.
 */
export function groundPart(product: Product, id: string): Vec3 | null {
  const part = product.parts[id];
  if (!part?.parent || !product.parts[part.parent]) return null;
  const tol = contactTolerance(product);
  const cutters = cutterIds(product);
  const mine = new Set(subtreeIds(product, id));
  const others: Box[] = [];
  for (const oid of Object.keys(product.parts)) {
    if (mine.has(oid) || cutters.has(oid)) continue;
    const b = partBox(product, oid);
    if (b) others.push(b);
  }
  const box = partBox(product, id);
  if (!box || !others.length) return null;
  const nearest = (b: Box) => others.reduce((best, o) => (boxGap(b, o) < boxGap(b, best) ? o : best), others[0]);
  if (boxGap(box, nearest(box)) <= tol) return null;

  const round = (v: Vec3) => v.map((x) => Math.round(x * 1000) / 1000) as Vec3;
  const at = (position: Vec3): Product => ({ ...product, parts: { ...product.parts, [id]: { ...part, transform: { ...part.transform, position } } } });

  // 1. Product-space slip.
  const asProduct = round(toPartSpace(product, part.parent, part.transform.position));
  const slipped = partBox(at(asProduct), id);
  if (slipped && boxGap(slipped, nearest(slipped)) <= tol) return asProduct;

  // 2. Slide toward the nearest part, along each separated axis, sinking in by a fifth of the
  //    part's own thickness on that axis (capped) so curved surfaces still meet it.
  const target = nearest(box);
  const delta: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const sink = Math.min(0.2 * (box.max[i] - box.min[i]), 0.01);
    if (box.min[i] > target.max[i]) delta[i] = target.max[i] - box.min[i] - sink;
    else if (box.max[i] < target.min[i]) delta[i] = target.min[i] - box.max[i] + sink;
  }
  const origin = toProductSpace(product, part.parent, part.transform.position);
  return round(toPartSpace(product, part.parent, [origin[0] + delta[0], origin[1] + delta[1], origin[2] + delta[2]]));
}
