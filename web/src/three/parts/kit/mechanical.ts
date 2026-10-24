import * as THREE from "three";
import {
  Acc, M, type MatRef, type Params, type Piece, arcPts, chaikin, circleHole, circleShape, clamp, extrude, lathe, latheDisplaced,
  latheZ, luminance, polyHole, polyShape, rbox, rrect, rrectProfile, stitchRow, sweep, v3,
} from "./core.ts";
import { addScrew } from "./fasteners.ts";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- Wheels ----------

/**
 * Wheel centered at the origin with its axle along X. `windows` picks spoke cut-outs (bike / luggage
 * style) or round lightening holes (caster style).
 */
function wheelParts(acc: Acc, r: number, w: number, mats: { tire: MatRef; rim: MatRef; hub: MatRef }, windows: "spokes" | "holes", tread = true) {
  const toX = (g: THREE.BufferGeometry) => g.rotateZ(-Math.PI / 2);
  const td = tread ? r * 0.045 : r * 0.01;
  const ri = r * 0.66, rt = r - td;
  const rc = (ri + rt) / 2, hr = (rt - ri) / 2, hw = w / 2;
  // Tire carcass: superellipse cross-section revolved around the axle.
  const prof: [number, number][] = [];
  const nE = 3.2, steps = 44;
  const f = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / nE);
  for (let i = 0; i <= steps; i++) {
    const ph = (i / steps) * Math.PI * 2;
    prof.push([rc + hr * f(Math.cos(ph)), hw * f(Math.sin(ph))]);
  }
  acc.add(toX(lathe(prof, tread ? 72 : 64)), mats.tire, { crease: 0.9 });
  // Tread lugs: two staggered rows in a chevron.
  const N = Math.max(12, Math.round((Math.PI * 2 * r) / (r * 0.25)));
  const arc = (Math.PI * 2 * r) / N;
  for (let row = 0; row < (tread ? 2 : 0); row++) {
    const a = (row === 0 ? -1 : 1) * hw * 0.42;
    for (let i = 0; i < N; i++) {
      const th = ((i + row * 0.5) / N) * Math.PI * 2;
      const lug = rbox(hw * 0.62, td * 1.8, arc * 0.5, Math.min(td * 0.45, arc * 0.12), 1);
      lug.rotateY((row === 0 ? 1 : -1) * 0.32);
      lug.translate(a, r - td * 0.9, 0);
      lug.rotateX(th);
      acc.add(lug, mats.tire);
    }
  }
  // Rim: barrel with flanges that seat the tire.
  const rim: [number, number][] = [
    [ri * 0.9, -hw * 0.6], [ri * 0.94, -hw * 0.74], [ri * 1.02, -hw * 0.8], [ri * 1.06, -hw * 0.76], [ri * 1.04, -hw * 0.7],
    [ri * 1.0, -hw * 0.66], [ri * 1.0, hw * 0.66], [ri * 1.04, hw * 0.7], [ri * 1.06, hw * 0.76], [ri * 1.02, hw * 0.8],
    [ri * 0.94, hw * 0.74], [ri * 0.9, hw * 0.6], [ri * 0.9, -hw * 0.6],
  ];
  acc.add(toX(lathe(rim, 72)), mats.rim, { crease: 0.6 });
  // Disc with windows between spokes.
  const discR = ri * 0.92;
  const hubR = r * 0.2;
  const disc = circleShape(discR, 0, 0, 72);
  if (windows === "spokes") {
    const ns = 5, sw = r * 0.12;
    const r1 = hubR + r * 0.06, r2 = ri * 0.84;
    for (let s = 0; s < ns; s++) {
      const a0 = (s / ns) * Math.PI * 2, a1 = ((s + 1) / ns) * Math.PI * 2;
      const d2 = Math.asin(Math.min(0.9, sw / 2 / r2)), d1 = Math.asin(Math.min(0.9, sw / 2 / r1));
      if (a1 - a0 - 2 * d1 < 0.15) continue;
      const pts: [number, number][] = [];
      const k = 10;
      for (let i = 0; i <= k; i++) {
        const a = a0 + d2 + ((a1 - a0 - 2 * d2) * i) / k;
        pts.push([Math.cos(a) * r2, Math.sin(a) * r2]);
      }
      for (let i = k; i >= 0; i--) {
        const a = a0 + d1 + ((a1 - a0 - 2 * d1) * i) / k;
        pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
      }
      disc.holes.push(polyHole(chaikin(pts, 2)));
    }
  } else {
    const nh = 6;
    const rr = (hubR + ri * 0.85) / 2, hR = (ri * 0.85 - hubR) * 0.36;
    for (let s = 0; s < nh; s++) {
      const a = (s / nh) * Math.PI * 2;
      disc.holes.push(circleHole(hR, Math.cos(a) * rr, Math.sin(a) * rr, 28));
    }
  }
  const dz = w * 0.24;
  const db = Math.min(dz * 0.3, r * 0.02);
  acc.add(extrude(disc, dz, db, { z0: -dz / 2, bevelSegs: 2 }).rotateY(Math.PI / 2), mats.rim, { crease: 0.8 });
  // Hub barrel with a bearing bore, axle and nuts.
  const hub: [number, number][] = [
    [r * 0.075, -hw * 0.86], [hubR * 0.8, -hw * 0.86], ...arcPts(hubR * 0.8, -hw * 0.86 + hubR * 0.2, hubR * 0.2, -Math.PI / 2, 0, 4),
    [hubR, hw * 0.86 - hubR * 0.2], ...arcPts(hubR * 0.8, hw * 0.86 - hubR * 0.2, hubR * 0.2, 0, Math.PI / 2, 4),
    [r * 0.075, hw * 0.86], [r * 0.075, -hw * 0.86],
  ];
  acc.add(toX(lathe(hub, 48)), mats.hub, { crease: 0.6 });
  acc.add(toX(new THREE.CylinderGeometry(r * 0.07, r * 0.07, w, 24)), M.steel);
  for (const sx of [-1, 1]) {
    const nut = new THREE.CylinderGeometry(r * 0.115, r * 0.115, w * 0.08, 6).rotateZ(Math.PI / 2).translate(sx * hw * 0.9, 0, 0);
    acc.add(nut, M.steel, { crease: 0.6 });
    acc.add(new THREE.SphereGeometry(r * 0.07, 16, 8).scale(0.5, 1, 1).translate(sx * hw, 0, 0), M.steel);
  }
}

export function wheel(p: Params): Piece[] {
  const acc = new Acc();
  wheelParts(acc, p.radius, p.width, { tire: "main", rim: M.brushed, hub: M.chrome }, "spokes");
  return acc.finish();
}

export function wheelCaster(): Piece[] {
  const acc = new Acc();
  const wy = -0.045;
  const sub = new Acc();
  wheelParts(sub, 0.025, 0.018, { tire: M.rubberBlack, rim: M.greyPlastic, hub: M.greyPlastic }, "holes", false);
  for (const pc of sub.finish()) acc.add(pc.geo.translate(0, wy, 0), pc.mat, { keepUV: false });
  // Mounting plate (in XZ, facing -Y) with four screws.
  const plate = rrect(0.05, 0.05, 0.007);
  const bolts: [number, number][] = [[0.0185, 0.0185], [-0.0185, 0.0185], [-0.0185, -0.0185], [0.0185, -0.0185]];
  for (const [x, z] of bolts) plate.holes.push(circleHole(0.0026, x, z, 24));
  acc.add(extrude(plate, 0.003, 0.0008, { bevelSegs: 3 }).rotateX(Math.PI / 2), "main", { crease: 0.8 });
  for (const [x, z] of bolts) addScrew(acc, 0.8, [x, -0.0027, z], [Math.PI / 2, 0, 0]);
  // Swivel raceway.
  const race: [number, number][] = [
    [0, -0.0095], [0.0158, -0.0095], [0.0182, -0.0086], [0.0185, -0.0072], [0.0172, -0.0062], [0.0186, -0.0052], [0.019, -0.0040], [0.0185, -0.0030], [0, -0.0030],
  ];
  acc.add(lathe(race, 64), M.steel, { crease: 0.6 });
  acc.add(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0014, 6).translate(0, -0.0102, 0), M.steel, { crease: 0.6 });
  // Fork: top bridge + two legs to the axle.
  acc.add(rbox(0.031, 0.004, 0.034, 0.0016, 3).translate(0, -0.0118, 0), "main");
  const leg = polyShape(chaikin([[-0.0165, -0.0105], [0.0165, -0.0105], [0.0105, -0.034], [0.0072, -0.0465], [0.0035, -0.0515], [-0.0035, -0.0515], [-0.0072, -0.0465], [-0.0105, -0.034]], 3));
  for (const sx of [-1, 1]) {
    const g = extrude(leg, 0.0034, 0.0009, { bevelSegs: 3 }).rotateY(Math.PI / 2).translate(sx > 0 ? 0.0105 : -0.0139, 0, 0);
    acc.add(g, "main", { crease: 0.8 });
    // Axle bolt head / nut.
    acc.add(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0016, 6).rotateZ(Math.PI / 2).translate(sx * 0.0148, wy, 0), M.steel, { crease: 0.6 });
  }
  acc.add(new THREE.CylinderGeometry(0.0021, 0.0021, 0.03, 20).rotateZ(Math.PI / 2).translate(0, wy, 0), M.steel);
  return acc.finish();
}

// ---------- Handles ----------

export function handleGrip(p: Params): Piece[] {
  const L = p.length;
  const acc = new Acc();
  const a = L / 2;
  const o = Math.min(1, L / 0.16);
  const h = Math.min(0.05, Math.max(0.022, L * 0.3125));
  const padT = 0.0069;
  const hc = h - padT;
  const ctrl: [number, number][] = [
    [-a + 0.002, 0.0036], [-a + 0.014 * o, 0.0036], [-a + 0.024 * o, 0.45 * hc + 0.0015], [-a + 0.036 * o, 0.88 * hc], [-a + 0.052 * o, hc],
    [a - 0.052 * o, hc], [a - 0.036 * o, 0.88 * hc], [a - 0.024 * o, 0.45 * hc + 0.0015], [a - 0.014 * o, 0.0036], [a - 0.002, 0.0036],
  ];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => v3(x, 0, z)), false, "centripetal");
  const path = curve.getSpacedPoints(Math.round(140 * Math.max(1, L / 0.16) ** 0.5));
  const np = path.length;
  const padStart = a - 0.05 * o, padEnd = a - 0.03 * o;
  const sc = (t: number): [number, number] => {
    const x = path[Math.round(t * (np - 1))].x;
    const k = 1 - smoothstep(padStart, padEnd, Math.abs(x));
    const ribs = 1 - 0.06 * k * (0.5 + 0.5 * Math.cos((x / 0.0075) * Math.PI * 2));
    return [1 + 0.12 * k, (1 + 1.3 * k) * ribs];
  };
  acc.add(sweep(path, rrectProfile(0.026, 0.006, 0.0026, 5), v3(0, 1, 0), { scale: sc }), "main");
  // Edge stitching along the padded sleeve.
  for (const sy of [-1, 1]) {
    const seg = path.filter((q) => Math.abs(q.x) < padStart - 0.004);
    if (seg.length < 2) continue;
    const c = new THREE.CatmullRomCurve3(seg.map((q) => q.clone().setY(sy * 0.0128).setZ(q.z + 0.0005)));
    const len = c.getLength();
    const sp = Math.max(0.003, len / 110);
    const g = stitchRow((u) => ({ p: c.getPointAt(u), t: c.getTangentAt(u), n: v3(0, sy, 0) }), len, { pitch: sp, stitch: sp * 0.72, radius: 0.0003 });
    if (g) acc.add(g, "main");
  }
  // End caps with a screw each.
  const capL = 0.022 * Math.max(0.6, o);
  for (const sx of [-1, 1]) {
    acc.add(rbox(capL, 0.03, 0.0085, 0.0032, 3).translate(sx * (a - capL / 2), 0, 0.00425), M.blackPlastic);
    addScrew(acc, 0.75, [sx * (a - capL / 2), 0, 0.0079]);
  }
  return acc.finish();
}

export function handleTelescoping(p: Params): Piece[] {
  const H = p.height;
  const acc = new Acc();
  const rx = 0.105;
  // Base housing.
  acc.add(rbox(0.25, 0.013, 0.03, 0.005, 3).translate(0, 0.0065, 0.015), M.blackPlastic);
  for (const sx of [-1, 1]) acc.add(rbox(0.032, 0.006, 0.024, 0.0025, 2).translate(sx * rx, 0.015, 0.015), M.greyPlastic);
  const s1 = 0.013 + (H - 0.06) * 0.5;
  const topY = H - 0.034;
  for (const sx of [-1, 1]) {
    const x = sx * rx;
    // Outer (lower) stage.
    acc.add(rbox(0.022, s1 - 0.013, 0.015, 0.0045, 3).translate(x, (0.013 + s1) / 2, 0.015), "main");
    // Collar.
    acc.add(rbox(0.026, 0.011, 0.019, 0.0035, 3).translate(x, s1, 0.015), M.blackPlastic);
    // Inner (upper) stage.
    acc.add(rbox(0.017, topY - s1, 0.011, 0.0035, 3).translate(x, (s1 + topY) / 2, 0.015), "main");
  }
  // Grip: a pillowy molded bar with legs over the rails.
  const g = polyShape(chaikin([
    [-0.13, -0.052], [-0.086, -0.052], [-0.081, -0.033], [0.081, -0.033], [0.086, -0.052], [0.13, -0.052], [0.13, 0], [-0.13, 0],
  ], 4).map(([x, y]): [number, number] => [x, y + H]));
  acc.add(extrude(g, 0.03, 0.0095, { bevelSegs: 6 }), M.blackPlastic, { crease: 0.7 });
  // Release button + soft-touch pad on the front face.
  acc.add(rbox(0.032, 0.011, 0.006, 0.0025, 3).translate(0, H - 0.017, 0.0285), M.greyPlastic);
  acc.add(rbox(0.13, 0.016, 0.004, 0.002, 3).translate(0, H - 0.0165, 0.0272), M.rubberBlack);
  return acc.finish();
}

// ---------- Caps & knobs ----------

export function screwCap(p: Params): Piece[] {
  const R = p.radius;
  const acc = new Acc();
  const H = 1.2 * R, t = 0.07 * R;
  const prof: [number, number][] = [
    [0, H - t], [R - t, H - t], [R - t, 0.04 * R], [R - t * 0.55, 0], [R - 0.03 * R, 0], [R, 0.03 * R], [R, 0.06 * R], [R, 0.1 * R],
  ];
  for (let i = 1; i <= 6; i++) prof.push([R, 0.1 * R + ((0.86 * H - 0.14 * R) * i) / 6]);
  prof.push([R, 0.89 * H]);
  prof.push(...arcPts(R - 0.11 * R, H - 0.11 * R, 0.11 * R, 0, Math.PI / 2, 6).slice(1));
  prof.push([0.82 * R, H], ...arcPts(0.80 * R, H - 0.02 * R, 0.02 * R, 0, Math.PI / 2 + 1.2, 3).slice(1), [0.76 * R, H - 0.025 * R], [0, H - 0.025 * R]);
  const N = Math.round(clamp((Math.PI * 2 * R) / 0.0026, 24, 120));
  const depth = 0.028 * R;
  const g = latheDisplaced(prof, N * 4, (th, y, r) => {
    if (r < R * 0.99) return 0;
    const win = smoothstep(0.07 * R, 0.12 * R, y) * (1 - smoothstep(0.84 * H, 0.89 * H, y));
    const rib = 0.5 + 0.5 * Math.cos(N * th);
    return -depth * win * (1 - rib ** 0.6);
  });
  acc.add(g, "main", { crease: 1.0 });
  return acc.finish();
}

export function knob(p: Params): Piece[] {
  const R = p.radius;
  const s = R / 0.015;
  const acc = new Acc();
  const rb = 0.86 * R;
  const prof: [number, number][] = [
    [0, 0], [0.985 * R, 0], [R, 0.0008 * s], [R, 0.0026 * s],
    ...arcPts(R - 0.0006 * s, 0.0026 * s, 0.0006 * s, 0, Math.PI / 2, 3).slice(1),
    [0.92 * R, 0.0033 * s], [rb + 0.004 * R, 0.0039 * s], [rb + 0.0008 * R, 0.0044 * s],
    [rb, 0.0048 * s], [rb, 0.0053 * s], [rb, 0.0058 * s], [rb, 0.0136 * s], [rb, 0.0141 * s], [rb, 0.0146 * s],
    ...arcPts(rb - 0.0012 * s, 0.0146 * s, 0.0012 * s, 0, Math.PI * 0.4, 4).slice(1),
    [0.79 * R, 0.0172 * s], [0.75 * R, 0.0178 * s], [0.71 * R, 0.0179 * s], [0.67 * R, 0.0176 * s],
    [0.4 * R, 0.0172 * s], [0, 0.0171 * s],
  ];
  const N = Math.round(clamp((Math.PI * 2 * rb) / 0.0013, 24, 140));
  const g = latheDisplaced(prof, N * 4, (th, y, r) => {
    if (r < rb * 0.99) return 0;
    const win = smoothstep(0.0048 * s, 0.0058 * s, y) * (1 - smoothstep(0.0136 * s, 0.0146 * s, y));
    return -0.022 * R * win * (0.5 - 0.5 * Math.cos(N * th)) ** 0.7;
  });
  acc.add(g.rotateX(Math.PI / 2), "main", { crease: 1.0 });
  // Indicator line on the face, pointing +Y.
  const mark = (m: PartMaterial) => getMaterial(luminance(m.color) > 0.42 ? { preset: "plastic_matte", color: "#18191C" } : M.whitePlastic);
  acc.add(rbox(0.075 * R, 0.4 * R, 0.0009 * s, 0.03 * R, 2).translate(0, 0.42 * R, 0.0173 * s), mark);
  // Scale ticks on the skirt.
  for (let i = 0; i < 11; i++) {
    const a = Math.PI / 2 + (-135 + i * 27) * (Math.PI / 180);
    const tk = rbox(0.02 * R, 0.07 * R, 0.0006 * s, 0.008 * R, 1);
    tk.rotateZ(a - Math.PI / 2).translate(Math.cos(a) * 0.935 * R, Math.sin(a) * 0.935 * R, 0.0029 * s);
    acc.add(tk, mark);
  }
  return acc.finish();
}

export function rubberFoot(): Piece[] {
  const acc = new Acc();
  const prof: [number, number][] = [
    [0, 0], [0.0099, 0], [0.0100, 0.0005], [0.0094, 0.0018], [0.0086, 0.0038],
    ...arcPts(0.0068, 0.0042, 0.0018, -0.2, Math.PI / 2, 6), [0.0040, 0.006], ...arcPts(0.0028, 0.0054, 0.0006, Math.PI / 2, Math.PI, 3),
    [0.0022, 0.0042], [0, 0.0042],
  ];
  acc.add(latheZ(prof, 64), "main", { crease: 0.6 });
  addScrew(acc, 0.48, [0, 0, 0.00415]);
  return acc.finish();
}
