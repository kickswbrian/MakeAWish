import type { V3 } from "./types.ts";

/**
 * Smooth deformers for prepared base meshes (kind "mesh" parts), driven by the part's kitParams.
 * The renderer runs them on every vertex and the templates run them on their zone points, so
 * details stay glued to the garment when it is cropped, widened or re-shaped.
 *
 * Params (all optional, meters / factors, in the part's frame):
 *  - ly, lk: length. Points below height ly move away from it by factor lk (0.7 = cropped).
 *  - sox, soy, soz, sdx, sdy, sdz, s0, sk: sleeve. Along the axis from origin so in unit direction sd,
 *    points farther than s0 move outward by factor sk (0.45 = short sleeve, 1.1 = long).
 *  - lgx, lgz, lgy0, lgy1, lgk0, lgk1: leg shape. Radial scale about the vertical leg axis at (lgx, lgz):
 *    lgk0 at height lgy0, lgk1 at lgy1, smooth in between (wide leg: lgk1 > 1 at the hem).
 *  - fx, fz, fy0: fit. Width/depth scale about the Y axis (oversized > 1), fading in above fy0 so a
 *    waistband can stay put.
 */
export type DeformParams = Record<string, number | boolean | string | undefined>;

const num = (p: DeformParams, k: string): number | undefined => {
  const v = p[k];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const smooth = (a: number, b: number, x: number) => {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** True when the params ask for any deformation. */
export function hasDeform(p: DeformParams | undefined): boolean {
  if (!p) return false;
  return ["lk", "sk", "lgk0", "lgk1", "fx", "fz"].some((k) => {
    const v = num(p, k);
    return v !== undefined && Math.abs(v - 1) > 1e-6;
  });
}

export function deformPoint(q: V3, p: DeformParams): V3 {
  let [x, y, z] = q;
  const ly = num(p, "ly"), lk = num(p, "lk");
  if (ly !== undefined && lk !== undefined && y < ly) y = ly - (ly - y) * lk;

  const sk = num(p, "sk");
  if (sk !== undefined) {
    const o: V3 = [num(p, "sox") ?? 0, num(p, "soy") ?? 0, num(p, "soz") ?? 0];
    let d: V3 = [num(p, "sdx") ?? 0, num(p, "sdy") ?? -1, num(p, "sdz") ?? 0];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / l, d[1] / l, d[2] / l];
    const s0 = num(p, "s0") ?? 0;
    const s = (x - o[0]) * d[0] + (y - o[1]) * d[1] + (z - o[2]) * d[2];
    if (s > s0) {
      const push = (s - s0) * (sk - 1);
      x += d[0] * push;
      y += d[1] * push;
      z += d[2] * push;
    }
  }

  const k0 = num(p, "lgk0"), k1 = num(p, "lgk1");
  if (k0 !== undefined || k1 !== undefined) {
    const ax = num(p, "lgx") ?? 0, az = num(p, "lgz") ?? 0;
    const f = (k0 ?? 1) + ((k1 ?? 1) - (k0 ?? 1)) * smooth(num(p, "lgy0") ?? 0, num(p, "lgy1") ?? 0, y);
    x = ax + (x - ax) * f;
    z = az + (z - az) * f;
  }

  const fx = num(p, "fx"), fz = num(p, "fz");
  if (fx !== undefined || fz !== undefined) {
    const fy0 = num(p, "fy0");
    const w = fy0 === undefined ? 1 : smooth(fy0, fy0 + 0.06, y);
    x *= 1 + ((fx ?? 1) - 1) * w;
    z *= 1 + ((fz ?? 1) - 1) * w;
  }
  return [x, y, z];
}

/** The deformed surface normal at a point (inverse-transpose of the local Jacobian, numerically). */
export function deformNormal(q: V3, n: V3, p: DeformParams, eps = 1e-3): V3 {
  const col = (i: number): V3 => {
    const a: V3 = [...q], b: V3 = [...q];
    a[i] -= eps;
    b[i] += eps;
    const da = deformPoint(a, p), db = deformPoint(b, p);
    return [(db[0] - da[0]) / (2 * eps), (db[1] - da[1]) / (2 * eps), (db[2] - da[2]) / (2 * eps)];
  };
  const [c0, c1, c2] = [col(0), col(1), col(2)];
  // Cofactor matrix of J = (J^-T) * det(J); the scale doesn't matter for a direction.
  const r0: V3 = [c1[1] * c2[2] - c1[2] * c2[1], c1[2] * c2[0] - c1[0] * c2[2], c1[0] * c2[1] - c1[1] * c2[0]];
  const r1: V3 = [c2[1] * c0[2] - c2[2] * c0[1], c2[2] * c0[0] - c2[0] * c0[2], c2[0] * c0[1] - c2[1] * c0[0]];
  const r2: V3 = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
  const out: V3 = [r0[0] * n[0] + r1[0] * n[1] + r2[0] * n[2], r0[1] * n[0] + r1[1] * n[1] + r2[1] * n[2], r0[2] * n[0] + r1[2] * n[1] + r2[2] * n[2]];
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / l, out[1] / l, out[2] / l];
}
