import * as THREE from "three";
import { bustRings, type PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import { Acc, type Builder, type Params, type Piece, M, clamp, lathe } from "./core.ts";

/**
 * Display forms: a dress form torso, a hip form and the stand they sit on. Bodies are lofts of
 * superellipse rings (a dress form's cross-section is between an ellipse and a rounded rectangle),
 * with piped seam lines in a darker shade of the cover fabric and turned wood caps.
 */

const WOOD: PartMaterial = { preset: "wood", color: "#7A4E2D" };
const SE = 2.5; // superellipse exponent of the cross-sections

interface Ring {
  y: number;
  /** Half-width (x) and half-depth (z). */
  a: number;
  b: number;
  /** Front offset of the ring center (+z, the bust sits forward). */
  z?: number;
}

const ringPoint = (r: Ring, t: number): THREE.Vector3 => {
  const c = Math.cos(t), s = Math.sin(t);
  const e = 2 / SE;
  return new THREE.Vector3(r.a * Math.sign(c) * Math.abs(c) ** e, r.y, (r.z ?? 0) + r.b * Math.sign(s) * Math.abs(s) ** e);
};

/** A smooth closed loft through rings (bottom to top), capped at the bottom. */
function loft(rings: Ring[], segs = 72): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) for (let j = 0; j < segs; j++) pos.push(...ringPoint(r, (j / segs) * Math.PI * 2).toArray());
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
      idx.push(a, c, b, b, c, d);
    }
  // Bottom cap: a shallow inward dome so the underside reads as upholstered, not cut.
  const r0 = rings[0];
  const inner = rings.length * segs;
  for (let j = 0; j < segs; j++) pos.push(...ringPoint({ ...r0, a: r0.a * 0.78, b: r0.b * 0.78, y: r0.y - 0.006 }, (j / segs) * Math.PI * 2).toArray());
  const center = pos.length / 3;
  pos.push(0, r0.y - 0.009, r0.z ?? 0);
  for (let j = 0; j < segs; j++) {
    const o = j, o2 = (j + 1) % segs;
    idx.push(o, o2, inner + o, o2, inner + o2, inner + o, inner + o, inner + o2, center);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Piping along the loft at angle t (radians around the ring, 0 = +x, PI/2 = front). */
function seam(rings: Ring[], t: number, lift = 0.0009): THREE.BufferGeometry {
  const pts = rings.map((r) => {
    const p = ringPoint(r, t);
    const q = ringPoint(r, t + 0.01);
    // Push out along the ring's outward direction (perpendicular to the ring tangent, in plane).
    const tan = q.sub(p).normalize();
    const out = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
    return p.addScaledVector(out, -lift);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, 0.0013, 6, false);
}

const shade = (m: PartMaterial) => getMaterial({ preset: "cotton", color: `#${new THREE.Color(m.color).multiplyScalar(0.72).getHexString()}` });

/** Turned wood cap (a beveled disc with a finial knob) sitting on y = 0, radius r. */
function woodCap(acc: Acc, r: number, y: number, z = 0): void {
  const disc = lathe([[0, 0], [r * 0.96, 0], [r, 0.004], [r, 0.012], [r * 0.95, 0.016], [0, 0.016]], 48);
  disc.translate(0, y, z);
  acc.add(disc, WOOD, { crease: 0.6 });
  const knob = lathe([[0, 0], [0.011, 0], [0.008, 0.008], [0.006, 0.014], [0.011, 0.022], [0.012, 0.028], [0.008, 0.034], [0, 0.036]], 32);
  knob.translate(0, y + 0.016, z);
  acc.add(knob, WOOD, { crease: 0.9 });
}

/** Brushed collar where the pole meets the form. */
function collar(acc: Acc, y: number, z = 0): void {
  const c = lathe([[0, 0], [0.019, 0], [0.019, 0.026], [0.015, 0.03], [0, 0.03]], 32);
  c.translate(0, y - 0.03, z);
  acc.add(c, M.brushed, { crease: 0.7 });
}

export function formTorso(p: Params): Piece[] {
  const W = p.width / 2, D = p.depth / 2, H = p.height;
  const neckR = clamp(p.width * 0.16, 0.026, 0.058);
  const prof: [number, number, number, number][] = [
    // t (of height), half-width, half-depth (fractions), front offset (fraction of D)
    [0, 0.8, 0.86, 0], [0.12, 0.83, 0.9, 0], [0.3, 0.7, 0.8, 0.02], [0.42, 0.7, 0.82, 0.03], [0.6, 0.8, 0.95, 0.06],
    [0.74, 0.86, 0.93, 0.04], [0.86, 0.93, 0.82, 0], [0.94, 0.9, 0.66, -0.02], [0.985, 0.62, 0.5, -0.04], [1, 0.36, 0.42, -0.05],
  ];
  const rings: Ring[] = prof.map(([t, a, b, z]) => ({ y: t * H, a: a * W, b: b * D, z: z * D }));
  const nz = -0.05 * D;
  rings.push({ y: H + 0.012, a: neckR * 1.18, b: neckR * 1.12, z: nz }, { y: H + 0.03, a: neckR, b: neckR * 0.96, z: nz }, { y: H + p.neck, a: neckR * 0.98, b: neckR * 0.95, z: nz });
  const acc = new Acc();
  acc.add(loft(rings), "main");
  // Seam piping: center front/back, side seams and princess lines (torso only, under the neck).
  const body = rings.slice(0, prof.length);
  for (const t of [Math.PI / 2, -Math.PI / 2, 0, Math.PI, Math.PI / 2 - 0.42, Math.PI / 2 + 0.42]) acc.add(seam(body, t), shade);
  woodCap(acc, neckR * 1.1, H + p.neck, nz);
  collar(acc, 0.0);
  return acc.finish();
}

export function formHip(p: Params): Piece[] {
  const W = p.width / 2, D = p.depth / 2, H = p.height, k = p.waist;
  const prof: [number, number, number][] = [[0, 0.9, 0.94], [0.3, 1, 1], [0.62, 0.5 + 0.5 * k, 0.55 + 0.45 * k], [0.9, k, k * 0.98], [1, k * 0.99, k * 0.97]];
  const rings: Ring[] = prof.map(([t, a, b]) => ({ y: t * H, a: a * W, b: b * D, z: 0 }));
  const acc = new Acc();
  acc.add(loft(rings), "main");
  for (const t of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) acc.add(seam(rings, t), shade);
  // Waist cap: a wood plate in the waist's own shape.
  const top = rings[rings.length - 1];
  const shape = new THREE.Shape();
  for (let j = 0; j <= 64; j++) {
    const q = ringPoint({ ...top, a: top.a * 0.97, b: top.b * 0.97 }, (j / 64) * Math.PI * 2);
    if (j === 0) shape.moveTo(q.x, -q.z);
    else shape.lineTo(q.x, -q.z);
  }
  const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 1 });
  plate.rotateX(-Math.PI / 2);
  plate.translate(0, H + 0.001, 0);
  acc.add(plate, WOOD, { crease: 0.6 });
  const knob = lathe([[0, 0], [0.012, 0], [0.009, 0.01], [0.012, 0.02], [0.008, 0.028], [0, 0.03]], 32);
  knob.translate(0, H + 0.012, 0);
  acc.add(knob, WOOD, { crease: 0.9 });
  collar(acc, 0);
  return acc.finish();
}

/** Velvet jewelry bust: chest, sloped shoulders and a tall neck with a domed top, on a wood plinth. */
export function formBust(p: Params): Piece[] {
  const rings: Ring[] = bustRings({ width: p.width, height: p.height, neck: p.neck });
  const top = rings[rings.length - 1];
  const acc = new Acc();
  // Rounded neck top: a few shrinking rings close the loft.
  const dome: Ring[] = [0.35, 0.7, 0.92, 1].map((k) => ({ y: top.y + Math.sin((k * Math.PI) / 2) * top.a * 0.32, a: top.a * Math.cos((k * Math.PI) / 2.02), b: top.b * Math.cos((k * Math.PI) / 2.02), z: top.z }));
  acc.add(loft([...rings, ...dome], 96), "main");
  const r0 = rings[0];
  const plinth = lathe([[0, 0], [1.08, 0], [1.12, 0.004], [1.12, 0.009], [1.06, 0.012], [0, 0.012]].map(([r, y]) => [r, y] as [number, number]), 64);
  plinth.scale(r0.a, 1, r0.b).translate(0, -0.012, r0.z ?? 0);
  acc.add(plinth, WOOD, { crease: 0.6 });
  return acc.finish();
}

export function formStand(p: Params): Piece[] {
  const H = p.height, R = p.base, tripod = p.style === 1;
  const acc = new Acc();
  const top = H - 0.03;
  if (tripod) {
    // Wood tripod: three splayed legs from a hub, brass ferrules on the feet.
    const hub = Math.min(0.22, H * 0.4);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const foot = new THREE.Vector3(Math.cos(a) * R, 0.012, Math.sin(a) * R);
      const head = new THREE.Vector3(Math.cos(a) * 0.016, hub, Math.sin(a) * 0.016);
      const leg = new THREE.TubeGeometry(new THREE.LineCurve3(foot, head), 1, 0.009, 12, false);
      acc.add(leg, WOOD, { crease: 0.8 });
      const ferrule = lathe([[0, 0], [0.0105, 0], [0.0105, 0.02], [0, 0.02]], 16);
      ferrule.translate(foot.x, 0, foot.z);
      acc.add(ferrule, M.brass, { crease: 0.7 });
    }
    const pole = lathe([[0, 0], [0.011, 0], [0.011, top - hub + 0.03], [0, top - hub + 0.03]], 24);
    pole.translate(0, hub - 0.03, 0);
    acc.add(pole, "main", { crease: 0.8 });
    const h = lathe([[0, 0], [0.02, 0], [0.02, 0.05], [0, 0.05]], 24);
    h.translate(0, hub - 0.04, 0);
    acc.add(h, M.brass, { crease: 0.7 });
  } else {
    // Weighted round base: a beveled iron disc with a raised boss.
    const base = lathe([[0, 0], [R - 0.004, 0], [R, 0.004], [R, 0.012], [R - 0.008, 0.02], [0.05, 0.022], [0.035, 0.034], [0, 0.036]], 72);
    acc.add(base, M.gunmetal, { crease: 0.5 });
    const pole = lathe([[0, 0], [0.011, 0], [0.011, top - 0.03], [0, top - 0.03]], 24);
    pole.translate(0, 0.034, 0);
    acc.add(pole, "main", { crease: 0.8 });
  }
  // Height-adjust collar with a thumb screw near the top.
  const c = lathe([[0, 0], [0.016, 0], [0.016, 0.04], [0.013, 0.043], [0, 0.043]], 24);
  c.translate(0, top - 0.06, 0);
  acc.add(c, "main", { crease: 0.7 });
  const screw = lathe([[0, 0], [0.004, 0], [0.004, 0.012], [0.009, 0.013], [0.009, 0.02], [0, 0.021]], 16);
  screw.rotateZ(-Math.PI / 2);
  screw.translate(0.015, top - 0.04, 0);
  acc.add(screw, M.brushed, { crease: 0.7 });
  return acc.finish();
}

export const DISPLAY_BUILDERS: Record<string, Builder> = {
  form_torso: formTorso,
  form_hip: formHip,
  form_stand: formStand,
  form_bust: formBust,
};
