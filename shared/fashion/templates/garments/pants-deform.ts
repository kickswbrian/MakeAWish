import { deformNormal, deformPoint, type DeformParams } from "../../deform.ts";
import type { V3, Zone } from "../../types.ts";

/**
 * Shared shape controls for trousers and jeans over a prepared model (waistband + leg_l + leg_r).
 * Every node gets the same vertical mapping, so the pieces never part at their seams:
 *  - rise scales the crotch-to-waist depth about the waistband (the waistband and the display form
 *    stay put, the crotch moves), via the length deformer pivoting at the waist;
 *  - length then scales the inseam below the new crotch (the sleeve deformer pointing down);
 * and each leg is narrowed or widened about its own vertical axis below the crotch (1 at the crotch,
 * the chosen factor at the hem), with fit as a plain width/depth scale.
 */
export interface PantsShape {
  /** Height kept fixed by rise changes (inside the waistband). */
  waist: number;
  crotch: number;
  knee: number;
  /** Lowest point of the hem. */
  hem: number;
  /** Leg nodes: vertical axis (x, z) for narrowing, and the inseam-side x for flaring outward. */
  legs: Record<string, { x: number; z: number; inner: number }>;
}

export interface PantsLook {
  /** Crotch-to-waist depth factor (1 = as modeled). */
  rise: number;
  /** Inseam factor: 1 = the hem stays where the model has it (on the floor) whatever the rise. */
  length: number;
  /** Hem width factor relative to the model (1 = as modeled). */
  hemWidth: number;
  /** Widen from the knee down only (flare / bootcut), around the inseam side. */
  flare?: boolean;
  fx?: number;
  fz?: number;
}

/** Crotch height after the rise change, and the inseam stretch that puts the hem at `length` x its place. */
function vertical(s: PantsShape, l: PantsLook): { c1: number; k: number } {
  const r = l.rise;
  const c1 = s.waist - (s.waist - s.crotch) * r;
  const hem1 = s.waist - (s.waist - s.hem) * r;
  return { c1, k: (l.length * (c1 - s.hem)) / (c1 - hem1) };
}

/** Where a model-frame height ends up after the rise and length mapping. */
export function pantsY(s: PantsShape, l: PantsLook, y: number): number {
  const { c1, k } = vertical(s, l);
  const y1 = y < s.waist ? s.waist - (s.waist - y) * l.rise : y;
  return y1 < c1 ? c1 - (c1 - y1) * k : y1;
}

export function pantsDeform(s: PantsShape, l: PantsLook, node: string): DeformParams {
  const { c1, k } = vertical(s, l);
  const p: DeformParams = {
    ly: s.waist,
    lk: l.rise,
    sox: 0, soy: c1, soz: 0, sdx: 0, sdy: -1, sdz: 0, s0: 0, sk: k,
    fx: l.fx ?? 1,
    fz: l.fz ?? 1,
  };
  const leg = s.legs[node];
  if (leg) {
    const hem = pantsY(s, l, s.hem + 0.02);
    if (l.flare) Object.assign(p, { lgx: leg.inner, lgz: leg.z, lgy0: pantsY(s, l, s.knee), lgy1: hem, lgk0: 1, lgk1: l.hemWidth });
    else Object.assign(p, { lgx: leg.x, lgz: leg.z, lgy0: pantsY(s, l, s.crotch - 0.04), lgy1: hem, lgk0: 1, lgk1: l.hemWidth });
  }
  return p;
}

/** A stitch line measured on the source model: flat xyz triples (model frame) and surface normals. */
export interface BakedLine {
  part: string;
  label: string;
  path: number[];
  normals: number[];
}

/** A point measured on the source model (a belt loop end). */
export interface BakedPoint {
  part: string;
  label: string;
  at: V3;
  normal: V3;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const triples = (a: number[]): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
};

/** extraZones for meshTemplate: measured lines and points, deformed like their part (overrides prep zones of the same name). */
export function measuredZones(
  lines: Record<string, BakedLine>,
  points: Record<string, BakedPoint>,
  deform: (controls: Record<string, string>, node: string) => DeformParams,
): (zones: Record<string, Zone>, controls: Record<string, string>) => Record<string, Zone> {
  return (_zones, controls) => {
    const out: Record<string, Zone> = {};
    for (const [name, b] of Object.entries(lines)) {
      const params = deform(controls, b.part);
      const pts = triples(b.path), nrm = triples(b.normals);
      out[name] = {
        part: b.part,
        label: b.label,
        path: pts.map((p) => deformPoint(p, params).map(r4) as V3),
        normals: pts.map((p, i) => deformNormal(p, nrm[i] ?? [0, 0, 1], params).map(r4) as V3),
      };
    }
    for (const [name, b] of Object.entries(points)) {
      const params = deform(controls, b.part);
      out[name] = { part: b.part, label: b.label, at: deformPoint(b.at, params).map(r4) as V3, normal: deformNormal(b.at, b.normal, params).map(r4) as V3 };
    }
    return out;
  };
}
