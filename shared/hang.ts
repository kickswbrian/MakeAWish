import { boxGap, partBox, productBox } from "./bounds.ts";
import { toPartSpace, toProductSpace } from "./frames.ts";
import { applyPatches, subtreeIds, type Product } from "./product.ts";
import type { Vec3 } from "./spec.ts";

/**
 * Gravity for hanging things. Models write a pull cord as "down" in its parent's frame, so under a
 * tilted lamp shade it sticks out sideways with the charm tilted too. After a turn, a new cord
 * (a thin tube or cylinder named like a cord, string or chain) is re-hung straight down from its
 * top end, the same length, and what hangs on it moves to the new bottom, upright.
 */

type M3 = number[][];
const DEG = Math.PI / 180;
const CORD = /cord|chain|pull[ _-]?string|string|thread|lanyard|rope|strand|twine|tassel/i;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const round = (v: Vec3) => v.map(r4) as Vec3;

/** Rotation of part `id`'s frame in product space (columns = its axes), scale removed. */
function frameRotation(product: Product, id: string): M3 {
  const o = toProductSpace(product, id, [0, 0, 0]);
  const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => {
    const v = sub(toProductSpace(product, id, e), o);
    const n = len(v) || 1;
    return v.map((x) => x / n);
  });
  return [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]);
}

const mul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const transpose = (a: M3): M3 => [0, 1, 2].map((r) => [a[0][r], a[1][r], a[2][r]]);
const isIdentity = (a: M3) => a.every((row, r) => row.every((v, c) => Math.abs(v - (r === c ? 1 : 0)) < 0.02));

/** Euler XYZ (degrees) to a matrix, composed like the renderer: Rx * Ry * Rz. */
function fromEuler([x, y, z]: Vec3): M3 {
  const [a, b, c] = [x * DEG, y * DEG, z * DEG];
  const rx: M3 = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const ry: M3 = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const rz: M3 = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  return mul(mul(rx, ry), rz);
}

/** A rotation matrix back to Euler XYZ degrees (three.js's decomposition). */
function toEuler(m: M3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  const [x, z] = Math.abs(m[0][2]) < 0.9999999 ? [Math.atan2(-m[1][2], m[2][2]), Math.atan2(-m[0][1], m[0][0])] : [Math.atan2(m[2][1], m[1][1]), 0];
  return [x, y, z].map((v) => Math.round((v / DEG) * 10) / 10) as Vec3;
}

type Update = { op: "update"; id: string; changes: Record<string, unknown> };

/** Updates that hang the new cords among `added` straight down (and their charms below them). */
export function hangCords(product: Product, added: Iterable<string>): Update[] {
  const fresh = new Set(added);
  const out: Update[] = [];
  let work = product;
  const apply = (u: Update[]) => {
    const r = applyPatches(work, u);
    work = r.product;
    out.push(...(r.applied as Update[]));
  };
  for (const id of fresh) {
    const cord = work.parts[id];
    const g = cord?.geometry;
    if (!cord?.parent || cord.kind !== "primitive" || !g || !CORD.test(`${cord.id} ${cord.name}`)) continue;
    // The cord's line in product space, top first.
    let line: Vec3[];
    if (g.type === "tube" && !g.params.closed && !g.params.width && g.params.radius <= 0.005) {
      line = g.params.points.map((p) => toProductSpace(work, id, p as Vec3));
    } else if (g.type === "cylinder" && Math.max(g.params.radiusTop, g.params.radiusBottom) <= 0.005 && g.params.height >= 6 * g.params.radiusBottom) {
      line = [toProductSpace(work, id, [0, g.params.height / 2, 0]), toProductSpace(work, id, [0, -g.params.height / 2, 0])];
    } else continue;
    if (line[line.length - 1][1] > line[0][1]) line.reverse();
    const top = line[0], end = line[line.length - 1];
    const drawn = line.slice(1).reduce((s, p, k) => s + len(sub(p, line[k])), 0);
    const dir = sub(end, top);
    const down = -dir[1] / (len(dir) || 1);
    // Already hangs straight, or lies sideways (a guitar string, a drawer pull): not a hanging cord.
    if (drawn < 0.005 || down > Math.cos(8 * DEG) || down < Math.cos(75 * DEG)) continue;
    // A pull cord is drawn straight; a curved one (a drawstring round a hood, string lights) is meant to be.
    const span = len(dir) || 1;
    const off = (p: Vec3) => { const t = sub(p, top); const k = (t[0] * dir[0] + t[1] * dir[1] + t[2] * dir[2]) / (span * span); return len(sub(t, dir.map((v) => v * k) as Vec3)); };
    if (line.some((p) => off(p) > 0.1 * span)) continue;
    // Long enough to show: the charm hangs clear below what holds the cord (a shade's rim).
    const all = productBox(work), holder = partBox(work, cord.parent);
    const drop = all ? Math.min(0.15, Math.max(0.04, 0.15 * (all.max[1] - all.min[1]))) : 0.05;
    // (Capped, so a charm on a tall body's side doesn't get a cord down past its bottom.)
    const total = holder ? Math.max(drawn, Math.min(2.5 * drawn, top[1] - (holder.min[1] - drop))) : drawn;
    const newEnd: Vec3 = [top[0], top[1] - total, top[2]];

    // What hangs on it: its children, and parts added alongside it at its bottom end that touch
    // nothing else (a charm, not a basket the cord ties down to).
    // The holder's own parts (a shade's rim and lining) and its ancestors never count as "something else".
    const holderTree = new Set(subtreeIds(work, cord.parent));
    for (let a = work.parts[cord.parent]?.parent; a && !holderTree.has(a); a = work.parts[a]?.parent) holderTree.add(a);
    const nearEnd = (p: Product["parts"][string]) => {
      const b = partBox(work, p.id);
      if (!b) return false;
      const size = Math.max(...b.max.map((v, i) => v - b.min[i]));
      return len(sub(toProductSpace(work, p.id, [0, 0, 0]), end)) <= Math.max(0.03, 1.5 * size);
    };
    const isCord = (p: Product["parts"][string]) => CORD.test(`${p.id} ${p.name}`);
    const loose = Object.values(work.parts).filter((p) => p.id !== id && fresh.has(p.id) && p.parent === cord.parent && !isCord(p) && nearEnd(p));
    const charmIds = new Set([...Object.values(work.parts).filter((p) => p.parent === id), ...loose].flatMap((p) => subtreeIds(work, p.id)));
    const others = Object.keys(work.parts).filter((o) => o !== id && !charmIds.has(o) && !holderTree.has(o));
    const touchesOthers = (pid: string) => {
      const b = partBox(work, pid);
      return !!b && others.some((o) => { const ob = partBox(work, o); return !!ob && boxGap(b, ob) <= 0.002; });
    };
    const charms = Object.values(work.parts).filter((p) => p.parent === id || (loose.includes(p) && !subtreeIds(work, p.id).some(touchesOthers)));
    // A cord tied to something at its bottom (a rope down to a basket) isn't a pull cord.
    const tied = others.some((o) => { const ob = partBox(work, o); return !!ob && boxGap({ min: end, max: end }, ob) <= 0.004; });
    if (!charms.length || tied) continue;
    const drops = charms.map((p) => ({ id: p.id, gap: len(sub(toProductSpace(work, p.id, [0, 0, 0]), end)), parent: p.parent!, rotation: p.transform.rotation }));

    // Re-hang the cord.
    if (g.type === "tube") {
      const points = line.map((_, k) => round(toPartSpace(work, id, [top[0], top[1] - (total * k) / (line.length - 1), top[2]])));
      apply([{ op: "update", id, changes: { geometry: { params: { points } } } }]);
    } else {
      const center: Vec3 = [top[0], top[1] - total / 2, top[2]];
      const upright = transpose(frameRotation(work, cord.parent));
      apply([{ op: "update", id, changes: { transform: { position: round(toPartSpace(work, cord.parent, center)), rotation: toEuler(upright) } } }]);
    }

    // Charms straight below the new end, as far below it as they were, and upright: only the turn
    // they were given around the vertical is kept (any flip was the model fighting the tilt).
    for (const d of drops) {
      const at: Vec3 = [newEnd[0], newEnd[1] - d.gap, newEnd[2]];
      const parentRot = frameRotation(work, d.parent);
      const changes: Record<string, unknown> = { transform: { position: round(toPartSpace(work, d.parent, at)) } };
      if (!isIdentity(parentRot)) (changes.transform as Record<string, unknown>).rotation = toEuler(mul(transpose(parentRot), fromEuler([0, d.rotation[1], 0])));
      apply([{ op: "update", id: d.id, changes }]);
    }
  }
  return out;
}
