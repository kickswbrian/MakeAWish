import type { Product } from "./product.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Coordinate frames without three.js: a part's transform is position + Euler XYZ rotation (degrees)
 * + scale in its parent's frame, exactly as the renderer composes it (T * Rx * Ry * Rz * S).
 */

const DEG = Math.PI / 180;

function rotX([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}
function rotY([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}
function rotZ([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}

/** The chain from the root down to `id` (empty if `id` is missing). */
function chain(product: Product, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: Product["parts"][string] | undefined = product.parts[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.id);
    cur = cur.parent ? product.parts[cur.parent] : undefined;
  }
  return out;
}

/** A point in part `id`'s frame, in product space. */
export function toProductSpace(product: Product, id: string, p: Vec3): Vec3 {
  let v = p;
  for (const pid of chain(product, id).reverse()) {
    const { position, rotation, scale } = product.parts[pid].transform;
    v = [v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]];
    v = rotX(rotY(rotZ(v, rotation[2] * DEG), rotation[1] * DEG), rotation[0] * DEG);
    v = [v[0] + position[0], v[1] + position[1], v[2] + position[2]];
  }
  return v;
}

/** A product-space point, in part `id`'s frame. */
export function toPartSpace(product: Product, id: string, p: Vec3): Vec3 {
  let v = p;
  for (const pid of chain(product, id)) {
    const { position, rotation, scale } = product.parts[pid].transform;
    v = [v[0] - position[0], v[1] - position[1], v[2] - position[2]];
    v = rotZ(rotY(rotX(v, -rotation[0] * DEG), -rotation[1] * DEG), -rotation[2] * DEG);
    v = [v[0] / (scale[0] || 1), v[1] / (scale[1] || 1), v[2] / (scale[2] || 1)];
  }
  return v;
}

/** Distance from a point to an axis-aligned box (0 inside). */
function boxDistance(p: Vec3, center: Vec3, size: Vec3): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d += Math.max(0, Math.abs(p[i] - center[i]) - size[i] / 2) ** 2;
  return Math.sqrt(d);
}

/**
 * Models sometimes write a new child's position in product space instead of its parent's frame
 * ("hat on the head" at the head's product-space top, which then floats a head-height higher).
 * When the position as written lands far from the parent, but the same numbers read as a
 * product-space point sit on the parent, convert them. `bounds` is the parent's product-space box.
 * Returns the corrected position, or null when it already looks right.
 */
export function fixChildFrame(product: Product, parentId: string, position: Vec3, bounds: { center: Vec3; size: Vec3 }): Vec3 | null {
  if (!product.parts[parentId]) return null;
  const extent = Math.max(...bounds.size);
  const asWritten = toProductSpace(product, parentId, position);
  if (boxDistance(asWritten, bounds.center, bounds.size) <= 0.6 * extent + 0.02) return null;
  if (boxDistance(position, bounds.center, bounds.size) > 0.25 * extent + 0.01) return null;
  return toPartSpace(product, parentId, position).map((v) => Math.round(v * 1000) / 1000) as Vec3;
}

/** A 3x3 rotation matrix, rows of columns (m[row][col]). */
export type Mat3 = number[][];

export const mulMat = (a: Mat3, b: Mat3): Mat3 => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
export const transposeMat = (a: Mat3): Mat3 => [0, 1, 2].map((r) => [a[0][r], a[1][r], a[2][r]]);
export const applyMat = (m: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as Vec3;

/** Euler XYZ (degrees) to a matrix, composed like the renderer: Rx * Ry * Rz. */
export function eulerMatrix([x, y, z]: Vec3): Mat3 {
  const [a, b, c] = [x * DEG, y * DEG, z * DEG];
  const rx: Mat3 = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const ry: Mat3 = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const rz: Mat3 = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  return mulMat(mulMat(rx, ry), rz);
}

/** A rotation matrix back to Euler XYZ degrees (three.js's decomposition), to 0.1 degree. */
export function matrixEuler(m: Mat3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  const [x, z] = Math.abs(m[0][2]) < 0.9999999 ? [Math.atan2(-m[1][2], m[2][2]), Math.atan2(-m[0][1], m[0][0])] : [Math.atan2(m[2][1], m[1][1]), 0];
  return [x, y, z].map((v) => Math.round((v / DEG) * 10) / 10) as Vec3;
}
