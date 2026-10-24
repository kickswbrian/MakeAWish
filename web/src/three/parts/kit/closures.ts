import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import {
  Acc, type Builder, type Piece, arcPts, braidTube, chaikin, circleHole, circleShape, clamp, contrastThread, creasedNormals, extrude,
  latheZ, polyShape, rbox, rrect, rrectHole, rrectProfile, sweep, tube, v3,
} from "./core.ts";
import {
  FINISH, type Frame, PathFrames, type StitchTpl, ThreadBuf, bandSweep, finishMaterial, isMetal, latheZStamped, stampedRing, stitchAlong,
} from "./construction.ts";

/**
 * Detail module builders: closures (catalog entries in shared/modules/closures.ts).
 *
 * Closures default to the template's hardware slot, so a builder may receive either a metal finish
 * or a fabric. Pieces split accordingly: hardware takes the part material when it is metal (else
 * the `finish` option), soft goods (tape, cord, lace) take it when it is not (else their color option).
 */

// ---------- Materials ----------

/** Soft-goods colors offered by tape / cord / lace options; index 0 ("auto") = module default. */
const SOFT_COLORS = ["auto", "black", "charcoal", "navy", "ecru", "white", "tan", "olive", "red"];
const SOFT_HEX: Record<string, string> = {
  black: "#1D1E21", charcoal: "#3A3C41", navy: "#1F2A44", ecru: "#E6DDC8", white: "#F2F1EC", tan: "#B48B5E", olive: "#55593A", red: "#A3262A",
};

/** Soft-goods material: the part material unless it is metal, then option `i` (auto = `auto`). */
function softMat(i: number, auto: string, preset: PartMaterial["preset"] = "nylon"): (m: PartMaterial) => THREE.Material {
  return (m) => getMaterial(softOf(m, i, auto, preset));
}
function softOf(m: PartMaterial, i: number, auto: string, preset: PartMaterial["preset"]): PartMaterial {
  if (i > 0) return { preset, color: SOFT_HEX[SOFT_COLORS[i]] ?? auto };
  return isMetal(m) ? { preset, color: auto } : m;
}

const LEATHER: PartMaterial = { preset: "leather", color: "#5E3B25" };
const CREAM_THREAD: PartMaterial = { preset: "cotton", color: "#E9DFC7" };
const DARK_THREAD: PartMaterial = { preset: "cotton", color: "#2A2B2F" };
const threadFor = (m: PartMaterial) => getMaterial(contrastThread(m));

// ---------- Small helpers ----------

const _m4 = new THREE.Matrix4();

/** Place local slider-frame geometry (x along the chain toward the path end, y across, z out). */
function placeAt(g: THREE.BufferGeometry, f: Frame, along = 0): THREE.BufferGeometry {
  _m4.makeBasis(f.t, f.w, f.n).setPosition(f.p.clone().addScaledVector(f.t, along));
  return g.applyMatrix4(_m4);
}

/** Non-indexed geometry with normals -> a reusable template (and its mirror across x). */
function toTpl(g: THREE.BufferGeometry, crease: number): StitchTpl {
  const s = g.index ? g.toNonIndexed() : g;
  creasedNormals(s, crease);
  const pos = Array.from(s.attributes.position.array as Float32Array);
  const nor = Array.from(s.attributes.normal.array as Float32Array);
  return { pos, nor, uv: new Array((pos.length / 3) * 2).fill(0) };
}
function mirrorX(t: StitchTpl): StitchTpl {
  const pos: number[] = [], nor: number[] = [];
  for (let i = 0; i < t.pos.length; i += 9) {
    for (const k of [0, 2, 1]) {
      const j = i + k * 3;
      pos.push(-t.pos[j], t.pos[j + 1], t.pos[j + 2]);
      nor.push(-t.nor[j], t.nor[j + 1], t.nor[j + 2]);
    }
  }
  return { pos, nor, uv: t.uv.slice() };
}

/**
 * Lean domed prism: walls from z0 to z1 around a CCW outline, then a rounded crown rising `dome`.
 * ~5 triangles per outline point, for heavily repeated details (zipper teeth).
 */
function pillow(outline: [number, number][], z0: number, z1: number, dome: number): THREE.BufferGeometry {
  const n = outline.length;
  let cx = 0, cy = 0;
  for (const [x, y] of outline) { cx += x / n; cy += y / n; }
  const ring = (k: number, z: number) => outline.map(([x, y]) => v3(cx + (x - cx) * k, cy + (y - cy) * k, z));
  const r0 = ring(1, z0), r1 = ring(1, z1), r3 = ring(0.7, z1 + dome * 0.8);
  const top = v3(cx, cy, z1 + dome);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const [lo, hi] of [[r0, r1], [r1, r3]] as const) {
      tri(lo[i], lo[j], hi[j]);
      tri(lo[i], hi[j], hi[i]);
    }
    tri(r3[i], r3[j], top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const mm = (v: number) => v * 0.001;
const pts = (list: number[][]): [number, number][] => list.map(([x, y]) => [mm(x), mm(y)]);

// ---------- Zipper slider and pulls ----------

/**
 * #5 slider in its local frame: runs along x with the wide shoulders (where the chains split) at +x,
 * bail on top. Returns the bail pivot (where pulls hang from) in the same frame. `k` scales it.
 */
function slider(acc: Acc, mat: Piece["mat"], place: (g: THREE.BufferGeometry) => THREE.BufferGeometry, k: number, z0: number): THREE.Vector3 {
  const outline = chaikin(pts([[-8, -3.9], [3.5, -5.4], [8, -5.4], [8, 5.4], [3.5, 5.4], [-8, 3.9]]).map(([x, y]) => [x * k, y * k] as [number, number]), 3);
  acc.add(place(extrude(polyShape(outline), mm(3.6) * k, mm(0.9) * k, { z0, bevelSegs: 4 })), mat, { crease: 0.9 });
  // Raised center rib and the two side flanges that wrap under the chain.
  const rib = chaikin(pts([[-6.5, -1.3], [4.2, -1.7], [4.2, 1.7], [-6.5, 1.3]]).map(([x, y]) => [x * k, y * k] as [number, number]), 2);
  acc.add(place(extrude(polyShape(rib), mm(0.5) * k, mm(0.2) * k, { z0: z0 + mm(3.4) * k })), mat, { crease: 0.9 });
  // Bail: arched bridge the pull loops through.
  const bz = z0 + mm(3.3) * k;
  const arch = new THREE.CatmullRomCurve3([v3(-3.4, 0, 0), v3(-2.7, 0, 1.5), v3(0, 0, 2.2), v3(2.7, 0, 1.5), v3(3.4, 0, 0)].map((q) => q.multiplyScalar(mm(1) * k).add(v3(mm(-1.2) * k, 0, bz)))).getPoints(24);
  acc.add(place(sweep(arch, rrectProfile(mm(3) * k, mm(0.9) * k, mm(0.35) * k), v3(0, 1, 0))), mat);
  return v3(mm(-1.2) * k, 0, bz + mm(2.2) * k);
}

/** Pull tab (paddle with a raised border) hanging back toward -x from the bail pivot. */
function pullTab(acc: Acc, mat: Piece["mat"], place: (g: THREE.BufferGeometry) => THREE.BufferGeometry, b: THREE.Vector3, k: number, drop: number) {
  const L = mm(21) * k, w = mm(7.6) * k;
  const o = chaikin([[0.0034, -0.0026], [0.0034, 0.0026], [-0.0045, 0.0027], [-0.008, 0.0038], [-0.021, 0.0038], [-0.021, -0.0038], [-0.008, -0.0038], [-0.0045, -0.0027]].map(([x, y]) => [x * k, y * k] as [number, number]), 3);
  const shape = polyShape(o);
  shape.holes.push(rrectHole(mm(1.6) * k, mm(3.6) * k, mm(0.6) * k, mm(0.3) * k, 0));
  const tilt = -Math.atan2(drop, L);
  const pose = (g: THREE.BufferGeometry) => place(g.translate(0, 0, -mm(0.5) * k).rotateY(tilt).translate(b.x, b.y, b.z));
  acc.add(pose(extrude(shape, mm(1) * k, mm(0.35) * k, { bevelSegs: 3 })), mat, { crease: 0.9 });
  const px0 = mm(-8.8) * k, px1 = -L + mm(1.2) * k;
  const pw = w - mm(1.8) * k, plen = px0 - px1;
  const border = rrect(plen, pw, Math.min(mm(2.2) * k, pw / 2 - 1e-5), (px0 + px1) / 2, 0);
  border.holes.push(rrectHole(plen - mm(1.4) * k, pw - mm(1.4) * k, Math.min(mm(1.6) * k, pw / 2 - mm(0.8) * k), (px0 + px1) / 2, 0));
  acc.add(pose(extrude(border, mm(0.35) * k, mm(0.12) * k, { z0: mm(0.95) * k })), mat, { crease: 0.9 });
}

/** Ring pull: a round wire ring through the bail, lying back over the chain. */
function pullRing(acc: Acc, mat: Piece["mat"], place: (g: THREE.BufferGeometry) => THREE.BufferGeometry, b: THREE.Vector3, k: number) {
  const R = mm(6) * k;
  const ring = new THREE.TorusGeometry(R, mm(0.95) * k, 14, 56);
  acc.add(place(ring.rotateY(-0.32).translate(b.x - R * 0.95, 0, b.z - mm(1.4) * k)), mat);
}

/** Leather tab pull: a jump ring through the bail and a doubled, edge-stitched leather strip. */
function pullLeather(acc: Acc, mat: Piece["mat"], place: (g: THREE.BufferGeometry) => THREE.BufferGeometry, b: THREE.Vector3, k: number) {
  const jr = mm(2.6) * k;
  acc.add(place(new THREE.TorusGeometry(jr, mm(0.6) * k, 10, 32).rotateY(-0.5).translate(b.x - jr * 0.8, 0, b.z - mm(0.6) * k)), mat);
  const len = mm(30) * k, w = mm(8.5) * k, th = mm(2.4) * k;
  const x0 = b.x - jr * 1.7;
  const strip = rrect(len, w, mm(3) * k, x0 - len / 2 + mm(2) * k, 0);
  const tilt = -0.13;
  const pose = (g: THREE.BufferGeometry) => place(g.rotateY(tilt).translate(0, 0, b.z - mm(3.2) * k - (x0 - b.x) * Math.sin(tilt)));
  acc.add(pose(extrude(strip, th, mm(0.7) * k, { bevelSegs: 3, curveSegs: 10 }).translate(0, 0, 0)), LEATHER, { crease: 0.9 });
  // Fold line where the strip doubles around the ring, and an edge stitch.
  const P: THREE.Vector3[] = [];
  const sx0 = x0 + mm(0.5) * k, sx1 = x0 - len + mm(4.5) * k, sy = w / 2 - mm(1.3) * k;
  const corner = mm(2) * k;
  const loop: [number, number][] = [[sx0, sy], [sx1 + corner, sy], ...arcPts(sx1 + corner, sy - corner, corner, Math.PI / 2, Math.PI, 4).slice(1), [sx1, -sy + corner], ...arcPts(sx1 + corner, -sy + corner, corner, Math.PI, Math.PI * 1.5, 4).slice(1), [sx0, -sy]];
  for (const [x, y] of loop) P.push(v3(x, y, th + mm(0.05)));
  const f = new PathFrames(densePolyline(P), densePolyline(P).map(() => v3(0, 0, 1)), false);
  const buf = new ThreadBuf();
  stitchAlong(buf, f, { pitch: mm(2.2) * k, r: mm(0.24) * k });
  const g = buf.geometry();
  if (g) acc.add(pose(g), CREAM_THREAD);
}

/** Cord pull: a braided loop through the bail ending in a molded rubber barrel. */
function pullCord(acc: Acc, mat: Piece["mat"], cordMat: Piece["mat"], place: (g: THREE.BufferGeometry) => THREE.BufferGeometry, b: THREE.Vector3, k: number) {
  const r = mm(1.1) * k;
  const z = b.z - mm(1.2) * k;
  const end = mm(-20) * k;
  const loop = new THREE.CatmullRomCurve3([
    v3(end + mm(2) * k, -mm(1.3) * k, z - mm(2.6) * k), v3(end / 2, -mm(1.8) * k, z - mm(1.4) * k), v3(b.x - mm(2.5) * k, -mm(1.6) * k, z), v3(b.x, -mm(0.9) * k, b.z + r * 0.2),
    v3(b.x + mm(0.6) * k, 0, b.z + r * 0.5), v3(b.x, mm(0.9) * k, b.z + r * 0.2), v3(b.x - mm(2.5) * k, mm(1.6) * k, z), v3(end / 2, mm(1.8) * k, z - mm(1.4) * k),
    v3(end + mm(2) * k, mm(1.3) * k, z - mm(2.6) * k),
  ], false, "centripetal");
  acc.add(place(braidTube(loop, 90, r, 8, 3, mm(3) * k, 0.14)), cordMat);
  // Molded barrel end (rubber), axis along x.
  const bl = mm(11) * k, br = mm(2.6) * k;
  const prof: [number, number][] = [[0, 0], [br * 0.75, 0], ...arcPts(br * 0.7, br * 0.3, br * 0.3, -Math.PI / 2, 0, 3), [br, bl * 0.45], [br * 0.92, bl * 0.8], ...arcPts(br * 0.55, bl * 0.86, br * 0.37, 0, Math.PI / 2, 4), [0, bl * 0.86 + br * 0.37]];
  const barrel = latheZ(prof, 28).rotateY(-Math.PI / 2 - 0.06).translate(end + mm(3) * k, 0, z - mm(2.2) * k);
  acc.add(place(barrel), { preset: "rubber", color: "#1E1F22" }, { crease: 0.7 });
  // Metal collar where the cord enters the barrel.
  const collar = new THREE.TorusGeometry(br * 0.82, mm(0.45) * k, 8, 28).rotateY(Math.PI / 2 - 0.06).translate(end + mm(3.2) * k, 0, z - mm(2.2) * k);
  acc.add(place(collar), mat);
}

/** Densify a polyline (for stitch paths on small flat pieces). */
function densePolyline(P: THREE.Vector3[], step = 0.0004): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const n = Math.max(1, Math.ceil(P[i].distanceTo(P[i + 1]) / step));
    for (let j = 0; j < n; j++) out.push(P[i].clone().lerp(P[i + 1], j / n));
  }
  out.push(P[P.length - 1].clone());
  return out;
}

// ---------- Zipper along a path ----------

/** Metal #5 element (scoop) outline: head at -a (center line), jaws clamped on the tape at +a. Meters. */
const METAL_TOOTH = pts([[-1.08, -0.5], [1.15, -0.66], [1.6, -1.18], [3.0, -1.22], [3.2, -1.0], [3.2, 1.0], [3.0, 1.22], [1.6, 1.18], [1.15, 0.66], [-1.08, 0.5]]);
/** Molded plastic (Vislon) element: a chunky rounded block. */
const PLASTIC_TOOTH = chaikin(pts([[-1.0, -0.62], [2.9, -0.78], [3.15, -0.6], [3.15, 0.6], [2.9, 0.78], [-1.0, 0.62]]), 1);

/**
 * Zipper following the path (its center line): woven tape both sides, interlocking teeth, bottom
 * stop at the first point, top stops and the slider + pull at the last point.
 */
export const zipperPath: Builder = (p, path) => {
  const f = PathFrames.from(path);
  const L = f.length;
  const style = Math.round(p.style); // 0 metal, 1 plastic, 2 invisible
  const tw = p.tape_width;
  const acc = new Acc();
  const tapeMat = softMat(p.tape, "#1D1E21");
  const hw = finishMaterial(p.finish, FINISH.nickel);
  const chainHalf = mm(3.1);
  const E = chainHalf + tw;
  // Tape: woven band, slightly corded where the teeth clamp on; edges tuck into the garment.
  const tape: [number, number][] =
    style === 2
      ? [[-E - mm(0.6), -mm(0.3)], [-E, mm(0.15)], [-E + mm(0.8), mm(0.45)], [-mm(1.2), mm(0.55)], [-mm(0.45), mm(0.75)], [-mm(0.15), mm(0.5)], [-mm(0.04), mm(0.05)],
         [mm(0.04), mm(0.05)], [mm(0.15), mm(0.5)], [mm(0.45), mm(0.75)], [mm(1.2), mm(0.55)], [E - mm(0.8), mm(0.45)], [E, mm(0.15)], [E + mm(0.6), -mm(0.3)]]
      : [[-E - mm(0.6), -mm(0.3)], [-E, mm(0.15)], [-E + mm(0.6), mm(0.5)], [-E + mm(1.2), mm(0.45)], [-chainHalf - mm(0.6), mm(0.45)], [-chainHalf, mm(0.6)], [0, mm(0.5)],
         [chainHalf, mm(0.6)], [chainHalf + mm(0.6), mm(0.45)], [E - mm(1.2), mm(0.45)], [E - mm(0.6), mm(0.5)], [E, mm(0.15)], [E + mm(0.6), -mm(0.3)]];
  acc.add(bandSweep(f, tape, { step: 0.0025, lift: mm(0.2) }), tapeMat);
  // Slider sits near the end with its shoulders toward the end; top stops just past it.
  const k = style === 2 ? 0.62 : 1;
  const sliderAt = Math.max(L * 0.5, L - mm(13) * k);
  const sStart = Math.min(mm(4), L * 0.1), sEnd = L - mm(3);
  if (style === 2) {
    // Invisible zip: only a dark coil glint in the seam gap.
    const P: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
    const n = Math.max(8, Math.ceil(L / 0.002));
    for (let i = 0; i <= n; i++) {
      const fr = f.at((L * i) / n);
      P.push(fr.p.addScaledVector(fr.n, mm(0.3)));
      N.push(fr.n);
    }
    acc.add(bandSweep(new PathFrames(P, N, false), [[-mm(0.2), 0], [0, mm(0.05)], [mm(0.2), 0]], { lift: 0 }), { preset: "plastic_matte", color: "#121214" });
  } else {
    const plastic = style === 1;
    const outline = plastic ? PLASTIC_TOOTH : METAL_TOOTH;
    const tpl = toTpl(pillow(outline, mm(0.25), plastic ? mm(1.35) : mm(1.15), plastic ? mm(0.4) : mm(0.6)), 0.95);
    const g = buildTeeth(f, tpl, mirrorX(tpl), sStart + mm(1.5), sEnd, mm(3));
    const teethMat: Piece["mat"] = plastic ? (m) => getMaterial({ preset: "plastic_gloss", color: softOf(m, p.tape, "#1D1E21", "nylon").color }) : hw;
    if (g) acc.add(g, teethMat);
    // Bottom stop: a box clamped across both chains.
    const b = f.at(sStart);
    acc.add(placeAt(rbox(mm(2.6), mm(7.4), mm(1.9), mm(0.7), 2).translate(0, 0, mm(1.15)), b), hw);
    // Top stops: a small clip on each tape.
    const t = f.at(L - mm(1.6));
    for (const sy of [-1, 1]) acc.add(placeAt(rbox(mm(2.2), mm(2.8), mm(1.7), mm(0.6), 2).translate(0, sy * mm(1.9), mm(1.05)), t), hw);
  }
  // Slider and pull at the end.
  const fs = f.at(sliderAt);
  const place = (g: THREE.BufferGeometry) => placeAt(g, fs);
  const z0 = style === 2 ? mm(0.5) : mm(0.6);
  const bail = slider(acc, hw, place, k, z0);
  const pull = Math.round(p.pull);
  if (pull === 1) pullRing(acc, hw, place, bail, k);
  else if (pull === 2) pullLeather(acc, hw, place, bail, k);
  else if (pull === 3) pullCord(acc, hw, softMat(p.tape, "#1D1E21", "cotton"), place, bail, k);
  else pullTab(acc, hw, place, bail, style === 2 ? 0.8 : 1, bail.z - mm(1.6));
  return acc.finish();
};

/** Teeth for both chains: side +1 on +W, side -1 (mirrored) on -W, half a pitch apart. */
function buildTeeth(f: PathFrames, tpl: StitchTpl, tplM: StitchTpl, s0: number, s1: number, pitch: number): THREE.BufferGeometry | null {
  const buf = new ThreadBuf();
  const n = Math.floor((s1 - s0) / pitch) + 1;
  for (let i = 0; i < n; i++) {
    for (const side of [1, -1]) {
      const s = s0 + i * pitch + (side < 0 ? pitch / 2 : 0);
      if (s > s1) continue;
      const fr = f.at(s);
      // (-W, T, N) is a proper rotation of the template frame. The template's jaws point to -x, so
      // the +W chain uses its mirror image.
      buf.put(side > 0 ? tplM : tpl, fr.p.addScaledVector(fr.n, mm(0.15)), fr.w.clone().negate(), fr.t, fr.n);
    }
  }
  return buf.geometry();
}

// ---------- Buttons ----------

/** Thread passes between two holes, doubled, arching over the button face. */
function threadPass(acc: Acc, a: [number, number], b: [number, number], top: number, tr: number, lift: number, side: number, mat: Piece["mat"], s: number) {
  const dir = v3(b[0] - a[0], b[1] - a[1], 0).normalize();
  const perp = v3(-dir.y, dir.x, 0).multiplyScalar(side * tr * 0.95);
  const hr = tr * 1.6;
  const ptsList = [
    v3(a[0], a[1], top - hr), v3(a[0] + dir.x * hr * 0.6, a[1] + dir.y * hr * 0.6, top + tr * 0.8 + lift * 0.6),
    v3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, top + tr * 1.25 + lift), v3(b[0] - dir.x * hr * 0.6, b[1] - dir.y * hr * 0.6, top + tr * 0.8 + lift * 0.6), v3(b[0], b[1], top - hr),
  ].map((q) => q.add(perp));
  acc.add(braidTube(new THREE.CatmullRomCurve3(ptsList), 28, tr, 7, 2, mm(1.2) * s, 0.12), mat);
}

/**
 * Sew-through button: lathe rim with a dished center disc pierced by 2 or 4 holes, sewn on with
 * contrast thread (an X for four holes, a stacked bar for two). `rimH` / `dish` shape the profile.
 */
function sewThrough(acc: Acc, R: number, holes: 2 | 4, opts: { rimIn: number; rimTop: number; dishZ: number; edge: number }) {
  const s = R / 0.0075;
  const { rimIn, rimTop, dishZ, edge } = opts;
  const rim: [number, number][] = [
    [rimIn, 0.0003 * s], [rimIn, dishZ], [rimIn + 0.05, dishZ + (rimTop - dishZ) * 0.45], [rimIn + 0.14, rimTop * 0.93], [0.8, rimTop], [0.88, rimTop * 0.98],
    [0.94, rimTop * 0.9], [0.985, rimTop * 0.72], [1.0, edge], [0.99, edge * 0.55], [0.965, 0.00012 * s / 0.0075 * 0.0075], [0.92, 0], [rimIn, 0],
  ].map(([r, z]) => [r * R, z]);
  acc.add(latheZ(rim.reverse(), 72), "main", { crease: 0.7 });
  const disc = circleShape((rimIn + 0.02) * R);
  const ho = (holes === 4 ? 0.2 : 0.17) * R, hr = 0.085 * R;
  const hp: [number, number][] = holes === 4 ? [[ho, ho], [-ho, ho], [-ho, -ho], [ho, -ho]] : [[-ho, 0], [ho, 0]];
  for (const [x, y] of hp) disc.holes.push(circleHole(hr, x, y));
  const dz = dishZ - 0.0003 * s;
  acc.add(extrude(disc, dz, Math.min(0.0003 * s, dz / 2.2), { z0: 0.0002 * s, curveSegs: 18, bevelSegs: 2 }), "main", { crease: 0.8 });
  const tr = 0.045 * R;
  if (holes === 4) {
    for (const [ai, bi, lift] of [[0, 2, 0], [1, 3, 1]] as const) for (const side of [-1, 1]) threadPass(acc, hp[ai], hp[bi], dishZ + 0.0001, tr, lift * tr * 1.8, side, threadFor, s);
  } else {
    for (const [side, lift] of [[-1, 0], [1, 0], [0, 1.4]] as const) threadPass(acc, hp[0], hp[1], dishZ + 0.0001, tr, lift * tr, side * 1.1, threadFor, s);
  }
}

/** Domed shank button body: a lathe dome lifted on a short shank so it casts a soft shadow. */
function dome(acc: Acc, mat: Piece["mat"], R: number, h: number, lift: number, segs = 72, groove = true) {
  const n = 26;
  const prof: [number, number][] = [[0, lift], [R * 0.92, lift]];
  prof.push(...arcPts(R * 0.92, lift + R * 0.08, R * 0.08, -Math.PI / 2, 0, 4).slice(1));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const r = R * Math.cos((t * Math.PI) / 2);
    prof.push([r, lift + R * 0.08 + (h - R * 0.08) * Math.sin((t * Math.PI) / 2)]);
  }
  acc.add(latheZ(prof, segs), mat, { crease: 1.0 });
  if (groove) acc.add(new THREE.TorusGeometry(R * 0.86, R * 0.012, 6, segs).translate(0, 0, lift + R * 0.08 + (h - R * 0.08) * 0.42), mat);
  if (lift > 0) acc.add(new THREE.CylinderGeometry(R * 0.22, R * 0.26, lift + 0.0002, 16).rotateX(Math.PI / 2).translate(0, 0, lift / 2), mat);
}

/** Button in all its styles; origin on the cloth, face toward +Z. */
export const button: Builder = (p) => {
  const R = p.radius;
  const style = Math.round(p.style);
  const acc = new Acc();
  const s = R / 0.0075;
  switch (style) {
    case 1:
      sewThrough(acc, R, 2, { rimIn: 0.58, rimTop: 0.0031 * s, dishZ: 0.0021 * s, edge: 0.0019 * s });
      break;
    case 2:
      dome(acc, "main", R, R * 0.42, 0.0012 * s);
      break;
    case 3: {
      // Jeans tack button: stamped rim, lettering ring, center boss, on a short post.
      const hw = finishMaterial(p.finish, FINISH.antique);
      const lift = 0.0016 * s;
      const prof: [number, number][] = [
        [0, lift], [0.9 * R, lift], ...arcPts(0.9 * R, lift + 0.1 * R, 0.1 * R, -Math.PI / 2, 0, 4).slice(1),
        [R, lift + 0.16 * R], [0.98 * R, lift + 0.21 * R], [0.93 * R, lift + 0.235 * R], [0.87 * R, lift + 0.22 * R], [0.83 * R, lift + 0.19 * R],
        [0.78 * R, lift + 0.2 * R], [0.6 * R, lift + 0.235 * R], [0.42 * R, lift + 0.255 * R], [0.36 * R, lift + 0.25 * R], [0.33 * R, lift + 0.27 * R],
        [0.3 * R, lift + 0.3 * R], [0.2 * R, lift + 0.315 * R], [0, lift + 0.32 * R],
      ];
      acc.add(latheZ(prof, 96), hw, { crease: 0.6 });
      const band = prof.slice(10, 14).reverse();
      stampedRing(acc, hw, "WISH IT . EST . ", 0.43 * R, 0.76 * R, (r) => bandAt(band, r), 0.00004 * s);
      acc.add(new THREE.CylinderGeometry(0.3 * R, 0.34 * R, lift + 0.0002, 24).rotateX(Math.PI / 2).translate(0, 0, lift / 2), hw);
      break;
    }
    case 4: {
      // Duffle toggle: a curved horn/wood peg along X, rope looped round its waist up to a leather tab.
      const len = R * 5.2, pr = R * 0.55;
      const zc = pr + 0.0006;
      const prof: [number, number][] = [];
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = -len / 2 + len * t;
        const end = Math.min(t, 1 - t) * 2;
        const r = pr * (0.62 + 0.38 * Math.sin((Math.PI * t))) * (end < 0.12 ? Math.sqrt(Math.max(0, 1 - ((0.12 - end) / 0.12) ** 2)) * 0.9 + 0.1 : 1);
        prof.push([i === 0 || i === n ? 0 : r, y]);
      }
      const peg = latheZ(prof.map(([r, y]) => [r, y] as [number, number]), 40).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2);
      // Bend the peg gently toward the cloth at the ends (horn toggles are curved).
      const pos = peg.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, pos.getZ(i) - (x * x) / (2 * len * 1.6));
      }
      peg.deleteAttribute("normal");
      acc.add(peg.translate(0, 0, zc), "main", { crease: 1.2 });
      const rope = 0.0019 * s;
      const cordMat: PartMaterial = { preset: "cotton", color: "#4A3B2C" };
      for (const side of [-1, 1]) {
        const x = side * rope * 1.05;
        const ptsList = [
          v3(x * 1.4, R * 3.6, rope * 0.9), v3(x * 1.2, R * 2.2, rope * 1.2), v3(x, pr * 1.6, zc + pr * 0.4),
          v3(x * 0.6, 0, zc + pr + rope * 0.9), v3(x * 0.2, -pr - rope * 0.4, zc), v3(-x * 0.2, -pr * 0.6, rope * 0.6), v3(-x * 0.3, 0, rope),
        ];
        acc.add(braidTube(new THREE.CatmullRomCurve3(ptsList, false, "centripetal"), 60, rope, 8, 3, 0.006 * s, 0.16), cordMat);
      }
      // Leather tab over the rope ends, edge-stitched.
      const tw = R * 2.2, th = R * 2.4;
      const tab = rrect(tw, th, R * 0.5, 0, R * 3.9);
      acc.add(extrude(tab, 0.0016 * s, 0.0005 * s, { curveSegs: 10 }), LEATHER, { crease: 0.9 });
      const inset = 0.0016 * s;
      const P: THREE.Vector3[] = [];
      const pr2 = rrect(tw - 2 * inset, th - 2 * inset, R * 0.5 - inset * 0.8, 0, R * 3.9).getSpacedPoints(80);
      for (const q of pr2) P.push(v3(q.x, q.y, 0.0016 * s + 0.00005));
      P.pop();
      const buf = new ThreadBuf();
      stitchAlong(buf, new PathFrames(P, P.map(() => v3(0, 0, 1)), true), { pitch: 0.0025 * s, r: 0.00026 * s });
      buf.addTo(acc, CREAM_THREAD);
      break;
    }
    case 5: {
      // Fabric-covered dome: soft gathers where the cloth wraps under the rim.
      const h = R * 0.42, lift = 0.001 * s;
      const prof: [number, number][] = [[0, lift], [R * 0.9, lift], ...arcPts(R * 0.88, lift + R * 0.12, R * 0.12, -Math.PI / 2, 0, 5).slice(1)];
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        prof.push([R * Math.cos((t * Math.PI) / 2), lift + R * 0.12 + (h - R * 0.12) * Math.sin((t * Math.PI) / 2) ** 0.85]);
      }
      const geo = latheZStamped(prof.map(([r, z]) => [r, z] as [number, number]), 72, (th, r) => (r > R * 0.8 ? -0.00012 * s * Math.max(0, Math.sin(th * 14) * Math.sin(th * 5 + 1)) * ((r - R * 0.8) / (R * 0.2)) : 0));
      acc.add(geo, "main", { crease: 1.0 });
      acc.add(new THREE.CylinderGeometry(R * 0.3, R * 0.34, lift + 0.0002, 16).rotateX(Math.PI / 2).translate(0, 0, lift / 2), "main");
      break;
    }
    case 6:
      dome(acc, "main", R, R * 0.82, 0.0008 * s, 72, false);
      break;
    case 7:
      sewThrough(acc, R, 4, { rimIn: 0.62, rimTop: 0.0042 * s, dishZ: 0.0019 * s, edge: 0.0026 * s });
      break;
    default:
      sewThrough(acc, R, 4, { rimIn: 0.58, rimTop: 0.0031 * s, dishZ: 0.0021 * s, edge: 0.0019 * s });
  }
  return acc.finish();
};

/** Height of an ascending [r, z] profile at r. */
function bandAt(band: [number, number][], r: number): number {
  if (r <= band[0][0]) return band[0][1];
  for (let i = 1; i < band.length; i++) {
    if (r <= band[i][0]) {
      const [r0, z0] = band[i - 1], [r1, z1] = band[i];
      return z0 + ((z1 - z0) * (r - r0)) / Math.max(1e-9, r1 - r0);
    }
  }
  return band[band.length - 1][1];
}

// ---------- Drawstring ----------

/** Metal or plastic aglet: a slim tube with crimp rings and a rounded tip, along +Y from the cord end. */
function agletGeo(r: number, len: number): THREE.BufferGeometry {
  const R = r * 1.18;
  const prof: [number, number][] = [
    [0, -len * 0.08], [r * 0.9, -len * 0.08], [R, 0], [R, len * 0.1], [R * 1.06, len * 0.13], [R, len * 0.16], [R * 0.97, len * 0.8], [R * 1.04, len * 0.83], [R * 0.95, len * 0.86],
    ...arcPts(R * 0.45, len * 0.9, R * 0.5, 0, Math.PI / 2, 5).slice(1), [0, len * 0.9 + R * 0.5],
  ];
  return latheZ(prof, 28).rotateX(-Math.PI / 2);
}

/** Overhand knot blob at the cord end. */
function knotGeo(r: number): THREE.BufferGeometry {
  return new THREE.TorusKnotGeometry(r * 1.25, r * 0.95, 72, 8, 2, 3).rotateX(Math.PI / 2).translate(0, r * 1.3, 0);
}

/** Cord along the path; aglets point outward along the path tangent at the ends. */
export const drawstring: Builder = (p, path) => {
  const f = PathFrames.from(path, 0.2);
  const L = f.length;
  const r = p.radius;
  const aglet = Math.round(p.aglet);
  const both = Math.round(p.ends) === 0;
  const tipLen = aglet === 2 ? r * 2.6 : Math.max(0.012, r * 6);
  const s0 = both ? Math.min(L * 0.3, tipLen * (aglet === 2 ? 0.4 : 0.9)) : 0;
  const s1 = L - Math.min(L * 0.3, tipLen * (aglet === 2 ? 0.4 : 0.9));
  const n = clamp(Math.ceil((s1 - s0) / 0.0012), 16, 900);
  const P: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) P.push(f.point(s0 + ((s1 - s0) * i) / n, 0, r));
  const cordMat = softMat(p.cord, SOFT_HEX.ecru, "cotton");
  const acc = new Acc();
  const curve = new THREE.CatmullRomCurve3(P, false, "centripetal");
  acc.add(braidTube(curve, n, r, 10, 4, r * 3.2, 0.13), cordMat);
  const tipMat: Piece["mat"] = aglet === 1 ? (m) => getMaterial({ preset: "plastic_gloss", color: softOf(m, p.cord, SOFT_HEX.ecru, "cotton").color, opacity: 0.75 }) : finishMaterial(p.finish, FINISH.nickel);
  const ends = both ? [0, 1] : [1];
  for (const e of ends) {
    const at = e === 1 ? s1 : s0;
    const fr = f.at(at);
    const out = fr.t.clone().multiplyScalar(e === 1 ? 1 : -1);
    const g = aglet === 2 ? knotGeo(r) : agletGeo(r, tipLen);
    const side = fr.n.clone().cross(out).normalize();
    _m4.makeBasis(side, out, fr.n.clone().crossVectors(side, out).normalize()).setPosition(fr.p.clone().addScaledVector(fr.n, r));
    acc.add(g.applyMatrix4(_m4), aglet === 2 ? cordMat : tipMat, aglet === 2 ? {} : { crease: 0.7 });
  }
  return acc.finish();
};

// ---------- Hook and eye ----------

/** Closed wire loop points (sewing ring) around (cx, cy), starting/ending at angle a0. */
function ringPts(cx: number, cy: number, r: number, a0: number, z: number, n = 12): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 * 0.92;
    out.push(v3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
  }
  return out;
}

export const hookEye: Builder = (p) => {
  const acc = new Acc();
  const hw = finishMaterial(p.finish, FINISH.nickel);
  const wr = mm(0.42);
  const z = wr;
  // Hook: sewing ring, leg, bill folded up and back over the legs, other leg, other ring.
  const hx = mm(1.6);
  const hook = [
    ...ringPts(mm(-8.2) + hx, mm(2.2), mm(1.3), -Math.PI / 2 + 0.3, z),
    v3(mm(-5.5) + hx, mm(0.85), z), v3(mm(-1) + hx, mm(0.8), z), v3(mm(0.6) + hx, mm(0.8), z * 1.3),
    v3(mm(1.25) + hx, mm(0.75), mm(1.0)), v3(mm(0.4) + hx, mm(0.7), mm(1.55)), v3(mm(-1.8) + hx, mm(0.62), mm(1.55)),
    v3(mm(-2.6) + hx, 0, mm(1.5)),
    v3(mm(-1.8) + hx, mm(-0.62), mm(1.55)), v3(mm(0.4) + hx, mm(-0.7), mm(1.55)), v3(mm(1.25) + hx, mm(-0.75), mm(1.0)),
    v3(mm(0.6) + hx, mm(-0.8), z * 1.3), v3(mm(-1) + hx, mm(-0.8), z), v3(mm(-5.5) + hx, mm(-0.85), z),
    ...ringPts(mm(-8.2) + hx, mm(-2.2), mm(1.3), Math.PI / 2 - 0.3, z).reverse(),
  ];
  acc.add(tube(new THREE.CatmullRomCurve3(hook, false, "centripetal", 0.5), 170, wr, 8), hw);
  // Eye: two sewing rings joined by a bar that bows toward the hook.
  const eye = [
    ...ringPts(mm(8.2), mm(2.4), mm(1.3), -Math.PI / 2 - 0.3, z).reverse(),
    v3(mm(5.5), mm(1.5), z), v3(mm(3.4), mm(1.45), z), v3(mm(2.3), mm(0.8), z), v3(mm(2.0), 0, z), v3(mm(2.3), mm(-0.8), z), v3(mm(3.4), mm(-1.45), z), v3(mm(5.5), mm(-1.5), z),
    ...ringPts(mm(8.2), mm(-2.4), mm(1.3), Math.PI / 2 + 0.3, z),
  ];
  acc.add(tube(new THREE.CatmullRomCurve3(eye, false, "centripetal", 0.5), 120, wr, 8), hw);
  // Whip stitches over each sewing ring.
  for (const [cx, cy] of [[mm(-8.2) + hx, mm(2.2)], [mm(-8.2) + hx, mm(-2.2)], [mm(8.2), mm(2.4)], [mm(8.2), mm(-2.4)]]) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 * 0.85 + (cx > 0 ? Math.PI * 0.6 : -Math.PI * 0.4);
      const st = new THREE.TorusGeometry(mm(0.6), mm(0.16), 5, 10, Math.PI).rotateX(Math.PI / 2).rotateZ(a).translate(cx + Math.cos(a) * mm(1.3), cy + Math.sin(a) * mm(1.3), z * 0.6);
      acc.add(st, DARK_THREAD);
    }
  }
  return acc.finish();
};

// ---------- Lacing ----------

/** Small metal eyelet ring on the surface, facing N. */
function eyeletGeo(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [mm(1.6), -mm(0.4)], [mm(1.6), mm(0.5)], ...arcPts(mm(2.05), mm(0.5), mm(0.45), Math.PI, Math.PI / 2, 5).slice(1), [mm(2.6), mm(0.98)],
    ...arcPts(mm(2.6), mm(0.55), mm(0.43), Math.PI / 2, -0.4, 5).slice(1), [mm(3.1), 0], [mm(1.9), 0], [mm(1.9), -mm(0.4)], [mm(1.6), -mm(0.4)],
  ];
  return latheZ(prof.reverse(), 24);
}

export const lacing: Builder = (p, path) => {
  const f = PathFrames.from(path, 0.2);
  const L = f.length;
  const n = clamp(Math.round(p.count), 2, 20);
  const half = p.width / 2;
  const flat = Math.round(p.lace) === 1;
  const bow = Math.round(p.bow) === 0;
  const acc = new Acc();
  const hw = finishMaterial(p.finish, FINISH.nickel);
  const laceMat = softMat(p.lace_color, SOFT_HEX.black, "cotton");
  const margin = Math.min(0.012, L * 0.06);
  const sAt = (i: number) => margin + ((L - 2 * margin) * i) / (n - 1);
  const eye = eyeletGeo();
  const holes: { l: THREE.Vector3; r: THREE.Vector3; n: THREE.Vector3; f: Frame }[] = [];
  for (let i = 0; i < n; i++) {
    const fr = f.at(sAt(i));
    const l = fr.p.clone().addScaledVector(fr.w, -half), r = fr.p.clone().addScaledVector(fr.w, half);
    for (const c of [l, r]) {
      const side = fr.t.clone();
      _m4.makeBasis(side, fr.n.clone().cross(side).normalize(), fr.n).setPosition(c.clone().addScaledVector(fr.n, mm(0.25)));
      acc.add(eye.clone().applyMatrix4(_m4), hw, { crease: 0.7 });
      acc.add(new THREE.CircleGeometry(mm(1.6), 16).applyMatrix4(_m4).translate(fr.n.x * mm(0.05), fr.n.y * mm(0.05), fr.n.z * mm(0.05)), { preset: "plastic_matte", color: "#0B0B0C", roughness: 1 });
    }
    holes.push({ l, r, n: fr.n, f: fr });
  }
  eye.dispose();
  const lr = flat ? mm(0.8) : mm(1.1);
  const laceW = mm(4.5);
  const addLace = (ptsList: THREE.Vector3[], nrm: THREE.Vector3) => {
    const curve = new THREE.CatmullRomCurve3(ptsList, false, "centripetal");
    const segs = Math.max(12, Math.ceil(curve.getLength() / 0.002));
    if (flat) acc.add(sweep(curve.getSpacedPoints(segs), rrectProfile(lr, laceW, lr * 0.45, 2), nrm), laceMat);
    else acc.add(braidTube(curve, segs, lr, 8, 3, mm(3), 0.14), laceMat);
  };
  const up = (q: THREE.Vector3, nrm: THREE.Vector3, h: number) => q.clone().addScaledVector(nrm, h);
  // Bottom bar straight across the first pair.
  const h0 = holes[0];
  addLace([up(h0.l, h0.n, -mm(0.5)), up(h0.l, h0.n, mm(1.2)), up(h0.l.clone().lerp(h0.r, 0.5), h0.n, mm(1.6)), up(h0.r, h0.n, mm(1.2)), up(h0.r, h0.n, -mm(0.5))], h0.n);
  for (let i = 0; i < n - 1; i++) {
    const a = holes[i], b = holes[i + 1];
    const nm = a.n.clone().add(b.n).normalize();
    for (const [from, to, over] of [[a.l, b.r, i % 2 === 0], [a.r, b.l, i % 2 === 1]] as const) {
      const mid = from.clone().lerp(to, 0.5);
      addLace([up(from, a.n, -mm(0.5)), up(from.clone().lerp(to, 0.08), nm, mm(1.4)), up(mid, nm, over ? mm(3.2) : mm(1.7)), up(from.clone().lerp(to, 0.92), nm, mm(1.4)), up(to, b.n, -mm(0.5))], nm);
    }
  }
  if (bow) {
    // Bow above the last pair: two loops and two tails from a center knot.
    const top = holes[n - 1];
    const T = top.f.t, W = top.f.w, N = top.n;
    const c = top.l.clone().lerp(top.r, 0.5).addScaledVector(T, mm(5)).addScaledVector(N, mm(2.5));
    const P = (t: number, w: number, h: number) => c.clone().addScaledVector(T, t).addScaledVector(W, w).addScaledVector(N, h);
    const loopLen = Math.max(mm(16), half * 0.9);
    for (const side of [-1, 1]) {
      addLace([P(0, side * mm(1), 0), P(mm(4), side * loopLen * 0.35, mm(1)), P(mm(7), side * loopLen * 0.85, mm(1.4)), P(mm(2), side * loopLen, mm(1.6)), P(-mm(4), side * loopLen * 0.7, mm(1.2)), P(-mm(2), side * mm(3), mm(0.8)), P(0, side * mm(0.5), mm(0.4))], N);
      addLace([P(-mm(1), side * mm(1.2), 0), P(-mm(8), side * mm(4), -mm(0.6)), P(-mm(18), side * mm(6.5), -mm(1.6)), P(-mm(30), side * mm(7), -mm(2))], N);
    }
    acc.add(new THREE.SphereGeometry(lr * 2.4, 16, 12).scale(1.2, 1, 0.8).applyMatrix4(_m4.makeBasis(W, T, N).setPosition(c.clone().addScaledVector(N, mm(0.6)))), laceMat);
    for (const side of [-1, 1]) {
      const from = side < 0 ? top.l : top.r;
      addLace([up(from, N, -mm(0.5)), up(from.clone().lerp(c, 0.3), N, mm(1.4)), up(from.clone().lerp(c, 0.7), N, mm(2)), c.clone().addScaledVector(W, side * mm(1.5))], N);
    }
  }
  return acc.finish();
};

export const CLOSURE_BUILDERS: Record<string, Builder> = {
  zipper_path: zipperPath,
  button,
  drawstring,
  hook_eye: hookEye,
  lacing,
};
