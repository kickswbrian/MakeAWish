import { eulerMatrix, matrixEuler, mulMat, toPartSpace, toProductSpace, transposeMat, type Mat3 } from "./frames.ts";
import { partsInOrder, type Product } from "./product.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Children don't inherit a squash. Models flatten a part with a non-uniform scale (a daisy's center
 * at [1, 0.6, 1]) and then hang parts off it; every child inherits the squash, so tilted petals come
 * out sheared, stretched and out of place. A new part under such a parent is re-attached one level up,
 * exactly where it is now and with the same orientation, keeping only the uniform part of the squash.
 */

const nonUniform = (s: Vec3) => Math.max(...s) / Math.max(1e-9, Math.min(...s)) > 1.05;

/** Rotation of part `id`'s frame in product space (columns = its axes), scale removed. */
function frameRotation(product: Product, id: string): Mat3 {
  const o = toProductSpace(product, id, [0, 0, 0]);
  const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => {
    const p = toProductSpace(product, id, e);
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((x) => x / n);
  });
  return [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]);
}

type Update = { op: "update"; id: string; changes: { parent: string; transform: { position: Vec3; rotation: Vec3; scale: Vec3 } } };

/** Updates that lift the new parts among `added` off squashed parents (parents first). */
export function unshear(product: Product, added: Iterable<string>, apply: (p: Product, u: Update) => Product): Update[] {
  const fresh = new Set(added);
  const out: Update[] = [];
  let work = product;
  for (const part of partsInOrder(product)) {
    const c = work.parts[part.id];
    const p = c?.parent ? work.parts[c.parent] : undefined;
    // Only parts this turn wrote, under a squashed parent that itself has a parent to lift onto.
    if (!c || !fresh.has(c.id) || !p?.parent || !work.parts[p.parent] || !nonUniform(p.transform.scale)) continue;
    const up = p.parent;
    const position = toPartSpace(work, up, toProductSpace(work, c.id, [0, 0, 0])).map((v) => Math.round(v * 10000) / 10000) as Vec3;
    // The orientation it was meant to have: the parent's (unsquashed) rotation, then its own.
    const world = mulMat(frameRotation(work, p.id), eulerMatrix(c.transform.rotation));
    const rotation = matrixEuler(mulMat(transposeMat(frameRotation(work, up)), world));
    const k = Math.cbrt(p.transform.scale[0] * p.transform.scale[1] * p.transform.scale[2]);
    const scale = c.transform.scale.map((v) => Math.round(v * k * 1000) / 1000) as Vec3;
    const u: Update = { op: "update", id: c.id, changes: { parent: up, transform: { position, rotation, scale } } };
    work = apply(work, u);
    out.push(u);
  }
  return out;
}
