import { CLOTHING, type Addon, type Placement, type ProductSpec } from "@wishit/shared";
import { skirtRadius, targetsFor } from "./garmentShape.ts";
import { bodiceR, HEM_Y, HIP_Y, smooth, TORSO_ZS, torsoR, torsoXS, WAIST_Y } from "./shapes.ts";

/**
 * Where decals and add-ons go on each model. Pure math (no React), so the render-coverage test
 * can check that every placement resolves for every category.
 */

export type V3 = [number, number, number];

/** How a decal hugs the surface: a cylinder/cone patch, an ellipsoid patch, or a flat card. */
export type Surface =
  | { kind: "wrap"; y: number; rTop: number; rBot: number; xs: number; zs: number; theta: number }
  | { kind: "sphere"; center: V3; r: number; scale: V3; phi: number; theta: number }
  | { kind: "flat" };

export interface Anchor {
  pos: V3;
  /** Outward unit normal. */
  normal: V3;
  /** Unit vector along the surface to the viewer's right; copies spread along it. */
  tangent: V3;
  /** Decal width at size 1, and the add-on unit length. */
  base: number;
  surface: Surface;
  /** Things that wrap around the body here (belts, ruffles, collars). */
  ring?: { y: number; r: number; xs: number; zs: number };
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Point on an elliptic cylinder (radius r, x/z scales) at angle theta (0 = front, +x at +pi/2). */
function wrapAnchor(y: number, r: number, xs: number, zs: number, theta: number, base: number, rTop = r, rBot = r): Anchor {
  const pos: V3 = [Math.sin(theta) * r * xs, y, Math.cos(theta) * r * zs];
  const normal = norm([Math.sin(theta) / xs, (rBot - rTop) / (base * 1.2 || 1), Math.cos(theta) / zs]);
  const tangent = norm([Math.cos(theta) * xs, 0, -Math.sin(theta) * zs]);
  return { pos, normal, tangent, base, surface: { kind: "wrap", y, rTop, rBot, xs, zs, theta } };
}

/** Point on an ellipsoid using three.js sphere angles: theta from the top, phi = pi/2 at the front. */
function sphereAnchor(center: V3, r: number, scale: V3, phi: number, theta: number, base: number): Anchor {
  const u: V3 = [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
  const pos: V3 = [center[0] + u[0] * r * scale[0], center[1] + u[1] * r * scale[1], center[2] + u[2] * r * scale[2]];
  const normal = norm([u[0] / scale[0], u[1] / scale[1], u[2] / scale[2]]);
  const tangent = norm(cross([0, 1, 0], normal)[0] === 0 && cross([0, 1, 0], normal)[2] === 0 ? [1, 0, 0] : cross([0, 1, 0], normal));
  return { pos, normal, tangent, base, surface: { kind: "sphere", center, r, scale, phi, theta } };
}

function flatAnchor(pos: V3, normal: V3, base: number): Anchor {
  const n = norm(normal);
  const up: V3 = Math.abs(n[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
  return { pos, normal: n, tangent: norm(cross(up, n)), base, surface: { kind: "flat" } };
}

const SIDE_THETA: Record<string, number> = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };

// ---------- Garments ----------

function garmentAnchor(spec: ProductSpec, p: Placement): Anchor {
  const a = targetsFor(spec);
  const cat = spec.category;
  const hem = HEM_Y[spec.length ?? "midi"];
  // Same factor as Garment.tsx, so decals stay on a bigger or smaller bodice.
  const bs = spec.parts?.bodice?.hidden ? 1 : spec.parts?.bodice?.scale ?? 1;
  const bodR = (y: number) => bodiceR(y, torsoR(y) + 0.011, bs) + 0.009;
  const bodice = (y: number, theta: number, base: number) => {
    const h = base * 0.6;
    return wrapAnchor(y, bodR(y), torsoXS(y), TORSO_ZS + 0.02, theta, base, bodR(y + h), bodR(y - h));
  };
  // Same fullness as Garment.tsx: a bigger skirt flares more below the hips.
  const full = spec.parts?.skirt?.hidden ? 1 : spec.parts?.skirt?.scale ?? 1;
  const skirtR = (y: number) => {
    const s = skirtRadius(y, a);
    return { r: s.r * (1 + (full - 1) * smooth(WAIST_Y, HIP_Y - 0.2, y)), zs: s.zs };
  };
  const skirt = (y: number, theta: number, base: number) => {
    const h = base * 0.6;
    const s = skirtR(y), sTop = skirtR(y + h), sBot = skirtR(y - h);
    return wrapAnchor(y, s.r + 0.012, 1, s.zs, theta, base, sTop.r + 0.012, sBot.r + 0.012);
  };
  const midSkirt = Math.min(0.98, (WAIST_Y + hem) / 2 + 0.05);
  const hasBodice = cat !== "skirt";
  const hasSkirt = cat !== "top";

  let anchor: Anchor;
  if (p === "front" || p === "back" || p === "left" || p === "right") {
    const th = SIDE_THETA[p];
    const side = p === "left" || p === "right";
    anchor = hasBodice ? bodice(side ? 1.24 : 1.31, th, side ? 0.1 : 0.13) : skirt(midSkirt, th, 0.16);
  } else if (p === "top") {
    anchor = hasBodice ? bodice(1.43, 0, 0.09) : skirt(WAIST_Y - 0.06, 0, 0.09);
  } else if (p === "bottom") {
    anchor = hasSkirt ? skirt(Math.max(hem + 0.1, 0.5), 0, 0.17) : bodice(0.93, 0, 0.1);
  } else {
    const y = cat === "top" ? 1.0 : WAIST_Y;
    anchor = hasBodice && cat === "top" ? bodice(y, 0, 0.1) : skirt(y - 0.02, 0, 0.1);
  }
  // Rings for belts, ruffles and collars.
  if (p === "waist") {
    const y = cat === "top" ? 0.95 : WAIST_Y - 0.01;
    const r = cat === "top" ? torsoR(y) + 0.03 : skirtR(y).r + 0.012;
    anchor.ring = { y, r, xs: cat === "top" ? torsoXS(y) : 1, zs: cat === "top" ? TORSO_ZS + 0.02 : skirtR(y).zs };
  } else if (p === "bottom") {
    const y = hasSkirt ? hem + 0.01 : a.bodiceBottom + 0.01;
    const s = hasSkirt ? skirtR(y) : { r: torsoR(y) + 0.02, zs: TORSO_ZS + 0.02 };
    anchor.ring = { y, r: s.r + 0.01, xs: 1, zs: s.zs };
  } else if (p === "top" && hasBodice) {
    anchor.ring = { y: 1.56, r: torsoR(1.56) + 0.03, xs: 1, zs: 1 };
  }
  return anchor;
}

// ---------- Backpack: a rounded box 0.62 x 0.78 x 0.3 centered at y 1.0 ----------

function backpackAnchor(p: Placement): Anchor {
  switch (p) {
    case "front": return flatAnchor([0, 1.17, 0.152], [0, 0, 1], 0.2);
    case "back": return flatAnchor([0, 1.05, -0.152], [0, 0, -1], 0.2);
    case "left": return flatAnchor([-0.312, 1.08, 0], [-1, 0, 0], 0.16);
    case "right": return flatAnchor([0.312, 1.12, 0], [1, 0, 0], 0.16);
    case "top": return flatAnchor([0, 1.392, 0.02], [0, 1, 0], 0.16);
    case "bottom": return flatAnchor([0, 0.82, 0.212], [0, 0, 1], 0.18);
    case "waist": return flatAnchor([0, 0.94, 0.212], [0, 0, 1], 0.14);
  }
}

// ---------- Helmet: ellipsoid shell r 0.32, scale (1, 0.82, 1.2), centered at y 1.08 ----------

const HELMET_C: V3 = [0, 1.08, 0];
const HELMET_S: V3 = [1, 0.82, 1.2];
function helmetAnchor(p: Placement): Anchor {
  const r = 0.322;
  const at = (phi: number, theta: number, base: number) => sphereAnchor(HELMET_C, r, HELMET_S, phi, theta, base);
  switch (p) {
    case "front": return at(Math.PI / 2, 0.3 * Math.PI, 0.13);
    case "back": return at(-Math.PI / 2, 0.3 * Math.PI, 0.15);
    case "left": return at(0, 0.3 * Math.PI, 0.13);
    case "right": return at(Math.PI, 0.3 * Math.PI, 0.13);
    case "top": return at(Math.PI / 2, 0.08 * Math.PI, 0.12);
    case "bottom": {
      const a = at(Math.PI / 2, 0.47 * Math.PI, 0.1);
      a.ring = { y: 1.03, r: 0.33, xs: 1, zs: 1.2 };
      return a;
    }
    case "waist": {
      const a = at(Math.PI / 2, 0.42 * Math.PI, 0.1);
      a.ring = { y: 1.05, r: 0.33, xs: 1, zs: 1.2 };
      return a;
    }
  }
}

// ---------- Generic body (or the wish orb) ----------

export interface BodyLayout { shape: NonNullable<ProductSpec["body"]>["shape"]; w: number; h: number; d: number; y0: number; lift: number }

const COLUMN = /\b(leg|legs|pole|stand|base|stem|post|column)\b/;
const isColumn = (a: Addon) => a.placement === "bottom" && (a.shape === "cylinder" || a.shape === "box") && COLUMN.test(a.name.toLowerCase());
const isWheel = (a: Addon) => a.placement === "bottom" && /\bwheels?\b/.test(a.name.toLowerCase());

/** Body size and height off the pedestal; legs and stands lift it. */
export function bodyLayout(spec: ProductSpec): BodyLayout | null {
  const b = spec.body;
  if (!b) return null;
  const addons = spec.addons ?? [];
  const lift = addons.some(isColumn) ? 0.32 : addons.some(isWheel) ? 0.07 : 0;
  return { shape: b.shape, w: b.width ?? 0.5, h: b.height ?? 0.6, d: b.depth ?? b.width ?? 0.5, y0: 0.1 + lift, lift };
}
export { isColumn, isWheel };

// Matches ORB_Y / ORB_R in Orb.tsx (kept here so this file stays free of React).
export const ORB_CENTER: V3 = [0, 1.12, 0];
export const ORB_RADIUS = 0.43;

function genericAnchor(spec: ProductSpec, p: Placement): Anchor {
  const L = bodyLayout(spec);
  if (!L || L.shape === "sphere") {
    const c: V3 = L ? [0, L.y0 + L.h / 2, 0] : ORB_CENTER;
    const r = L ? L.w / 2 + 0.004 : ORB_RADIUS;
    const s: V3 = L ? [1, L.h / L.w, L.d / L.w] : [1, 1, 1];
    const base = (L ? Math.min(L.w, L.h) : 0.6) * 0.42;
    const a = (phi: number, theta: number) => sphereAnchor(c, r, s, phi, theta, base);
    const res =
      p === "front" ? a(Math.PI / 2, Math.PI / 2) : p === "back" ? a(-Math.PI / 2, Math.PI / 2) : p === "left" ? a(0, Math.PI / 2)
        : p === "right" ? a(Math.PI, Math.PI / 2) : p === "top" ? a(Math.PI / 2, 0.1 * Math.PI) : p === "bottom" ? a(Math.PI / 2, 0.85 * Math.PI) : a(Math.PI / 2, Math.PI / 2);
    if (p === "waist") res.ring = { y: c[1], r: r + 0.01, xs: 1, zs: s[2] };
    return res;
  }
  const cy = L.y0 + L.h / 2;
  const base = Math.max(0.08, Math.min(L.w, L.h) * 0.45);
  if (L.shape === "cylinder" || L.shape === "cone") {
    const rBot = L.w / 2 + 0.006;
    const rTop = L.shape === "cone" ? L.w * 0.1 + 0.006 : rBot;
    const zs = L.d / L.w;
    const rAt = (y: number) => rBot + (rTop - rBot) * Math.min(1, Math.max(0, (y - L.y0) / L.h));
    const side = (th: number, y = cy) => wrapAnchor(y, rAt(y), 1, zs, th, Math.min(base, rAt(y) * 1.2), rAt(y + base * 0.6), rAt(y - base * 0.6));
    let res: Anchor;
    if (p in SIDE_THETA) res = side(SIDE_THETA[p]);
    else if (p === "top") res = flatAnchor([0, L.y0 + L.h + 0.002, 0], [0, 1, 0], Math.min(base, rTop * 1.4));
    else if (p === "bottom") res = side(0, L.y0 + Math.min(0.1, L.h * 0.25));
    else res = side(0);
    if (p === "waist") res.ring = { y: cy, r: rAt(cy) + 0.01, xs: 1, zs };
    if (p === "bottom") res.ring = { y: L.y0 + 0.01, r: rBot + 0.01, xs: 1, zs };
    if (p === "top") res.ring = { y: L.y0 + L.h - 0.01, r: rTop + 0.01, xs: 1, zs };
    return res;
  }
  // Box, capsule and torus: flat faces of the bounding box.
  const hx = L.w / 2 + 0.003, hz = (L.shape === "torus" ? L.w * 0.12 : L.d / 2) + 0.003;
  switch (p) {
    case "front": return flatAnchor([0, cy, hz], [0, 0, 1], base);
    case "back": return flatAnchor([0, cy, -hz], [0, 0, -1], base);
    case "left": return flatAnchor([-hx, cy, 0], [-1, 0, 0], Math.min(base, L.d * 0.8));
    case "right": return flatAnchor([hx, cy, 0], [1, 0, 0], Math.min(base, L.d * 0.8));
    case "top": return flatAnchor([0, L.y0 + L.h + 0.003, 0], [0, 1, 0], Math.min(base, L.d * 0.8));
    case "bottom": return flatAnchor([0, L.y0 + Math.min(0.08, L.h * 0.3), hz], [0, 0, 1], Math.min(base, L.h * 0.5));
    case "waist": return flatAnchor([0, cy, hz], [0, 0, 1], base);
  }
}

/** The anchor for a placement on whatever the spec renders. */
export function anchorFor(spec: ProductSpec, p: Placement): Anchor {
  if (CLOTHING.includes(spec.category)) return garmentAnchor(spec, p);
  if (spec.category === "backpack") return backpackAnchor(p);
  if (spec.category === "helmet") return helmetAnchor(p);
  return genericAnchor(spec, p);
}

/** The same anchor moved s world units along the surface (for the n-th of several copies). */
export function slide(a: Anchor, s: number): Anchor {
  if (s === 0) return a;
  const sf = a.surface;
  if (sf.kind === "wrap") {
    const r = (sf.rTop + sf.rBot) / 2;
    const out = wrapAnchor(sf.y, r, sf.xs, sf.zs, sf.theta + s / (r * Math.max(sf.xs, sf.zs)), a.base, sf.rTop, sf.rBot);
    return { ...out, ring: a.ring };
  }
  if (sf.kind === "sphere") {
    const ring = Math.max(0.05, Math.sin(sf.theta)) * sf.r;
    // Near the pole, sliding sideways means moving in phi around a small circle; widen theta a little.
    const theta = sf.theta < 0.3 ? sf.theta + Math.abs(s) * 0.8 / sf.r : sf.theta;
    const phi = sf.phi - s / Math.max(ring, sf.r * Math.sin(theta));
    return { ...sphereAnchor(sf.center, sf.r, sf.scale, phi, theta, a.base), ring: a.ring };
  }
  return { ...a, pos: [a.pos[0] + a.tangent[0] * s, a.pos[1] + a.tangent[1] * s, a.pos[2] + a.tangent[2] * s] };
}
