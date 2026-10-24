import * as THREE from "three";
import {
  Acc, M, type Params, type Piece, arcPts, braidTube, chaikin, circleHole, circleShape, domeZ, extrude, lathe, latheZ,
  polyHole, polyShape, rbox, rrect, rrectHole, rrectProfile, stitchLine, SubCurve, sweep, tube, v3, xf,
} from "./core.ts";

// ---------- Shared sub-assemblies ----------

/** Shadowed bottom of a drive recess. */
const RECESS = { preset: "metal_brushed", color: "#2B2D31", roughness: 0.7 } as const;

/**
 * Phillips pan-head screw sitting on the surface: bottom at z = 0, crown at 0.001 * s.
 * Everything visible stays above z = 0 so a parent surface never hides the recess.
 * Returns [head, recess floor].
 */
export function screwHead(s = 1): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const R = 0.0039 * s;
  const arm = 0.00175 * s, hw = 0.00042 * s;
  const cross: [number, number][] = [
    [hw, hw], [arm, hw * 0.8], [arm, -hw * 0.8], [hw, -hw], [hw * 0.8, -arm], [-hw * 0.8, -arm],
    [-hw, -hw], [-arm, -hw * 0.8], [-arm, hw * 0.8], [-hw, hw], [-hw * 0.8, arm], [hw * 0.8, arm],
  ];
  const shape = circleShape(R);
  shape.holes.push(polyHole([...cross].reverse()));
  // Pan head: flat crown with a generous rounded edge.
  const head = extrude(shape, 0.001 * s, 0.00042 * s, { curveSegs: s < 0.7 ? 28 : 44, bevelSegs: s < 0.7 ? 3 : 4 });
  // Planar UVs: box projection would seam across the rounded edge.
  const hp = head.attributes.position;
  const huv = new Float32Array(hp.count * 2);
  for (let i = 0; i < hp.count; i++) {
    huv[i * 2] = hp.getX(i);
    huv[i * 2 + 1] = hp.getY(i);
  }
  head.setAttribute("uv", new THREE.BufferAttribute(huv, 2));
  head.userData.meterUV = true;
  const floor = extrude(polyShape(cross), 0.00025 * s, 0, { z0: 0.0001 * s });
  return [head, floor];
}

/** Adds a screw head to an accumulator at a position, facing +Z (or rotated). */
export function addScrew(acc: Acc, s: number, p: [number, number, number], r: [number, number, number] = [0, 0, 0], spin = 0.4) {
  const [head, floor] = screwHead(s);
  acc.add(xf(head.rotateZ(spin), p, r), M.steel, { crease: 0.7 });
  acc.add(xf(floor.rotateZ(spin), p, r), RECESS, { crease: 0.5 });
}

/**
 * Zipper slider with pull tab, in a frame where the slider runs along X with its wide shoulder at +X
 * and the tab lying back toward -X. Base of the slider at z = z0.
 */
function sliderAssembly(acc: Acc, bodyMat: Piece["mat"], opts: { tabLen: number; tabW: number; z0: number; drop: number; xf: (g: THREE.BufferGeometry) => THREE.BufferGeometry }) {
  const T = opts.xf;
  const z0 = opts.z0;
  // Body: tapered top-view outline with a soft bevel.
  const outline = chaikin([[-0.008, -0.0039], [0.0035, -0.0054], [0.008, -0.0054], [0.008, 0.0054], [0.0035, 0.0054], [-0.008, 0.0039]], 3);
  acc.add(T(extrude(polyShape(outline), 0.0039, 0.0009, { z0, bevelSegs: 4 })), bodyMat, { crease: 0.9 });
  // Raised center rib on the top plate.
  const rib = chaikin([[-0.0065, -0.0012], [0.004, -0.0016], [0.004, 0.0016], [-0.0065, 0.0012]], 2);
  acc.add(T(extrude(polyShape(rib), 0.0005, 0.0002, { z0: z0 + 0.0037 })), bodyMat, { crease: 0.9 });
  // Bail: a small arched bridge the tab loops through.
  const bailPath = new THREE.CatmullRomCurve3([v3(-0.0036, 0, z0 + 0.0036), v3(-0.0028, 0, z0 + 0.0052), v3(0, 0, z0 + 0.0059), v3(0.0028, 0, z0 + 0.0052), v3(0.0036, 0, z0 + 0.0036)]).getPoints(24);
  acc.add(T(sweep(bailPath, rrectProfile(0.0032, 0.0009, 0.00035), v3(0, 1, 0))), bodyMat);

  // Tab: loop end around the bail, flaring into a paddle with a raised border.
  const L = opts.tabLen, w = opts.tabW;
  const tabOutline = chaikin([[0.0034, -0.0026], [0.0034, 0.0026], [-0.0045, 0.0027], [-0.0080, w / 2], [-L, w / 2], [-L, -w / 2], [-0.0080, -w / 2], [-0.0045, -0.0027]], 3);
  const tabShape = polyShape(tabOutline);
  tabShape.holes.push(rrectHole(0.0016, 0.0036, 0.0006, 0.0003, 0));
  const tz = z0 + 0.0052;
  const tilt = -Math.atan2(opts.drop, L);
  const pose = (g: THREE.BufferGeometry) => T(g.translate(0, 0, tz).rotateY(tilt));
  acc.add(pose(extrude(tabShape, 0.001, 0.00035, { bevelSegs: 3 })), bodyMat, { crease: 0.9 });
  const px0 = -0.0088, px1 = -L + 0.0012;
  const pw = w - 0.0018, plen = px0 - px1;
  const border = rrect(plen, pw, Math.min(0.0022, pw / 2 - 1e-5), (px0 + px1) / 2, 0);
  border.holes.push(rrectHole(plen - 0.0014, pw - 0.0014, Math.min(0.0016, pw / 2 - 0.0008), (px0 + px1) / 2, 0));
  acc.add(pose(extrude(border, 0.00035, 0.00012, { z0: 0.00095 })), bodyMat, { crease: 0.9 });
}

// ---------- Zipper ----------

/**
 * Lean domed prism: vertical walls from z0 to z1 around a 2D outline, then a rounded crown
 * rising `dome` above z1. ~5 triangles per outline point, for heavily repeated details.
 */
function pillowPrism(outline: [number, number][], z0: number, z1: number, dome: number): THREE.BufferGeometry {
  const n = outline.length;
  let cx = 0, cy = 0;
  for (const [x, y] of outline) { cx += x / n; cy += y / n; }
  const ring = (k: number, z: number) => outline.map(([x, y]) => new THREE.Vector3(cx + (x - cx) * k, cy + (y - cy) * k, z));
  const r0 = ring(1, z0), r1 = ring(1, z1), r3 = ring(0.62, z1 + dome * 0.82);
  const top = new THREE.Vector3(cx, cy, z1 + dome);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  // Outline is CCW seen from +Z.
  const ccw = THREE.ShapeUtils.isClockWise(outline.map(([x, y]) => new THREE.Vector2(x, y))) ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const band = (lo: THREE.Vector3[], hi: THREE.Vector3[]) => {
      if (ccw > 0) { tri(lo[i], lo[j], hi[j]); tri(lo[i], hi[j], hi[i]); }
      else { tri(lo[i], hi[j], lo[j]); tri(lo[i], hi[i], hi[j]); }
    };
    band(r0, r1);
    band(r1, r3);
    if (ccw > 0) tri(r3[i], r3[j], top);
    else tri(r3[i], top, r3[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function zipper(p: Params): Piece[] {
  const L = p.length;
  const acc = new Acc();
  // Tape: woven band with a slightly thicker bead along each outer edge.
  acc.add(rbox(L, 0.024, 0.0011, 0.0004, 2).translate(0, 0, 0.00055), "main");
  for (const sy of [-1, 1]) acc.add(rbox(L, 0.0016, 0.0015, 0.0006, 2).translate(0, sy * 0.0112, 0.00075), "main");
  // Interlocking teeth: alternate sides, half a pitch apart.
  const pitch = Math.max(0.003, L / 190);
  const x0 = -L / 2 + 0.0045, x1 = L / 2 - 0.012;
  const n = Math.max(2, Math.floor((x1 - x0) / pitch));
  const pt = pitch;
  const toothPts = chaikin([[-0.25 * pt, 0], [0.25 * pt, 0], [0.27 * pt, 0.0024], [0.33 * pt, 0.0031], [0.24 * pt, 0.0042], [-0.24 * pt, 0.0042], [-0.33 * pt, 0.0031], [-0.27 * pt, 0.0024]], 1);
  const tooth = pillowPrism(toothPts, 0.0002, 0.0019, 0.0007);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch;
    acc.add(tooth.clone().translate(x, -0.003, 0), M.steel, { crease: 0.95 });
    acc.add(tooth.clone().rotateZ(Math.PI).translate(x + pitch / 2, 0.003, 0), M.steel, { crease: 0.95 });
  }
  tooth.dispose();
  // Stops.
  acc.add(rbox(0.003, 0.0088, 0.0026, 0.0008, 2).translate(x0 - 0.0028, 0, 0.0015), M.steel);
  for (const sy of [-1, 1]) acc.add(rbox(0.0024, 0.0036, 0.0024, 0.0007, 2).translate(L / 2 - 0.0085, sy * 0.0027, 0.0014), M.steel);
  // Slider at the +X end, tab lying back over the closed chain.
  const sx = L / 2 - 0.02;
  sliderAssembly(acc, M.steel, { tabLen: 0.02, tabW: 0.0074, z0: 0.0004, drop: 0.0022, xf: (g) => g.translate(sx, 0, 0) });
  return acc.finish();
}

export function zipperPull(): Piece[] {
  const acc = new Acc();
  sliderAssembly(acc, "main", {
    tabLen: 0.032, tabW: 0.0118, z0: 0, drop: 0.0034,
    xf: (g) => g.rotateZ(Math.PI / 2).translate(0, -0.002, 0),
  });
  return acc.finish();
}

// ---------- Buckles ----------

export function buckleSideRelease(): Piece[] {
  const acc = new Acc();
  // Female receiver: lower half, with side windows where the prongs latch.
  const female = chaikin([
    [-0.0172, -0.035], [0.0172, -0.035], [0.0200, -0.0245], [0.0200, -0.0128], [0.0172, -0.0118], [0.0172, -0.0024],
    [0.0200, -0.0014], [0.0200, 0.002], [-0.0200, 0.002], [-0.0200, -0.0014], [-0.0172, -0.0024], [-0.0172, -0.0118],
    [-0.0200, -0.0128], [-0.0200, -0.0245],
  ], 2);
  const fs = polyShape(female);
  fs.holes.push(rrectHole(0.026, 0.0044, 0.0016, 0, -0.0295));
  acc.add(extrude(fs, 0.0118, 0.0018, { bevelSegs: 4 }), "main", { crease: 0.8 });
  // Grip ribs on the receiver face.
  for (let i = 0; i < 3; i++) acc.add(rbox(0.0125 - i * 0.002, 0.0012, 0.0012, 0.0005, 2).translate(0, -0.0205 + i * 0.0032, 0.0115), "main");
  // Prong tips in the windows.
  for (const sx of [-1, 1]) {
    acc.add(rbox(0.0042, 0.0092, 0.0084, 0.0013, 3).translate(sx * 0.0183, -0.0071, 0.0059), "main");
    for (let i = 0; i < 3; i++) acc.add(rbox(0.0009, 0.0068, 0.0009, 0.0004, 1).translate(sx * 0.0186, -0.0071, 0.0101 + 0 * i).translate(sx * (-0.0011 + i * 0.0011), 0, 0), "main");
  }
  // Male: upper half, slightly thinner, strap slot near the top.
  const male = chaikin([[-0.0186, 0.0012], [0.0186, 0.0012], [0.0186, 0.024], [0.0172, 0.035], [-0.0172, 0.035], [-0.0186, 0.024]], 2);
  const ms = polyShape(male);
  ms.holes.push(rrectHole(0.026, 0.0044, 0.0016, 0, 0.0292));
  acc.add(extrude(ms, 0.0084, 0.0016, { z0: 0.0017, bevelSegs: 4 }), "main", { crease: 0.8 });
  // Center guide rail on the male face.
  acc.add(extrude(polyShape(chaikin([[-0.0032, 0.003], [0.0032, 0.003], [0.0026, 0.024], [-0.0026, 0.024]], 2)), 0.0012, 0.0005, { z0: 0.0096 }), "main", { crease: 0.8 });
  return acc.finish();
}

export function buckleBelt(): Piece[] {
  const acc = new Acc();
  const frame = rrect(0.05, 0.045, 0.009);
  frame.holes.push(rrectHole(0.037, 0.032, 0.0035));
  acc.add(extrude(frame, 0.0052, 0.0022, { z0: 0.0013, bevelSegs: 5, curveSegs: 14 }), "main", { crease: 0.9 });
  // Center bar the prong pivots on.
  const bar = new THREE.CylinderGeometry(0.0019, 0.0019, 0.036, 20).translate(0, 0, 0);
  acc.add(bar.translate(-0.006, 0, 0.0042), "main");
  // Prong loop around the bar + tongue reaching over the right edge.
  acc.add(new THREE.TorusGeometry(0.0024, 0.0011, 12, 28).rotateX(Math.PI / 2).translate(-0.006, 0, 0.0042), "main");
  const prongPath = new THREE.CatmullRomCurve3([
    v3(-0.0058, 0, 0.0065), v3(-0.002, 0, 0.0071), v3(0.008, 0, 0.0076), v3(0.0180, 0, 0.0081), v3(0.0216, 0, 0.0076), v3(0.0234, 0, 0.0058), v3(0.0238, 0, 0.0043),
  ], false, "centripetal").getSpacedPoints(48);
  acc.add(sweep(prongPath, rrectProfile(0.0034, 0.0026, 0.0012, 4), v3(0, 1, 0), { scale: (t) => [1 - 0.25 * t, 1 - 0.2 * t] }), "main");
  acc.add(new THREE.SphereGeometry(0.0013, 16, 10).scale(1.3, 1, 1).translate(0.0238, 0, 0.0043), "main");
  return acc.finish();
}

// ---------- Rings & clips ----------

export function dRing(): Piece[] {
  const acc = new Acc();
  const cz = 0.004, by = -0.008;
  // Ring: straight bar along X with a squarish "D" arc below.
  const pts: THREE.Vector3[] = [];
  for (const x of [-0.009, -0.0045, 0, 0.0045, 0.009]) pts.push(v3(x, by, cz));
  const rx = 0.0154, ry = 0.0102, ne = 2.8;
  for (let i = 1; i <= 15; i++) {
    const th = -0.12 - ((Math.PI - 0.24) * (i - 1)) / 14;
    const c = Math.cos(th), s = Math.sin(th);
    pts.push(v3(rx * Math.sign(c) * Math.abs(c) ** (2 / ne), by - ry * Math.abs(s) ** (2 / ne), cz));
  }
  // Order: bar left->right then arc right->left.
  const ring = new THREE.CatmullRomCurve3([...pts.slice(0, 5), ...pts.slice(5)], true, "centripetal");
  acc.add(tube(ring, 160, 0.0018, 14, true), "main");
  // Webbing tab: bottom layer on the surface, wrapping the bar, top layer folded back.
  const wr = 0.0028;
  const tabPath: THREE.Vector3[] = [v3(0, 0.0195, 0.0007), v3(0, 0.008, 0.0007), v3(0, -0.004, 0.0008)];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / 8;
    tabPath.push(v3(0, by + Math.cos(a) * wr, cz + Math.sin(a) * wr));
  }
  tabPath.push(v3(0, -0.004, 0.0062), v3(0, 0.0005, 0.0032), v3(0, 0.005, 0.0021), v3(0, 0.016, 0.0019));
  const tabCurve = new THREE.CatmullRomCurve3(tabPath, false, "centripetal").getSpacedPoints(90);
  acc.add(sweep(tabCurve, rrectProfile(0.022, 0.0011, 0.0004), v3(1, 0, 0)), M.webbingBlack);
  // Box-X stitch.
  const thread = { preset: "cotton", color: "#BDB7AA" } as const;
  const z = 0.00245, xa = 0.0082, ya = 0.0055, yb = 0.0145;
  const c = [v3(-xa, ya, z), v3(xa, ya, z), v3(xa, yb, z), v3(-xa, yb, z)];
  const opts = { pitch: 0.0016, stitch: 0.0012, radius: 0.00022 };
  for (let i = 0; i < 4; i++) {
    const g = stitchLine(c[i], c[(i + 1) % 4], v3(0, 0, 1), opts);
    if (g) acc.add(g, thread);
  }
  for (const [a, b] of [[0, 2], [1, 3]]) {
    const g = stitchLine(c[a], c[b], v3(0, 0, 1), opts);
    if (g) acc.add(g, thread);
  }
  return acc.finish();
}

export function carabiner(): Piece[] {
  const acc = new Acc();
  const P: [number, number][] = [
    [-0.0130, -0.016], [-0.0133, 0.0], [-0.0129, 0.016],
    [-0.0104, 0.0258], [-0.0040, 0.0303], [0.0040, 0.0303], [0.0104, 0.0265], [0.0133, 0.0195],
    [0.0121, 0.0045], [0.0101, -0.0105],
    [0.0082, -0.0225], [0.0022, -0.0291], [-0.0062, -0.0290], [-0.0116, -0.0250],
  ];
  const n = P.length;
  const loop = new THREE.CatmullRomCurve3(P.map(([x, y]) => v3(x, y, 0)), true, "centripetal");
  const r = 0.0037;
  const tNose = 7 / n, tHinge = 9 / n;
  const body = new SubCurve(loop, tHinge, tNose + 1);
  acc.add(tube(body, 180, r, 16, false), "main");
  const nose = loop.getPoint(tNose), hinge = loop.getPoint(tHinge);
  acc.add(new THREE.SphereGeometry(r, 16, 12).translate(nose.x, nose.y, 0), "main");
  acc.add(new THREE.SphereGeometry(r, 16, 12).translate(hinge.x, hinge.y, 0), "main");
  // Nose notch: a small hook lip the gate closes into.
  acc.add(new THREE.SphereGeometry(r * 0.75, 14, 10).scale(1, 1.25, 1).translate(nose.x - 0.0016, nose.y - 0.0032, 0), "main");
  // Gate: straight steel bar from hinge rivet up to the nose.
  const a = v3(hinge.x - 0.0002, hinge.y + 0.002, 0), b = v3(nose.x - 0.0019, nose.y - 0.0052, 0);
  const gate = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5).add(v3(0.0006, 0, 0)), b]);
  acc.add(tube(gate, 24, 0.0022, 14, false), M.brushed);
  acc.add(new THREE.SphereGeometry(0.0022, 14, 10).translate(b.x, b.y, 0), M.brushed);
  acc.add(new THREE.SphereGeometry(0.0022, 14, 10).translate(a.x, a.y, 0), M.brushed);
  // Hinge rivet heads on both faces.
  acc.add(latheZ([[0, -0.0041], [0.0012, -0.0040], [0.0018, -0.0036], [0.0018, 0.0036], [0.0012, 0.0040], [0, 0.0041]], 24).translate(hinge.x, hinge.y, 0), M.steel, { crease: 0.6 });
  return acc.finish();
}

// ---------- Small round hardware ----------

export function snapButton(): Piece[] {
  const acc = new Acc();
  const prof: [number, number][] = [
    [0, 0.005], [0.0016, 0.00496], [0.0031, 0.00475], [0.0043, 0.0043], [0.0051, 0.0037], [0.0056, 0.0031],
    ...arcPts(0.0055, 0.0024, 0.0006, Math.PI / 2 - 0.4, -Math.PI / 2, 6).map(([r, z]): [number, number] => [r, z]),
    [0.0054, 0.0017], [0.0062, 0.00165],
    ...arcPts(0.0063, 0.0011, 0.00065, Math.PI / 2, -Math.PI / 2, 6),
    [0.0061, 0.0], [0, 0],
  ];
  acc.add(latheZ(prof.map(([r, z]) => [r, z] as [number, number]).reverse(), 72), "main", { crease: 0.7 });
  // Fine concentric ring stamped into the dome.
  acc.add(new THREE.TorusGeometry(0.0034, 0.00013, 8, 72).translate(0, 0, 0.00462), "main");
  return acc.finish();
}

export function buttonSewn(p: Params, threadMat: Piece["mat"]): Piece[] {
  const R = p.radius;
  const s = R / 0.008;
  const acc = new Acc();
  const rim: [number, number][] = [
    [0.56, 0.0004], [0.56, 0.0021], [0.62, 0.0025], [0.70, 0.00325], [0.76, 0.00362], [0.82, 0.0037], [0.88, 0.0036],
    [0.94, 0.0032], [0.98, 0.0026], [1.0, 0.0019], [0.995, 0.0011], [0.975, 0.0005], [0.94, 0.0], [0.56, 0.0],
  ];
  acc.add(latheZ(rim.map(([r, z]) => [r * R, z * s] as [number, number]).reverse(), 64), "main", { crease: 0.7 });
  const disc = circleShape(0.6 * R);
  const ho = 0.215 * R, hr = 0.1 * R;
  const holes: [number, number][] = [[ho, ho], [-ho, ho], [-ho, -ho], [ho, -ho]];
  for (const [x, y] of holes) disc.holes.push(circleHole(hr, x, y));
  acc.add(extrude(disc, 0.0019 * s, 0.00035 * s, { z0: 0.0003 * s, curveSegs: 16, bevelSegs: 2 }), "main", { crease: 0.8 });
  // Thread: an X of doubled strands through the four holes.
  const tr = 0.055 * R;
  const top = 0.0022 * s;
  for (const [ai, bi, lift] of [[0, 2, 0], [1, 3, 1]] as const) {
    const A = holes[ai], B = holes[bi];
    const dir = v3(B[0] - A[0], B[1] - A[1], 0).normalize();
    const perp = v3(-dir.y, dir.x, 0);
    for (const off of [-0.4, 0.4]) {
      const o = perp.clone().multiplyScalar(off * tr * 2.2);
      const h = top + tr * (1.2 + lift * 1.9);
      const pts = [
        v3(A[0], A[1], top - hr * 0.6), v3(A[0] + dir.x * hr * 0.5, A[1] + dir.y * hr * 0.5, top + tr * 0.9),
        v3(0, 0, h), v3(B[0] - dir.x * hr * 0.5, B[1] - dir.y * hr * 0.5, top + tr * 0.9), v3(B[0], B[1], top - hr * 0.6),
      ].map((v) => v.add(o));
      acc.add(braidTube(new THREE.CatmullRomCurve3(pts), 40, tr, 8, 2, 0.0014 * s, 0.12), threadMat);
    }
  }
  return acc.finish();
}

export function rivet(): Piece[] {
  const acc = new Acc();
  const a = 0.0031, h = 0.0024;
  const R = (a * a + h * h) / (2 * h);
  const cz = 0.003 - R;
  const dome: [number, number][] = [];
  const th = Math.asin(a / R);
  for (let i = 0; i <= 14; i++) {
    const t = (th * i) / 14;
    dome.push([Math.sin(t) * R, cz + Math.cos(t) * R]);
  }
  const prof: [number, number][] = [...dome, [0.0033, 0.00062], [0.0037, 0.0006], ...arcPts(0.0037, 0.0003, 0.0003, Math.PI / 2, -Math.PI / 2, 5), [0, 0]];
  acc.add(latheZ(prof.reverse(), 56), "main", { crease: 0.7 });
  return acc.finish();
}

export function grommet(): Piece[] {
  const acc = new Acc();
  const prof: [number, number][] = [
    [0.0045, -0.0012], [0.0045, 0.0013],
    ...arcPts(0.0058, 0.0013, 0.0013, Math.PI, Math.PI / 2, 7),
    [0.0066, 0.00262], [0.0072, 0.0024],
    ...arcPts(0.0071, 0.0012, 0.0012, Math.PI / 2 - 0.2, -0.9, 7),
    [0.0076, 0.0], [0.0053, 0.0], [0.0053, -0.0012], [0.0045, -0.0012],
  ];
  acc.add(latheZ(prof.reverse(), 64), "main", { crease: 0.7 });
  acc.add(new THREE.CircleGeometry(0.0046, 40).translate(0, 0, 0.00005), M.void);
  return acc.finish();
}

export function screw(): Piece[] {
  const acc = new Acc();
  const [head, floor] = screwHead(1);
  acc.add(head.rotateZ(0.4), "main", { crease: 0.7 });
  acc.add(floor.rotateZ(0.4), RECESS, { crease: 0.5 });
  return acc.finish();
}

// ---------- Cord lock ----------

export function cordLock(cordMat: Piece["mat"]): Piece[] {
  const acc = new Acc();
  const cz = 0.006;
  // Barrel body, axis X: lathe around Y then turned so +Y maps to +X.
  const prof: [number, number][] = [
    [0, -0.0075], [0.0038, -0.0075], ...arcPts(0.0040, -0.0055, 0.002, -Math.PI / 2, 0, 5), [0.0060, -0.0055],
    [0.0060, 0.0028], ...arcPts(0.0046, 0.0028, 0.0014, 0, Math.PI / 2, 4), [0.0040, 0.0042], [0, 0.0042],
  ];
  // Grip grooves around the barrel.
  const groove = (y: number) => {
    let d = 0;
    for (const gy of [-0.004, -0.0025, -0.001, 0.0005, 0.002]) d += Math.exp(-(((y - gy) / 0.00028) ** 2));
    return d;
  };
  const dense: [number, number][] = [];
  for (let i = 0; i < prof.length; i++) {
    dense.push(prof[i]);
    const [r0, y0] = prof[i];
    const nx = prof[i + 1];
    if (nx && Math.abs(r0 - 0.006) < 1e-6 && Math.abs(nx[0] - 0.006) < 1e-6) {
      const steps = 24;
      for (let k = 1; k < steps; k++) dense.push([0.006, y0 + ((nx[1] - y0) * k) / steps]);
    }
  }
  const barrel = lathe(dense, 48);
  const pos = barrel.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.0059) {
      const k = (r - 0.00045 * groove(y)) / r;
      pos.setXYZ(i, x * k, y, z * k);
    }
  }
  barrel.deleteAttribute("normal");
  acc.add(barrel.rotateZ(-Math.PI / 2).translate(-0.0005, 0, cz), "main", { crease: 0.7 });
  // Plunger cap at +X.
  const plunger: [number, number][] = [[0, 0.0040], [0.0041, 0.0040], [0.0043, 0.0050], [0.0043, 0.0062], ...arcPts(0.0033, 0.0068, 0.001, 0, Math.PI / 2, 4), [0, 0.0078]];
  const pl = lathe(plunger, 40);
  acc.add(pl.rotateZ(-Math.PI / 2).translate(-0.0005, 0, cz), M.greyPlastic, { crease: 0.7 });
  // Cord: two strands down through the body, joined in a loop below.
  const cord = new THREE.CatmullRomCurve3([
    v3(-0.0017, 0.0152, cz), v3(-0.0017, 0.004, cz), v3(-0.0018, -0.006, cz), v3(-0.0038, -0.0102, cz), v3(0, -0.0135, cz),
    v3(0.0038, -0.0102, cz), v3(0.0018, -0.006, cz), v3(0.0017, 0.004, cz), v3(0.0017, 0.0152, cz),
  ], false, "centripetal");
  acc.add(braidTube(cord, 160, 0.0014, 10, 4, 0.0035, 0.12), cordMat);
  return acc.finish();
}

// ---------- Strap tip ----------

export function strapEnd(): Piece[] {
  const acc = new Acc();
  acc.add(rbox(0.025, 0.066, 0.0018, 0.0006, 2).translate(0, 0.007, 0.0009), "main");
  // Thicker selvage edges.
  for (const sx of [-1, 1]) acc.add(rbox(0.0016, 0.066, 0.0022, 0.0007, 2).translate(sx * 0.0117, 0.007, 0.0011), "main");
  const st = stitchLine(v3(-0.009, -0.019, 0.0018), v3(0.009, -0.019, 0.0018), v3(0, 0, 1), { pitch: 0.0022, stitch: 0.0016, radius: 0.00025 });
  if (st) acc.add(st, "main");
  // Metal tip cap with a rounded end and two rivets.
  const tip = chaikin([[-0.014, -0.0235], [0.014, -0.0235], [0.014, -0.032], [0.008, -0.0398], [-0.008, -0.0398], [-0.014, -0.032]], 3);
  acc.add(extrude(polyShape(tip), 0.0046, 0.0013, { bevelSegs: 4 }), M.brushed, { crease: 0.8 });
  // Crimp line near the top edge.
  acc.add(rbox(0.026, 0.0007, 0.0005, 0.0002, 1).translate(0, -0.0258, 0.0046), M.gunmetal);
  for (const sx of [-1, 1]) acc.add(domeZ(0.0017, 0.0008, 24, 6).translate(sx * 0.0068, -0.0318, 0.0045), M.steel);
  return acc.finish();
}

// ---------- Hinge ----------

export function hinge(p: Params): Piece[] {
  const L = p.length;
  const acc = new Acc();
  const r = 0.0034, cz = 0.0042;
  let k = Math.min(21, Math.max(3, Math.round(L / 0.012)));
  if (k % 2 === 0) k += 1;
  const gap = Math.min(0.0004, L * 0.01);
  const kl = (L - (k - 1) * gap) / k;
  const ch = Math.min(0.0004, kl * 0.15);
  const knuckle = lathe([[0, -kl / 2], [r - ch, -kl / 2], [r, -kl / 2 + ch], [r, kl / 2 - ch], [r - ch, kl / 2], [0, kl / 2]], 36);
  for (let i = 0; i < k; i++) {
    const x = -L / 2 + kl / 2 + i * (kl + gap);
    acc.add(knuckle.clone().rotateZ(-Math.PI / 2).translate(x, 0, cz), "main", { crease: 0.6 });
    // Web joining the knuckle to its leaf.
    const side = i % 2 === 0 ? 1 : -1;
    acc.add(rbox(kl, 0.0045, 0.0022, 0.0006, 2).translate(x, side * 0.0024, 0.0011), "main");
  }
  knuckle.dispose();
  // Pin heads.
  for (const sx of [-1, 1]) acc.add(domeZ(0.0022, 0.0007, 24, 6).rotateY((sx * Math.PI) / 2).translate(sx * (L / 2), 0, cz), "main");
  // Leaves with countersunk screws.
  const nScrews = Math.max(2, Math.min(6, Math.round(L / 0.028)));
  for (const sy of [-1, 1]) {
    const leaf = rrect(L, 0.0195, 0.0028, 0, sy * 0.01025);
    const xs: number[] = [];
    for (let i = 0; i < nScrews; i++) xs.push(-L / 2 + (L * (i + 0.5)) / nScrews);
    for (const x of xs) leaf.holes.push(circleHole(0.0022, x, sy * 0.0125));
    acc.add(extrude(leaf, 0.0012, 0.0003, { curveSegs: 10, bevelSegs: 2 }), "main", { crease: 0.8 });
    for (const x of xs) addScrew(acc, 0.58, [x, sy * 0.0125, 0.00055], [0, 0, 0], 0.3 + x * 40);
  }
  return acc.finish();
}
