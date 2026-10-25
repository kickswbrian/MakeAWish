import { deformNormal, deformPoint, type DeformParams } from "../../deform.ts";
import type { V3, Zone } from "../../types.ts";

/**
 * Zone helpers shared by the bag templates (garments/<bag>.ts). The prep script finds points, lines
 * and rings by raycasting; these cover what raycasts can't: a handle's arc (probed offline from the
 * mesh and listed in the template), the four base feet as one path, and a rim stitch line that keeps
 * a constant distance under a top edge that dips at the center.
 */

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v4 = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A path zone from model-frame points and normals, run through the part's deformer. */
export function deformedPath(part: string, label: string, path: V3[], normals: V3[], params: DeformParams): Zone {
  return {
    part,
    label,
    path: path.map((p) => v4(deformPoint(p, params))),
    normals: path.map((p, i) => v4(deformNormal(p, unit(normals[i] ?? [0, 0, 1]), params))),
  };
}

/** A point zone from a model-frame point and normal, run through the part's deformer. */
export function deformedPoint(part: string, label: string, at: V3, normal: V3, params: DeformParams, extra: Partial<Zone> = {}): Zone {
  return { part, label, at: v4(deformPoint(at, params)), normal: v4(deformNormal(at, unit(normal), params)), ...extra };
}

/**
 * base_corners: one path through four feet at (+-a, y, +-b) on a flat base, laid out so the style
 * compiler's evenly spread copies land on the corners: count 4 (default inset 0.08) hits the four
 * corners and count 5 adds one near the middle. The run from the front-right to the back-right foot
 * detours inward so every corner-to-corner run has the same length (2a).
 */
export function baseCorners(part: string, a: number, b: number, y: number, cx = 0, cz = 0): Zone {
  const s = 2 * a;
  const h = Math.sqrt(Math.max(0, a * a - b * b));
  const e = (0.08 * 3 * s) / 0.84;
  const path: V3[] = (
    [[-a + e, y, b], [-a, y, b], [a, y, b], [a - h, y, 0], [a, y, -b], [-a, y, -b], [-a + e, y, -b]] as V3[]
  ).map(([x, py, z]): V3 => [x + cx, py, z + cz]);
  return { part, label: "base corners (feet)", path: path.map(v4), normals: path.map((): V3 => [0, -1, 0]) };
}

/** Base corners after deformation (the feet follow size and shape). */
export function deformedCorners(part: string, a: number, b: number, y: number, params: DeformParams, cx = 0, cz = 0): Zone {
  const z = baseCorners(part, a, b, y, cx, cz);
  return { ...z, path: z.path!.map((p) => v4(deformPoint(p, params))), normals: z.normals };
}

/**
 * Slide each point of a surface path along the surface (its tangent plane, toward +Y) until it sits
 * at `target(p)` height: a ring cast at one height becomes a line at constant depth under a curved rim.
 */
export function followHeight(zone: Zone, target: (p: V3) => number): Zone {
  if (!zone.path || !zone.normals) return zone;
  const path = zone.path.map((p, i): V3 => {
    const n = unit(zone.normals![i] ?? [0, 0, 1]);
    // Up projected into the tangent plane.
    const u = unit([-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]]);
    if (u[1] < 0.3) return p;
    const k = (target(p) - p[1]) / u[1];
    return v4([p[0] + u[0] * k, p[1] + u[1] * k, p[2] + u[2] * k]);
  });
  return { ...zone, path };
}
