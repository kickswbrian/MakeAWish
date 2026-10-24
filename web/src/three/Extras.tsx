import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Addon, Decal, ProductSpec } from "@wishit/shared";
import { anchorFor, bodyLayout, isColumn, isWheel, slide, type Anchor, type V3 } from "./anchors.ts";
import { morphK } from "./shapes.ts";
import { usePartTransform, useProductMaterial } from "./materials.ts";

// ---------- Decal textures ----------

const ICONS: Record<string, (g: CanvasRenderingContext2D) => void> = {
  star: (g) => poly(g, Array.from({ length: 10 }, (_, i) => polar(i % 2 ? 42 : 104, -Math.PI / 2 + (i * Math.PI) / 5)), true),
  heart: (g) => {
    g.beginPath();
    g.moveTo(128, 214);
    g.bezierCurveTo(30, 150, 18, 80, 72, 56);
    g.bezierCurveTo(104, 42, 124, 64, 128, 84);
    g.bezierCurveTo(132, 64, 152, 42, 184, 56);
    g.bezierCurveTo(238, 80, 226, 150, 128, 214);
    g.fill();
  },
  circle: (g) => { g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.fill(); },
  square: (g) => { g.beginPath(); g.roundRect(36, 36, 184, 184, 18); g.fill(); },
  triangle: (g) => poly(g, [[128, 26], [228, 214], [28, 214]], true),
  diamond: (g) => poly(g, [[128, 18], [214, 128], [128, 238], [42, 128]], true),
  lightning: (g) => poly(g, [[150, 14], [58, 140], [118, 140], [92, 242], [196, 104], [134, 104], [168, 14]], true),
  moon: (g) => {
    g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(170, 100, 88, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  },
  sun: (g) => {
    g.beginPath(); g.arc(128, 128, 56, 0, Math.PI * 2); g.fill();
    g.lineWidth = 16; g.lineCap = "round";
    for (let i = 0; i < 8; i++) {
      const [x0, y0] = polar(76, (i * Math.PI) / 4), [x1, y1] = polar(112, (i * Math.PI) / 4);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  },
  x: (g) => { g.lineWidth = 40; g.lineCap = "round"; line(g, 50, 50, 206, 206); line(g, 206, 50, 50, 206); },
  check: (g) => { g.lineWidth = 38; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(40, 136); g.lineTo(104, 196); g.lineTo(218, 62); g.stroke(); },
  arrow: (g) => poly(g, [[24, 100], [140, 100], [140, 48], [234, 128], [140, 208], [140, 156], [24, 156]], true),
  flower: (g) => {
    for (let i = 0; i < 5; i++) {
      g.save(); g.translate(128, 128); g.rotate((i * Math.PI * 2) / 5);
      g.beginPath(); g.ellipse(0, -58, 34, 54, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(128, 128, 26, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    g.beginPath(); g.arc(128, 128, 18, 0, Math.PI * 2); g.fill();
  },
  smiley: (g) => {
    g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(92, 100, 15, 0, Math.PI * 2); g.arc(164, 100, 15, 0, Math.PI * 2); g.fill();
    g.lineWidth = 16; g.lineCap = "round"; g.beginPath(); g.arc(128, 128, 60, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    g.globalCompositeOperation = "source-over";
  },
  peace: (g) => {
    g.lineWidth = 22;
    g.beginPath(); g.arc(128, 128, 94, 0, Math.PI * 2); g.stroke();
    line(g, 128, 34, 128, 222); line(g, 128, 128, 62, 194); line(g, 128, 128, 194, 194);
  },
  paw: (g) => {
    g.beginPath(); g.ellipse(128, 166, 58, 48, 0, 0, Math.PI * 2); g.fill();
    for (const [x, y] of [[62, 104], [104, 66], [152, 66], [194, 104]]) { g.beginPath(); g.ellipse(x, y, 24, 30, 0, 0, Math.PI * 2); g.fill(); }
  },
  music_note: (g) => {
    g.beginPath(); g.ellipse(92, 192, 44, 32, -0.4, 0, Math.PI * 2); g.fill();
    g.fillRect(122, 40, 18, 152);
    poly(g, [[122, 40], [206, 70], [206, 112], [140, 88]], true);
  },
  cloud: (g) => {
    for (const [x, y, r] of [[84, 146, 52], [134, 110, 66], [184, 146, 48]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillRect(84, 146, 100, 52);
  },
  crown: (g) => poly(g, [[30, 200], [30, 70], [84, 126], [128, 50], [172, 126], [226, 70], [226, 200]], true),
  spiral: (g) => {
    g.lineWidth = 16; g.lineCap = "round"; g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.1) { const r = 8 + a * 5.2; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
    g.stroke();
  },
};
function polar(r: number, a: number): [number, number] { return [128 + Math.cos(a) * r, 128 + Math.sin(a) * r]; }
function poly(g: CanvasRenderingContext2D, pts: number[][], fill: boolean) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  if (fill) g.fill(); else g.stroke();
}
function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

const luminance = (hex: string) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
/** Ink that reads on the product: dark on light colors, light on dark. */
const contrastInk = (productColor: string) => (luminance(productColor) > 0.45 ? "#1A1A1D" : "#F7F3EA");

interface DecalTex { tex: THREE.CanvasTexture; aspect: number }
const decalCache = new Map<string, DecalTex>();

export function decalTexture(d: Decal, ink: string): DecalTex {
  const key = `${d.kind}|${d.content}|${ink}`;
  const hit = decalCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  let aspect = 1;
  const g = c.getContext("2d")!;
  if (d.kind === "text") {
    const text = d.content;
    const lines = text.length > 12 && text.includes(" ") ? splitTwo(text) : [text];
    const longest = Math.max(...lines.map((l) => l.length));
    aspect = Math.min(3.2, Math.max(1, longest * 0.62 / lines.length));
    c.width = Math.round(256 * aspect);
    c.height = 256;
    const font = (px: number) => `800 ${px}px "Baloo 2", "Fredoka", "Arial Rounded MT Bold", system-ui, sans-serif`;
    let px = 220 / lines.length;
    g.font = font(px);
    while (px > 20 && Math.max(...lines.map((l) => g.measureText(l).width)) > c.width * 0.92) g.font = font((px -= 6));
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = px * 0.12;
    g.strokeStyle = luminance(ink) > 0.45 ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.35)";
    g.fillStyle = ink;
    lines.forEach((l, i) => {
      const y = 128 + (i - (lines.length - 1) / 2) * px * 0.95;
      g.strokeText(l, c.width / 2, y);
      g.fillText(l, c.width / 2, y);
    });
  } else if (d.kind === "emoji") {
    c.width = c.height = 256;
    g.font = `200px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(d.content, 128, 140);
  } else {
    c.width = c.height = 256;
    g.fillStyle = g.strokeStyle = ink;
    (ICONS[d.content] ?? ICONS.star)(g);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const out = { tex, aspect };
  decalCache.set(key, out);
  return out;
}
function splitTwo(s: string): string[] {
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

/** Geometry that hugs the anchor's surface: a cylinder/cone patch, ellipsoid patch, or flat card. */
function decalGeometry(a: Anchor, w: number, h: number): { geo: THREE.BufferGeometry; pos: V3; scale: V3; flat: boolean } {
  const s = a.surface;
  if (s.kind === "wrap") {
    const r = (s.rTop + s.rBot) / 2;
    const dth = w / (r * (Math.abs(Math.sin(s.theta)) * s.xs + Math.abs(Math.cos(s.theta)) * s.zs));
    const geo = new THREE.CylinderGeometry(s.rTop + 0.003, s.rBot + 0.003, h, 24, 1, true, s.theta - dth / 2, dth);
    return { geo, pos: [0, s.y, 0], scale: [s.xs, 1, s.zs], flat: false };
  }
  if (s.kind === "sphere") {
    const rr = s.r + 0.004;
    const dth = h / (rr * s.scale[1]);
    const ring = Math.max(0.08, Math.sin(s.theta)) * rr * Math.max(s.scale[0], s.scale[2]);
    const dph = Math.min(Math.PI * 1.2, w / ring);
    const geo = new THREE.SphereGeometry(rr, 24, 12, s.phi - dph / 2, dph, Math.max(0.001, s.theta - dth / 2), dth);
    return { geo, pos: s.center, scale: s.scale, flat: false };
  }
  const geo = new THREE.PlaneGeometry(w, h);
  return { geo, pos: [a.pos[0] + a.normal[0] * 0.003, a.pos[1] + a.normal[1] * 0.003, a.pos[2] + a.normal[2] * 0.003], scale: [1, 1, 1], flat: true };
}

function DecalMesh({ spec, d, ink }: { spec: ProductSpec; d: Decal; ink: string }) {
  const a = anchorFor(spec, d.placement);
  const { tex, aspect } = decalTexture(d, d.color ?? ink);
  const w = a.base * (d.size ?? 1) * (d.kind === "text" ? Math.min(2.4, Math.max(1, aspect * 0.8)) : 1);
  const h = (a.base * (d.size ?? 1) * (d.kind === "text" ? Math.min(2.4, Math.max(1, aspect * 0.8)) : 1)) / aspect;
  const geoKey = JSON.stringify([a.surface, a.pos, w, h]);
  const built = useMemo(() => decalGeometry(a, w, h), [geoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => built.geo.dispose(), [built]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.6, alphaTest: 0.02 }),
    [tex],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const ref = useRef<THREE.Mesh>(null);
  // Flat cards face their normal in the parent's own frame. (lookAt would aim at a world point,
  // which is wrong once the model has turned.)
  const nKey = a.normal.join(",");
  const rotation = useMemo<[number, number, number]>(() => {
    const [nx, ny, nz] = a.normal;
    return Math.abs(ny) > 0.9 ? [(-Math.PI / 2) * Math.sign(ny), 0, 0] : [0, Math.atan2(nx, nz), 0];
  }, [nKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pop in: grow from nothing when first drawn.
  const grow = useRef(0);
  useFrame((_s, dt) => {
    grow.current += (1 - grow.current) * morphK(dt);
    if (ref.current && built.flat) ref.current.scale.setScalar(Math.max(0.001, grow.current));
    mat.opacity = grow.current;
  });
  return <mesh ref={ref} geometry={built.geo} material={mat} position={built.pos} rotation={built.flat ? rotation : undefined} scale={built.flat ? undefined : built.scale} renderOrder={2} />;
}

export function Decals({ spec }: { spec: ProductSpec }) {
  const ink = contrastInk(spec.color ?? "#C5D8CF");
  return (
    <group>
      {(spec.decals ?? []).map((d, i) => <DecalMesh key={`${i}:${d.kind}:${d.content}:${d.placement}`} spec={spec} d={d} ink={ink} />)}
    </group>
  );
}

// ---------- Add-ons ----------

const UNIT = { dress: 0.075, top: 0.075, skirt: 0.075, backpack: 0.1, helmet: 0.08, generic: 0.09 } as const;
const VERTICAL = /\b(holder|bottle|straw|antenna|antennas|leg|legs|pole|stand|pen|umbrella|can|cap|lid|flask|candle|stem|post|tissue)\b/;
const FLATISH = /\b(panel|panels|screen|display|strip|stripe|reflector|reflectors|patch|plate|pad|sleeve|lock|port|charger|switch|clip|mount)\b/;

/** Wing/fin outline, cached per size so re-renders don't rebuild the extrusion. */
const fins = new Map<number, THREE.ExtrudeGeometry>();
function finGeometry(u: number): THREE.ExtrudeGeometry {
  const key = Math.round(u * 1e4);
  let g = fins.get(key);
  if (!g) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(u * 0.9, u * 0.6, u * 2.2, u * 1.6);
    shape.quadraticCurveTo(u * 1.2, u * 0.3, u * 0.9, -u * 0.5);
    shape.lineTo(0, -u * 0.3);
    g = new THREE.ExtrudeGeometry(shape, { depth: u * 0.08, bevelEnabled: true, bevelSize: u * 0.03, bevelThickness: u * 0.03, bevelSegments: 2 });
    fins.set(key, g);
  }
  return g;
}

/** One add-on primitive, built in a local frame where +y is the outward normal and +x the tangent. */
function AddonShape({ a, u, mat, name, spread }: { a: Addon; u: number; mat: THREE.Material; name: string; spread: number }) {
  const vertical = VERTICAL.test(name);
  switch (a.shape) {
    case "sphere": return <mesh material={mat} position={[0, u * 0.45, 0]}><sphereGeometry args={[u * 0.55, 24, 16]} /></mesh>;
    case "cone": return <mesh material={mat} position={[0, u * 0.9, 0]} rotation={[0, 0, -spread * 0.35]}><coneGeometry args={[u * 0.42, u * 1.8, 20]} /></mesh>;
    case "spike": return <mesh material={mat} position={[0, u * 0.5, 0]}><coneGeometry args={[u * 0.22, u * 1.0, 12]} /></mesh>;
    case "capsule": return <mesh material={mat} position={[0, u * 0.8, 0]} rotation={[0, 0, -spread * 0.2]}><capsuleGeometry args={[u * 0.26, u * 1.1, 6, 14]} /></mesh>;
    case "dome": return <mesh material={mat} position={[0, -u * 0.2, 0]} scale={[1, 0.8, 1]}><sphereGeometry args={[u * 1.6, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>;
    case "box": {
      const flat = FLATISH.test(name);
      return <mesh material={mat} position={[0, u * (flat ? 0.06 : 0.4), 0]}><boxGeometry args={flat ? [u * 2.0, u * 0.12, u * 1.3] : [u * 0.9, u * 0.8, u * 0.9]} /></mesh>;
    }
    case "torus": return <mesh material={mat} position={[0, u * 0.55, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[u * 0.55, u * 0.14, 12, 32]} /></mesh>;
    case "fin":
      // A single fin stands out along the normal (a mohawk); a pair tilts out to either side (wings).
      return (
        <group rotation={[0, 0, -spread * 0.9]}>
          <mesh material={mat} rotation={[0, Math.PI / 2, Math.PI / 2]} geometry={finGeometry(u)} />
        </group>
      );
    case "bow":
      return (
        <group scale={[1, 0.5, 1]}>
          {[-1, 1].map((s) => (
            <mesh key={s} material={mat} position={[s * u * 0.5, u * 0.3, 0]} rotation={[0, 0, (s * Math.PI) / 2]}>
              <coneGeometry args={[u * 0.45, u * 1.0, 16]} />
            </mesh>
          ))}
          <mesh material={mat} position={[0, u * 0.3, 0]}><sphereGeometry args={[u * 0.22, 16, 12]} /></mesh>
        </group>
      );
    case "cylinder":
    default: {
      if (isWheel(a)) return <mesh material={mat} position={[0, -u * 0.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[u * 0.6, u * 0.6, u * 0.3, 24]} /></mesh>;
      const thin = /\b(straw|antenna|antennas|pen|pole|stem)\b/.test(name);
      const r = thin ? u * 0.1 : u * 0.45;
      const len = thin ? u * 2.4 : u * 1.5;
      // Holders and bottles stand upright beside the product; speakers and lights face outward.
      return vertical
        ? <group><mesh material={mat} position={[0, r, 0]}><cylinderGeometry args={[r, r * 0.92, len, 24]} /></mesh></group>
        : <mesh material={mat} position={[0, u * 0.25, 0]}><cylinderGeometry args={[u * 0.5, u * 0.5, u * 0.5, 24]} /></mesh>;
    }
  }
}

function AddonMesh({ spec, a, trim, accent }: { spec: ProductSpec; a: Addon; trim: THREE.Material; accent: string }) {
  const name = a.name.toLowerCase();
  const L = bodyLayout(spec);
  // On a generic body, loops (mug handles) are sized to the body; everything else to its smaller side.
  const genericU = L ? (a.shape === "torus" ? Math.max(0.08, L.h * 0.42) : Math.max(0.06, Math.min(L.w, L.h) * 0.22)) : 0.09;
  const u = (spec.category === "generic" ? genericU : UNIT[spec.category]) * (a.size ?? 1);
  const mat = useMemo(() => {
    if (a.glow) return new THREE.MeshStandardMaterial({ color: new THREE.Color(a.color ?? "#fff3c4").multiplyScalar(2.2), emissive: a.color ?? "#fff3c4", emissiveIntensity: 2, toneMapped: false });
    if (a.color) return new THREE.MeshPhysicalMaterial({ color: a.color, roughness: 0.45, clearcoat: 0.3 });
    return a.shape === "bow" || a.shape === "spike" ? new THREE.MeshStandardMaterial({ color: accent, metalness: 0.8, roughness: 0.3 }) : trim;
  }, [a.glow, a.color, a.shape, trim, accent]);
  useEffect(() => () => {
    if (mat !== trim) mat.dispose();
  }, [mat, trim]);
  const base = anchorFor(spec, a.placement);
  const grow = useRef<THREE.Group>(null);
  const g = useRef(0);
  useFrame((_s, dt) => {
    g.current += (1 - g.current) * morphK(dt);
    grow.current?.scale.setScalar(Math.max(0.001, g.current));
  });

  // Belts, ruffles and collars wrap all the way around.
  if (a.shape === "torus" && base.ring) {
    const R = base.ring;
    return (
      <group ref={grow} position={[0, R.y, 0]} scale={[R.xs, 1, R.zs]}>
        <mesh material={mat} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[R.r + u * 0.1, u * (/\b(ruffle|ruffles|frill)\b/.test(name) ? 0.35 : 0.2), 12, 96]} />
        </mesh>
      </group>
    );
  }
  // Legs, stands and poles hold a generic body up off the pedestal.
  if (spec.category === "generic" && L && isColumn(a)) {
    const n = a.count ?? 1;
    const spots: [number, number][] = n === 1 ? [[0, 0]] : Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2 + Math.PI / 4) * L.w * 0.38, Math.sin((i / n) * Math.PI * 2 + Math.PI / 4) * L.d * 0.38]);
    const r = n === 1 ? Math.max(0.03, L.w * 0.08) : Math.max(0.015, L.w * 0.04);
    return (
      <group ref={grow}>
        {spots.map(([x, z], i) => (
          <mesh key={i} material={mat} position={[x, 0.1 + L.lift / 2, z]}>
            <cylinderGeometry args={[r, r * 1.15, L.lift + 0.02, 16]} />
          </mesh>
        ))}
      </group>
    );
  }
  // A hood is a shell around the back of the head, not a bump on the body.
  if (/\bhood\b/.test(name) && (spec.category === "dress" || spec.category === "top")) {
    const k = a.size ?? 1;
    return (
      <group ref={grow} position={[0, 1.7, -0.01]} scale={[1.05 * k, 1.15 * k, 1.1 * k]}>
        <mesh material={mat}>
          <sphereGeometry args={[0.135, 32, 20, Math.PI, Math.PI, 0, Math.PI * 0.72]} />
        </mesh>
      </group>
    );
  }
  const anchor = base;

  const count = a.count ?? 1;
  const spacing = u * (a.shape === "cone" || a.shape === "fin" || a.shape === "capsule" ? 3.2 : 2.2);
  return (
    <group ref={grow}>
      {Array.from({ length: count }, (_, i) => {
        const off = (i - (count - 1) / 2) * spacing;
        const at = slide(anchor, off);
        const spread = count > 1 ? Math.sign(off) : 0;
        const q = frame(at, VERTICAL.test(name) && a.shape === "cylinder");
        // Upright holders sit beside the surface instead of poking out of it.
        const push = VERTICAL.test(name) && a.shape === "cylinder" && a.placement !== "top" && a.placement !== "bottom" ? u * 0.5 : 0;
        const p: V3 = [at.pos[0] + at.normal[0] * push, at.pos[1] + at.normal[1] * push, at.pos[2] + at.normal[2] * push];
        return (
          <group key={i} position={p} quaternion={q}>
            <AddonShape a={a} u={u} mat={mat} name={name} spread={spread} />
          </group>
        );
      })}
    </group>
  );
}

/** Rotation taking local +y to the outward normal and +x to the tangent (or keeping +y up for upright things). */
function frame(at: Anchor, upright: boolean): THREE.Quaternion {
  const n = new THREE.Vector3(...at.normal);
  if (upright) {
    // Stay vertical, but turn so local +z faces outward.
    const flat = new THREE.Vector3(n.x, 0, n.z);
    const ang = flat.lengthSq() > 1e-6 ? Math.atan2(flat.x, flat.z) : 0;
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0));
  }
  const t = new THREE.Vector3(...at.tangent);
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  t.crossVectors(n, b).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, n, b));
}

export function Addons({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const trim = useMemo(() => new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.2 }), []);
  const color = useMemo(() => new THREE.Color(), []);
  color.set(spec.color ?? "#C5D8CF").multiplyScalar(0.6);
  useFrame((_s, dt) => {
    trim.color.lerp(color, morphK(dt));
    trim.emissive.copy(trim.color);
    trim.emissiveIntensity = flash.current * 0.5;
  });
  const accent = luminance(spec.color ?? "#C5D8CF") > 0.6 ? "#c99a2e" : "#f2c96b";
  return (
    <group>
      {(spec.addons ?? []).map((a, i) => <AddonMesh key={`${i}:${a.name}:${a.placement}:${a.shape}`} spec={spec} a={a} trim={trim} accent={accent} />)}
    </group>
  );
}

// ---------- Generic body ----------

/** Any other product: a simple body in the product's color, so edits show up before the AI mesh lands. */
export function GenericBody({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const { mat, part } = useProductMaterial(spec, "#C5D8CF", flash, { roughness: 0.4, clearcoat: 0.6 });
  const L = bodyLayout(spec)!;
  const ref = usePartTransform(spec, "body");
  const cy = L.y0 + L.h / 2;
  const m = part("body", mat);
  let mesh;
  switch (L.shape) {
    case "box": mesh = <mesh material={m}><boxGeometry args={[L.w, L.h, L.d]} /></mesh>; break;
    case "cylinder": mesh = <mesh material={m} scale={[1, 1, L.d / L.w]}><cylinderGeometry args={[L.w / 2, L.w / 2, L.h, 48]} /></mesh>; break;
    case "cone": mesh = <mesh material={m} scale={[1, 1, L.d / L.w]}><cylinderGeometry args={[L.w * 0.1, L.w / 2, L.h, 48]} /></mesh>; break;
    case "sphere": mesh = <mesh material={m} scale={[1, L.h / L.w, L.d / L.w]}><sphereGeometry args={[L.w / 2, 48, 32]} /></mesh>; break;
    case "capsule": {
      const r = Math.min(L.h, L.d) / 2;
      mesh = <mesh material={m} rotation={[0, 0, Math.PI / 2]} scale={[L.h / (2 * r), 1, L.d / (2 * r)]}><capsuleGeometry args={[r, Math.max(0.01, L.w - 2 * r), 12, 24]} /></mesh>;
      break;
    }
    case "torus": mesh = <mesh material={m}><torusGeometry args={[L.w / 2 - L.w * 0.1, L.w * 0.1, 24, 64]} /></mesh>; break;
  }
  return (
    <group position={[0, cy, 0]}>
      <group ref={ref}>{mesh}</group>
    </group>
  );
}
