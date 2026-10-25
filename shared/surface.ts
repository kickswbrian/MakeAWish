import { movedBy, partBox } from "./bounds.ts";
import { toProductSpace } from "./frames.ts";
import type { Product } from "./product.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Lettering on the surface, not inside the object. Models often put a text part at its host's center
 * or sink it too deep, so the words are buried. A new text part whose center sits well inside the
 * part it's written on is pushed out along the way it faces until its back just touches the surface.
 * The host is the smallest solid whose box holds the text's center (a sign's board, not its frame).
 */
export function surfaceText(product: Product, added: Iterable<string>): { op: "update"; id: string; changes: { transform: { position: Vec3 } } }[] {
  const out: { op: "update"; id: string; changes: { transform: { position: Vec3 } } }[] = [];
  for (const id of added) {
    const t = product.parts[id];
    const g = t?.geometry;
    if (!t?.parent || t.csg || t.kind !== "primitive" || g?.type !== "text") continue;
    const c = toProductSpace(product, id, [0, 0, 0]);
    const tip = toProductSpace(product, id, [0, 0, 1]);
    const raw = tip.map((v, i) => v - c[i]) as Vec3;
    const n = Math.hypot(...raw) || 1;
    const d = raw.map((v) => v / n) as Vec3;
    // The text's own depth along d, in product space (scale included).
    const depth = g.params.depth * n;
    let host: { box: NonNullable<ReturnType<typeof partBox>>; vol: number } | null = null;
    for (const p of Object.values(product.parts)) {
      if (p.id === id || p.csg || p.geometry?.type === "text") continue;
      const b = partBox(product, p.id);
      if (!b || [0, 1, 2].some((i) => c[i] < b.min[i] || c[i] > b.max[i])) continue;
      const vol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
      if (!host || vol < host.vol) host = { box: b, vol };
    }
    if (!host) continue;
    // On some face already (even if turned the wrong way, like a side decal facing forward): leave it.
    // Only text buried away from every face gets moved.
    const margin = Math.max(depth, 0.003);
    if ([0, 1, 2].some((i) => c[i] - host!.box.min[i] < margin || host!.box.max[i] - c[i] < margin)) continue;
    // How far the text's center is from the host's surface, along the way it faces.
    let exit = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-6) continue;
      exit = Math.min(exit, ((d[i] > 0 ? host.box.max[i] : host.box.min[i]) - c[i]) / d[i]);
    }
    // Already on the surface (its back within a little of it): leave it.
    if (!Number.isFinite(exit) || exit <= depth) continue;
    const sink = Math.min(0.001, depth * 0.3);
    const move = exit + depth / 2 - sink;
    const position = movedBy(product, id, [d[0] * move, d[1] * move, d[2] * move]);
    if (position) out.push({ op: "update", id, changes: { transform: { position } } });
  }
  return out;
}
