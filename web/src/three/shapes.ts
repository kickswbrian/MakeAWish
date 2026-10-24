import * as THREE from "three";

/** Shared body measurements (scene units; pedestal top is ~0.1, waist 1.15, shoulders ~1.5). */
export const WAIST_Y = 1.15;
export const HIP_Y = 0.95;
export const HEM_Y = { mini: 0.8, knee: 0.6, midi: 0.4, maxi: 0.18 } as const;

const TORSO: [number, number][] = [
  [0.78, 0.18], [0.88, 0.212], [0.95, 0.225], [1.05, 0.2], [1.15, 0.16], [1.25, 0.172],
  [1.35, 0.196], [1.43, 0.186], [1.5, 0.155], [1.55, 0.11], [1.58, 0.062], [1.64, 0.05],
];

/** Dress-form radius at height y, cosine-interpolated between control points. */
export function torsoR(y: number): number {
  if (y <= TORSO[0][0]) return TORSO[0][1];
  for (let i = 1; i < TORSO.length; i++) {
    const [y1, r1] = TORSO[i];
    if (y <= y1) {
      const [y0, r0] = TORSO[i - 1];
      const t = (y - y0) / (y1 - y0);
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return r0 + (r1 - r0) * s;
    }
  }
  return TORSO[TORSO.length - 1][1];
}
/** Dress forms are wider across the shoulders than front to back. */
export const torsoXS = (y: number) => 1 + 0.18 * smooth(1.32, 1.5, y);
export const TORSO_ZS = 0.78;

/** Bodice radius at y for part scale s: a bigger bodice stands further off the form (not at the
 * neckline), a smaller one never sinks into it. Shared by Garment.tsx and anchors.ts. */
export function bodiceR(y: number, base: number, s: number): number {
  const f = 1 + (Math.max(0.3, s) - 1) * 0.35 * (1 - smooth(1.5, 1.6, y));
  return Math.max(torsoR(y) + 0.004, base * f);
}

export function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A (rows+1) x (cols+1) grid wrapped around the y axis; positions are filled in by the caller. */
export function makeWrapGrid(rows: number, cols: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const verts = (rows + 1) * (cols + 1);
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const uv = new Float32Array(verts * 2);
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const k = i * (cols + 1) + j;
      uv[k * 2] = j / cols;
      uv[k * 2 + 1] = 1 - i / rows;
    }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.5);
  return g;
}

/** Fill a wrap grid. fn(row, theta) returns [radius, y, xScale, zScale]; theta = 0 faces the camera. */
export function fillWrapGrid(
  g: THREE.BufferGeometry, rows: number, cols: number,
  fn: (i: number, theta: number, out: number[]) => void,
) {
  const pos = g.attributes.position.array as Float32Array;
  const out = [0, 0, 1, 1];
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2 - Math.PI;
      fn(i, th, out);
      const k = (i * (cols + 1) + j) * 3;
      pos[k] = Math.sin(th) * out[0] * out[2];
      pos[k + 1] = out[1];
      pos[k + 2] = Math.cos(th) * out[0] * out[3];
    }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}

// ---------- Procedural fabric patterns (greyscale, tinted by material.color) ----------

const textures = new Map<string, THREE.Texture>();
export type PatternKind = "floral" | "stripe" | "polka_dot" | "plaid" | "checkered" | "camo" | "leopard" | "chevron";
const REPEAT: Partial<Record<PatternKind, [number, number]>> = { stripe: [1, 5], polka_dot: [4, 4], plaid: [2, 2], checkered: [3, 3], camo: [2, 2], leopard: [3, 3], chevron: [2, 4] };
export function patternTexture(kind: PatternKind): THREE.Texture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  /** Draw at (x, y) and at the wrapped copies so the tile repeats seamlessly. */
  const tiled = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) draw(x + dx, y + dy);
  };
  if (kind === "polka_dot") {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = "#5c5c66";
    for (const [x, y] of [[64, 64], [192, 64], [320, 64], [448, 64], [0, 192], [128, 192], [256, 192], [384, 192], [64, 320], [192, 320], [320, 320], [448, 320], [0, 448], [128, 448], [256, 448], [384, 448]])
      tiled(x, y, (px, py) => { g.beginPath(); g.arc(px, py, 26, 0, Math.PI * 2); g.fill(); });
  } else if (kind === "plaid") {
    g.fillStyle = "#e6e6ea";
    g.fillRect(0, 0, 512, 512);
    g.globalAlpha = 0.45;
    g.fillStyle = "#55555f";
    for (const o of [0, 256]) {
      g.fillRect(o + 40, 0, 90, 512);
      g.fillRect(0, o + 40, 512, 90);
    }
    g.globalAlpha = 0.7;
    g.fillStyle = "#2c2c33";
    for (const o of [0, 256]) {
      g.fillRect(o + 170, 0, 14, 512);
      g.fillRect(0, o + 170, 512, 14);
    }
    g.globalAlpha = 1;
  } else if (kind === "checkered") {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? "#ffffff" : "#55555f";
      g.fillRect(i * 128, j * 128, 128, 128);
    }
  } else if (kind === "camo" || kind === "leopard") {
    g.fillStyle = kind === "camo" ? "#c9c9cc" : "#e8e2d2";
    g.fillRect(0, 0, 512, 512);
    const tones = kind === "camo" ? ["#8f8f95", "#5d5d63", "#35353a"] : ["#8a7a50"];
    for (let n = 0; n < (kind === "camo" ? 46 : 40); n++) {
      const x = rnd() * 512, y = rnd() * 512, r = (kind === "camo" ? 34 : 16) + rnd() * (kind === "camo" ? 40 : 12);
      const tone = tones[n % tones.length];
      const pts = Array.from({ length: 9 }, (_, k) => {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.6 + rnd() * 0.6);
        return [Math.cos(a) * rr, Math.sin(a) * rr * (kind === "camo" ? 0.7 : 0.85)];
      });
      tiled(x, y, (px, py) => {
        g.beginPath();
        pts.forEach(([dx, dy], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.closePath();
        if (kind === "camo") {
          g.fillStyle = tone;
          g.fill();
        } else {
          g.lineWidth = 9;
          g.strokeStyle = "#1e1a14";
          g.stroke();
          g.fillStyle = "#b39a62";
          g.fill();
        }
      });
    }
  } else if (kind === "chevron") {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#55555f";
    g.lineWidth = 40;
    g.lineJoin = "miter";
    for (let y = -128; y < 640; y += 128) {
      g.beginPath();
      for (let x = 0; x <= 512; x += 128) g.lineTo(x, y + ((x / 128) % 2 ? 64 : 0));
      g.stroke();
    }
  } else if (kind === "stripe") {
    for (let y = 0; y < 512; y += 64) {
      g.fillStyle = "#ffffff";
      g.fillRect(0, y, 512, 32);
      g.fillStyle = "#6f6f78";
      g.fillRect(0, y + 32, 512, 32);
    }
  } else {
    g.fillStyle = "#d4d4da";
    g.fillRect(0, 0, 512, 512);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 34; n++) {
      const x = rnd() * 512, y = rnd() * 512, r = 14 + rnd() * 16;
      for (const [dx, dy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
        g.save();
        g.translate(x + dx, y + dy);
        g.rotate(rnd() * Math.PI);
        g.fillStyle = "#ffffff";
        for (let p = 0; p < 5; p++) {
          g.rotate((Math.PI * 2) / 5);
          g.beginPath();
          g.ellipse(0, r * 0.6, r * 0.38, r * 0.62, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = "#8a7a50";
        g.beginPath();
        g.arc(0, 0, r * 0.28, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const [rx, ry] = REPEAT[kind] ?? [3, 3];
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(kind, t);
  return t;
}

export interface FabricLook { roughness: number; sheen: number; sheenRoughness: number; clearcoat: number; metalness?: number; glow?: number }
export const FABRIC_LOOK: Record<string, FabricLook> = {
  cotton: { roughness: 0.82, sheen: 0.35, sheenRoughness: 0.8, clearcoat: 0 },
  linen: { roughness: 0.96, sheen: 0.2, sheenRoughness: 0.9, clearcoat: 0 },
  satin: { roughness: 0.26, sheen: 1, sheenRoughness: 0.25, clearcoat: 0.35 },
  knit: { roughness: 0.92, sheen: 1, sheenRoughness: 0.55, clearcoat: 0 },
  denim: { roughness: 0.9, sheen: 0.25, sheenRoughness: 0.9, clearcoat: 0 },
  leather: { roughness: 0.42, sheen: 0, sheenRoughness: 0.5, clearcoat: 0.45 },
  velvet: { roughness: 0.95, sheen: 1, sheenRoughness: 0.3, clearcoat: 0 },
  sequin: { roughness: 0.22, sheen: 0.4, sheenRoughness: 0.3, clearcoat: 0.6, metalness: 0.65 },
};
/** Finish overrides the fabric's surface. */
export const FINISH_LOOK: Record<string, Partial<FabricLook>> = {
  matte: { roughness: 0.95, clearcoat: 0, metalness: 0 },
  glossy: { roughness: 0.14, clearcoat: 1, sheen: 0.2 },
  metallic: { roughness: 0.28, metalness: 0.9, clearcoat: 0.4, sheen: 0 },
  glow: { glow: 0.75 },
};

/** Fabric + finish for one spec, as plain numbers a material can ease toward. */
export function lookFor(spec: { fabric?: string; finish?: string }): Required<FabricLook> {
  const l = { ...FABRIC_LOOK[spec.fabric ?? "cotton"], ...(spec.finish ? FINISH_LOOK[spec.finish] : {}) };
  return { metalness: 0, glow: 0, ...l } as Required<FabricLook>;
}

/** Exponential smoothing factor: ~95% of the way in 400 ms. */
export const morphK = (dt: number) => 1 - Math.exp(-Math.min(dt, 0.1) * 7.5);
