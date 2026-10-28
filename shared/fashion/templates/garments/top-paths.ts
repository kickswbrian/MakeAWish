import { deformNormal, deformPoint, type DeformParams } from "../../deform.ts";
import type { V3, Zone } from "../../types.ts";

/**
 * Path zones measured offline on a prepared model (necklines, armholes, straps, waistbands): the prep
 * script only finds straight lines and planar rings, but these edges curve in 3D, so their centerline
 * is sampled from the binding/band piece itself (tools/prep-garments build GLB) and stored here as
 * flat [x, y, z, ...] arrays in the model frame. They deform with their part like every other zone.
 */
export interface BakedPath {
  part: string;
  label: string;
  path: number[];
  normals: number[];
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const triples = (a: number[]): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
};

/** extraZones for meshTemplate: the baked paths, deformed like their part, minus hidden parts. */
export function bakedZones(
  paths: Record<string, BakedPath>,
  deform: (controls: Record<string, string>, node: string) => DeformParams,
  hide?: (controls: Record<string, string>) => string[],
): (zones: Record<string, Zone>, controls: Record<string, string>) => Record<string, Zone> {
  return (_zones, controls) => {
    const hidden = new Set(hide?.(controls) ?? []);
    const out: Record<string, Zone> = {};
    for (const [name, b] of Object.entries(paths)) {
      if (hidden.has(b.part)) continue;
      const params = deform(controls, b.part);
      const pts = triples(b.path), nrm = triples(b.normals);
      out[name] = {
        part: b.part,
        label: b.label,
        path: pts.map((p) => deformPoint(p, params).map(r4) as V3),
        normals: pts.map((p, i) => deformNormal(p, nrm[i] ?? [0, 0, 1], params).map(r4) as V3),
      };
    }
    return out;
  };
}
