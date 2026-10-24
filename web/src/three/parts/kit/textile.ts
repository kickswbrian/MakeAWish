import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import { Acc, type Params, type Piece, contrastThread, extrude, rrect, rrectPath, rrectProfile, stitch2D, stitchLine, stitchRow, sweep, v3 } from "./core.ts";

// ---------- Stitch line ----------

export function stitching(p: Params): Piece[] {
  const L = p.length;
  const acc = new Acc();
  const g = stitchLine(v3(-L / 2, 0, 0.00038), v3(L / 2, 0, 0.00038), v3(0, 0, 1), { pitch: 0.0055, stitch: 0.0038, radius: 0.00058, flatten: 0.72 });
  if (g) acc.add(g, "main");
  return acc.finish();
}

// ---------- Brand patch ----------

/** Four-point sparkle (concave star) centered at (cx, cy) with outer radius s. */
function sparkle(s: number, cx: number, cy: number): THREE.Shape {
  const sh = new THREE.Shape();
  const k = 0.16 * s;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 2;
    const b = a + Math.PI / 2;
    const p = [cx + Math.cos(a) * s, cy + Math.sin(a) * s];
    const q = [cx + Math.cos(b) * s, cy + Math.sin(b) * s];
    const mid = a + Math.PI / 4;
    if (i === 0) sh.moveTo(p[0], p[1]);
    sh.quadraticCurveTo(cx + Math.cos(mid) * k, cy + Math.sin(mid) * k, q[0], q[1]);
  }
  return sh;
}

export function brandPatch(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const acc = new Acc();
  const mn = Math.min(W, H);
  const rc = mn * 0.2;
  acc.add(extrude(rrect(W, H, rc), 0.0016, 0.0005, { curveSegs: 14, bevelSegs: 3 }), "main", { crease: 0.9 });
  // Stitched border.
  const inset = Math.max(0.0016, mn * 0.075);
  const border = rrectPath(new THREE.Path(), W - 2 * inset, H - 2 * inset, Math.max(0.0005, rc - inset), 0, 0, false);
  const sp = Math.max(0.0019, (2 * (W + H)) / 110);
  const st = stitch2D(border, 0.00158, { pitch: sp, stitch: sp * 0.72, radius: Math.max(0.00027, sp * 0.14) });
  const thread = (m: PartMaterial) => getMaterial(contrastThread(m));
  if (st) acc.add(st, thread);
  // Raised embroidered sparkle emblem (+ a small companion sparkle).
  const S = Math.min(H * 0.3, W * 0.2);
  const emb = (m: PartMaterial) => getMaterial(contrastThread(m, "satin"));
  acc.add(extrude(sparkle(S, -S * 0.12, -S * 0.08), 0.001, 0.00038, { z0: 0.0015, curveSegs: 12, bevelSegs: 3 }), emb, { crease: 0.7 });
  acc.add(extrude(sparkle(S * 0.42, S * 0.95, S * 0.62), 0.0009, 0.00032, { z0: 0.0015, curveSegs: 10, bevelSegs: 3 }), emb, { crease: 0.7 });
  return acc.finish();
}

// ---------- Mesh pocket ----------

export function meshPocket(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const acc = new Acc();
  const D = 0.04 * Math.min(1, Math.sqrt((W * H) / (0.12 * 0.14)) ** 0.5);
  const g = (t: number) => (t <= 0.75 ? Math.sin((Math.PI / 2) * (t / 0.75)) : 1 - 0.25 * ((t - 0.75) / 0.25) ** 2);
  const bul = (s: number) => Math.max(0, 1 - (2 * s - 1) ** 2) ** 0.6;
  const S = (s: number, t: number, out = new THREE.Vector3()) => out.set((s - 0.5) * W, -H / 2 + t * H, D * bul(s) * g(t));
  const nrm = (s: number, t: number) => {
    const e = 1e-4;
    const ds = S(Math.min(1, s + e), t).sub(S(Math.max(0, s - e), t));
    const dt = S(s, Math.min(1, t + e)).sub(S(s, Math.max(0, t - e)));
    const n = ds.cross(dt);
    if (n.lengthSq() < 1e-20) return v3(0, 0, 1);
    return n.normalize();
  };
  // Lattice: each cell is a square frame around a hole, front and back faces.
  const cell = Math.max(0.0046, Math.sqrt((W * H) / 1100));
  const nu = Math.max(4, Math.round(W / cell)), nv = Math.max(4, Math.round(H / cell));
  const thick = 0.0006;
  const holeK = 0.3; // half-size of the hole relative to the cell
  const pos: number[] = [], nor: number[] = [];
  const push = (v: THREE.Vector3, n: THREE.Vector3) => {
    pos.push(v.x, v.y, v.z);
    nor.push(n.x, n.y, n.z);
  };
  const tmp = new THREE.Vector3();
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const s0 = i / nu, s1 = (i + 1) / nu, t0 = j / nv, t1 = (j + 1) / nv;
      const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
      const outer: [number, number][] = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
      const hs = (s1 - s0) * holeK, ht = (t1 - t0) * holeK;
      const inner: [number, number][] = [[sc - hs, tc - ht], [sc + hs, tc - ht], [sc + hs, tc + ht], [sc - hs, tc + ht]];
      for (const side of [1, -1]) {
        const vert = (q: [number, number]) => {
          const n = nrm(q[0], q[1]);
          const v = S(q[0], q[1], tmp.clone()).addScaledVector(n, side > 0 ? 0 : -thick);
          return { v, n: side > 0 ? n : n.clone().negate() };
        };
        const O = outer.map(vert), I = inner.map(vert);
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          const quad = [O[k], O[k2], I[k2], I[k]];
          const tri = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          for (const ti of tri) push(quad[ti].v, quad[ti].n);
        }
      }
    }
  }
  const lattice = new THREE.BufferGeometry();
  lattice.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  lattice.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  acc.add(lattice, "main");
  // Elastic rim along the open top, slightly gathered.
  const rimPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 90; i++) rimPts.push(S(i / 90, 1).add(v3(0, -0.0022, 0.0004)));
  const ripples = Math.round(W / 0.006);
  acc.add(sweep(rimPts, rrectProfile(0.0058, 0.0026, 0.0012, 4), v3(0, 1, 0), { scale: (t) => [1, 1 + 0.16 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * ripples))] }), "main");
  // Binding tape along sides and bottom where it's sewn on.
  const r = Math.min(0.008, W * 0.1, H * 0.1);
  const u: THREE.Vector3[] = [];
  const hw = W / 2 - 0.0012, top = H / 2 - 0.0005, bot = -H / 2 + 0.0012;
  const seg = (a: THREE.Vector3, b: THREE.Vector3, n: number) => {
    for (let i = 0; i < n; i++) u.push(a.clone().lerp(b, i / n));
  };
  seg(v3(-hw, top, 0), v3(-hw, bot + r, 0), 24);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI + (i / 8) * (Math.PI / 2);
    u.push(v3(-hw + r + Math.cos(a) * r, bot + r + Math.sin(a) * r, 0));
  }
  seg(v3(-hw + r, bot, 0), v3(hw - r, bot, 0), 24);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 1.5 + (i / 8) * (Math.PI / 2);
    u.push(v3(hw - r + Math.cos(a) * r, bot + r + Math.sin(a) * r, 0));
  }
  seg(v3(hw, bot + r, 0), v3(hw, top, 0), 24);
  u.push(v3(hw, top, 0));
  const tapeW = 0.0075;
  acc.add(sweep(u.map((q) => q.clone().setZ(0.0008)), rrectProfile(0.0016, tapeW, 0.0006, 3), v3(0, 0, 1)), "main");
  // Stitch line on the tape.
  const curve = new THREE.CatmullRomCurve3(u.map((q) => q.clone().setZ(0.00165)), false, "catmullrom", 0.1);
  const len = curve.getLength();
  const pp = Math.max(0.0032, len / 160);
  const st = stitchRow((x) => ({ p: curve.getPointAt(x), t: curve.getTangentAt(x), n: v3(0, 0, 1) }), len, { pitch: pp, stitch: pp * 0.72, radius: Math.max(0.0003, pp * 0.09) });
  if (st) acc.add(st, "main");
  return acc.finish();
}
