import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { svgOutline, type Geometry, type GeometryOf } from "@wishit/shared";
import { boxProjectUVs, scaleUVs } from "./uv.ts";

/**
 * Procedural geometry for a part, in meters, with UVs in meters (see uv.ts). Profiles and paths
 * from the genie are coarse, so curves are smoothed and resampled to look manufactured, not low-poly.
 */
export function buildGeometry(g: Geometry): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry;
  switch (g.type) {
    case "roundedBox": geo = roundedBox(g.params); break;
    case "lathe": geo = lathe(g.params); break;
    case "tube": geo = tube(g.params); break;
    case "extrude": geo = extrude(g.params); break;
    case "sphere": geo = sphere(g.params); break;
    case "cylinder": geo = cylinder(g.params); break;
    case "capsule": geo = capsule(g.params); break;
    case "torus": geo = torus(g.params); break;
    default: geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

const rad = THREE.MathUtils.degToRad;

function roundedBox(p: GeometryOf<"roundedBox">["params"]) {
  const min = Math.min(p.width, p.height, p.depth);
  const r = Math.min(p.radius ?? min * 0.12, min / 2 - 1e-5);
  const geo = new RoundedBoxGeometry(p.width, p.height, p.depth, r > min * 0.02 ? 6 : 2, Math.max(0, r));
  return boxProjectUVs(geo);
}

/** Smooth a 2D/3D polyline with a centripetal Catmull-Rom curve and resample it evenly. */
function resample(points: THREE.Vector3[], n: number, closed = false, sharp = false): THREE.Vector3[] {
  if (points.length < 2) return points;
  if (sharp) {
    // Straight segments, subdivided so lighting stays smooth along each run.
    const out: THREE.Vector3[] = [];
    const loop = closed ? [...points, points[0]] : points;
    for (let i = 0; i < loop.length - 1; i++) {
      const steps = Math.max(1, Math.round(n / (loop.length - 1)));
      for (let s = 0; s < steps; s++) out.push(loop[i].clone().lerp(loop[i + 1], s / steps));
    }
    if (!closed) out.push(loop[loop.length - 1].clone());
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  return curve.getSpacedPoints(closed ? n : n - 1).slice(0, closed ? n : n);
}

function lathe(p: GeometryOf<"lathe">["params"]) {
  const raw = p.points.map(([r, y]) => new THREE.Vector3(Math.max(0, r), y, 0));
  let pts: [number, number][];
  if (p.sharp) pts = raw.map((v) => [v.x, v.y]);
  else {
    const n = Math.min(160, Math.max(32, raw.length * 10));
    pts = resample(raw, n).map((v) => [Math.max(0, v.x), v.y]);
    // Pin the ends exactly where the genie put them (axis closures stay closed).
    pts[0] = [raw[0].x, raw[0].y];
    pts[pts.length - 1] = [raw[raw.length - 1].x, raw[raw.length - 1].y];
  }
  const flutes = p.flutes && p.fluteDepth ? { count: p.flutes, depth: p.fluteDepth, fade: p.fluteFade ?? "even" } : null;
  return revolve(pts, p.segments ?? (flutes ? Math.max(96, flutes.count * 8) : 96), rad(p.angle), p.sharp ? 35 : 75, flutes);
}

interface Flutes { count: number; depth: number; fade: "even" | "bottom" | "top" }

/**
 * Revolve an [r, y] profile around Y with analytic normals: smooth where the profile bends gently,
 * split (hard edge) where it turns more than `creaseDeg`. Fast (no vertex hashing) and UVs are
 * in meters (u around the widest circumference, v along the profile).
 */
function revolve(profile: [number, number][], segments: number, phi: number, creaseDeg: number, flutes: Flutes | null = null): THREE.BufferGeometry {
  const pts = profile.filter((q, i) => i === 0 || Math.hypot(q[0] - profile[i - 1][0], q[1] - profile[i - 1][1]) > 1e-7);
  const m = pts.length;
  if (m < 2) return new THREE.BufferGeometry();
  // Outward normal of each segment in the (r, y) plane.
  const segN: [number, number][] = [];
  for (let j = 0; j < m - 1; j++) {
    const dr = pts[j + 1][0] - pts[j][0], dy = pts[j + 1][1] - pts[j][1];
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const cosCrease = Math.cos(rad(creaseDeg));
  // Ring vertices: one per profile point, two at creases (one normal for each side).
  const ring: { r: number; y: number; nr: number; ny: number; v: number }[] = [];
  let arc = 0;
  for (let j = 0; j < m; j++) {
    if (j > 0) arc += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
    const a = j > 0 ? segN[j - 1] : null, b = j < m - 1 ? segN[j] : null;
    const [r, y] = pts[j];
    if (a && b && a[0] * b[0] + a[1] * b[1] < cosCrease) {
      ring.push({ r, y, nr: a[0], ny: a[1], v: arc });
      ring.push({ r, y, nr: b[0], ny: b[1], v: arc });
    } else {
      let nr = (a?.[0] ?? 0) + (b?.[0] ?? 0), ny = (a?.[1] ?? 0) + (b?.[1] ?? 0);
      const l = Math.hypot(nr, ny) || 1;
      nr /= l;
      ny /= l;
      ring.push({ r, y, nr, ny, v: arc });
    }
  }
  const R = ring.length;
  const rMax = Math.max(...pts.map((q) => q[0]), 1e-4);
  const pos = new Float32Array((segments + 1) * R * 3);
  const nor = new Float32Array((segments + 1) * R * 3);
  const uv = new Float32Array((segments + 1) * R * 2);
  const total = ring[R - 1].v || 1;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * phi;
    const s = Math.sin(t), c = Math.cos(t);
    for (let j = 0; j < R; j++) {
      const q = ring[j];
      const k = i * R + j;
      let r = q.r;
      if (flutes) {
        // Profile runs bottom to top: "bottom" folds are deepest at the start of the profile.
        const f = q.v / total;
        const w = flutes.fade === "bottom" ? (1 - f) ** 1.5 : flutes.fade === "top" ? f ** 1.5 : 1;
        r *= 1 + flutes.depth * w * Math.sin(t * flutes.count);
      }
      pos[k * 3] = r * s;
      pos[k * 3 + 1] = q.y;
      pos[k * 3 + 2] = r * c;
      nor[k * 3] = q.nr * s;
      nor[k * 3 + 1] = q.ny;
      nor[k * 3 + 2] = q.nr * c;
      uv[k * 2] = (i / segments) * phi * rMax;
      uv[k * 2 + 1] = q.v;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < R - 1; j++) {
      // Skip the zero-width quad between the two copies of a crease vertex.
      if (ring[j].r === ring[j + 1].r && ring[j].y === ring[j + 1].y) continue;
      const a = i * R + j, b = a + 1, c2 = a + R, d = c2 + 1;
      index.push(a, c2, b, b, c2, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  // Rippled surfaces need normals from the actual shape (the profile normals ignore the folds).
  if (flutes) g.computeVertexNormals();
  return g;
}

function sphere(p: GeometryOf<"sphere">["params"]) {
  const theta = rad(p.angle);
  const geo = new THREE.SphereGeometry(p.radius, 96, Math.max(8, Math.round(64 * (p.angle / 180))), 0, Math.PI * 2, 0, theta);
  return scaleUVs(geo, Math.PI * 2 * p.radius, theta * p.radius);
}

function capsule(p: GeometryOf<"capsule">["params"]) {
  const geo = new THREE.CapsuleGeometry(p.radius, p.length, 16, 64);
  return scaleUVs(geo, Math.PI * 2 * p.radius, p.length + Math.PI * p.radius);
}

function torus(p: GeometryOf<"torus">["params"]) {
  const arc = rad(p.arc);
  const geo = new THREE.TorusGeometry(p.radius, Math.min(p.tube, p.radius * 0.99), 32, Math.max(24, Math.round(128 * (p.arc / 360))), arc);
  return scaleUVs(geo, arc * p.radius, Math.PI * 2 * p.tube);
}

/** Cylinders are lathed so their rims can be rounded (nothing manufactured has razor edges). */
function cylinder(p: GeometryOf<"cylinder">["params"]) {
  const { radiusTop: rt, radiusBottom: rb, height: h } = p;
  const segments = p.segments ?? 96;
  if (p.open) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, segments, 1, true);
    return scaleUVs(geo, Math.PI * 2 * Math.max(rt, rb), h);
  }
  const b = Math.max(0, Math.min(p.bevel ?? Math.min(h * 0.12, Math.max(rt, rb) * 0.12, 0.006), h / 2 - 1e-5, Math.max(rt, rb) * 0.95));
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push([Math.max(0, cx + Math.cos(a) * b), cy + Math.sin(a) * b]);
    }
  };
  pts.push([0, -h / 2]);
  if (b > 1e-5 && rb > b) corner(rb - b, -h / 2 + b, -Math.PI / 2, 0);
  else pts.push([rb, -h / 2]);
  if (b > 1e-5 && rt > b) corner(rt - b, h / 2 - b, 0, Math.PI / 2);
  else pts.push([rt, h / 2]);
  pts.push([0, h / 2]);
  let geo = revolve(pts, segments, Math.PI * 2, 35);
  // Faceted cylinders (hex nuts, prisms) keep crisp edges between their flat faces.
  if (segments < 24) geo = toCreasedNormals(geo, rad(30));
  return geo;
}

function extrude(p: GeometryOf<"extrude">["params"]) {
  const toShapePts = (pts: [number, number][]) => {
    const v = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
    const out = p.smooth ? resample(v, Math.min(200, Math.max(48, pts.length * 12)), true) : v;
    return out.map((q) => new THREE.Vector2(q.x, q.y));
  };
  const build = (outer: THREE.Vector2[], holes: THREE.Vector2[][]) => {
    if (THREE.ShapeUtils.isClockWise(outer)) outer = outer.reverse();
    const shape = new THREE.Shape(outer);
    for (let hp of holes) {
      if (!THREE.ShapeUtils.isClockWise(hp)) hp = hp.reverse();
      shape.holes.push(new THREE.Path(hp));
    }
    return shape;
  };
  const v2 = (pts: [number, number][]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  // A drawn SVG path: every piece of the drawing, at full detail.
  const drawn = p.svg ? svgOutline(p.svg, p.width ?? 0.05) : null;
  const shapes = drawn?.shapes.length
    ? drawn.shapes.map((s) => build(v2(s.outer), s.holes.map(v2)))
    : [build(toShapePts(p.shape), (p.holes ?? []).map(toShapePts))];
  const box = new THREE.Box2().setFromPoints(shapes.flatMap((s) => s.getPoints()));
  const extent = Math.min(box.max.x - box.min.x, box.max.y - box.min.y);
  const bevel = Math.max(0, Math.min(p.bevel ?? Math.min(p.depth * 0.2, extent * 0.06, 0.012), p.depth / 2 - 1e-5, extent * 0.25));
  const core = Math.max(1e-5, p.depth - bevel * 2);
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: core,
    curveSegments: 24,
    bevelEnabled: bevel > 1e-5,
    bevelThickness: bevel,
    bevelSize: bevel,
    // Inset first so the bevel grows back out to exactly the outline the genie asked for.
    bevelOffset: -bevel,
    bevelSegments: 5,
  });
  geo.translate(0, 0, -core / 2);
  geo.deleteAttribute("normal");
  geo = mergeVertices(geo, 1e-6);
  geo = toCreasedNormals(geo, rad(40));
  return geo;
}

/**
 * Sweep a cross-section along a smooth path. Round tubes for cables and handles; flat straps
 * (width set) get a rounded-rectangle profile whose wide face looks along faceNormal.
 */
function tube(p: GeometryOf<"tube">["params"]) {
  const ctrl = p.points.map((q) => new THREE.Vector3(...q));
  const len = ctrl.reduce((s, v, i) => (i ? s + v.distanceTo(ctrl[i - 1]) : 0), 0);
  const n = Math.min(320, Math.max(48, Math.round(len / 0.004), ctrl.length * 16));
  const path = resample(ctrl, n, p.closed, p.sharp);
  const flat = p.width !== undefined && p.width > p.radius * 2;
  const halfT = p.radius;
  const halfW = flat ? p.width! / 2 : p.radius;

  // Cross-section, counter-clockwise in (w, t) space.
  const section: [number, number][] = [];
  if (flat) {
    const r = halfT * 0.95;
    const corners: [number, number, number][] = [[halfW - r, halfT - r, 0], [-(halfW - r), halfT - r, Math.PI / 2], [-(halfW - r), -(halfT - r), Math.PI], [halfW - r, -(halfT - r), (3 * Math.PI) / 2]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= 5; i++) {
      const a = a0 + (Math.PI / 2) * (i / 5);
      section.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  } else {
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      section.push([Math.cos(a) * halfW, Math.sin(a) * halfT]);
    }
  }
  const S = section.length;
  const perim: number[] = [0];
  for (let i = 1; i <= S; i++) {
    const a = section[i - 1], b = section[i % S];
    perim.push(perim[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  // Frames: flat straps keep their face toward faceNormal; round tubes use parallel transport.
  const N = path.length;
  const T: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(N - 1, i + 1)];
    const tan = p.closed ? path[(i + 1) % N].clone().sub(path[(i - 1 + N) % N]) : b.clone().sub(a);
    T.push(tan.lengthSq() > 0 ? tan.normalize() : new THREE.Vector3(0, 1, 0));
  }
  const W: THREE.Vector3[] = [];
  const face = new THREE.Vector3(...(p.faceNormal ?? [0, 0, 1])).normalize();
  let prev = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    let w: THREE.Vector3;
    if (flat) {
      w = new THREE.Vector3().crossVectors(face, T[i]);
      if (w.lengthSq() < 1e-6) w = prev.lengthSq() ? prev.clone() : new THREE.Vector3(1, 0, 0);
      w.normalize();
    } else if (i === 0) {
      const helper = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      w = new THREE.Vector3().crossVectors(helper, T[0]).normalize();
    } else {
      // Parallel transport: remove the tangent component from the previous frame.
      w = prev.clone().sub(T[i].clone().multiplyScalar(prev.dot(T[i]))).normalize();
    }
    // Keep flat straps from flipping between neighbors.
    if (flat && prev.lengthSq() && w.dot(prev) < 0) w.negate();
    W.push(w);
    prev = w;
  }

  const ringCount = p.closed ? N + 1 : N;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let along = 0;
  for (let r = 0; r < ringCount; r++) {
    const i = r % N;
    if (r > 0) along += path[i].distanceTo(path[(r - 1) % N]);
    const t = T[i], w = W[i];
    const nrm = new THREE.Vector3().crossVectors(t, w).normalize();
    for (let s = 0; s <= S; s++) {
      const [cw, ct] = section[s % S];
      const v = path[i].clone().addScaledVector(w, cw).addScaledVector(nrm, ct);
      positions.push(v.x, v.y, v.z);
      uvs.push(along, perim[s]);
    }
  }
  for (let r = 0; r < ringCount - 1; r++)
    for (let s = 0; s < S; s++) {
      const a = r * (S + 1) + s, b = a + 1, c = a + S + 1, d = c + 1;
      // (w, n, t) is right-handed and the section runs counter-clockwise: this winding faces out.
      index.push(a, b, c, b, d, c);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  body.setIndex(index);
  body.computeVertexNormals();
  fixSeamNormals(body, ringCount, S);
  if (p.closed) return body;

  // Caps: flat for straps, domed for round tubes.
  const caps: THREE.BufferGeometry[] = [body];
  for (const end of [0, N - 1]) {
    const dir = end === 0 ? T[0].clone().negate() : T[N - 1].clone();
    const w = W[end], nrm = new THREE.Vector3().crossVectors(T[end], w).normalize();
    const capPos: number[] = [];
    const capUv: number[] = [];
    const capIdx: number[] = [];
    const rings = flat ? 1 : 5;
    for (let k = 0; k <= rings; k++) {
      const phi = (k / rings) * (Math.PI / 2);
      const shrink = flat ? 1 - k : Math.cos(phi);
      const push = flat ? 0 : Math.sin(phi) * Math.min(halfW, halfT);
      for (let s = 0; s <= S; s++) {
        const [cw, ct] = section[s % S];
        const v = path[end].clone().addScaledVector(w, cw * shrink).addScaledVector(nrm, ct * shrink).addScaledVector(dir, push);
        capPos.push(v.x, v.y, v.z);
        capUv.push(cw, ct);
      }
    }
    for (let k = 0; k < rings; k++)
      for (let s = 0; s < S; s++) {
        const a = k * (S + 1) + s, b = a + 1, c = a + S + 1, d = c + 1;
        if (end === 0) capIdx.push(a, c, b, b, c, d);
        else capIdx.push(a, b, c, b, d, c);
      }
    const cap = new THREE.BufferGeometry();
    cap.setAttribute("position", new THREE.Float32BufferAttribute(capPos, 3));
    cap.setAttribute("uv", new THREE.Float32BufferAttribute(capUv, 2));
    cap.setIndex(capIdx);
    cap.computeVertexNormals();
    caps.push(cap);
  }
  return mergeIndexed(caps);
}

/** The first and last vertex of each ring share a position; give them the same normal. */
function fixSeamNormals(g: THREE.BufferGeometry, rings: number, S: number) {
  const nrm = g.attributes.normal;
  for (let r = 0; r < rings; r++) {
    const a = r * (S + 1), b = a + S;
    const x = (nrm.getX(a) + nrm.getX(b)) / 2, y = (nrm.getY(a) + nrm.getY(b)) / 2, z = (nrm.getZ(a) + nrm.getZ(b)) / 2;
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
}

function mergeIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let offset = 0;
  for (const g of parts) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + offset);
    offset += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** A stable cache key for a geometry spec. */
export const geometryKey = (g: Geometry | undefined) => (g ? JSON.stringify(g) : "");
