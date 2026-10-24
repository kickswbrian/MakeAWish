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
export function patternTexture(kind: "floral" | "stripe"): THREE.Texture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  if (kind === "stripe") {
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
  t.repeat.set(kind === "stripe" ? 1 : 3, kind === "stripe" ? 5 : 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(kind, t);
  return t;
}

export interface FabricLook { roughness: number; sheen: number; sheenRoughness: number; clearcoat: number }
export const FABRIC_LOOK: Record<string, FabricLook> = {
  cotton: { roughness: 0.82, sheen: 0.35, sheenRoughness: 0.8, clearcoat: 0 },
  linen: { roughness: 0.96, sheen: 0.2, sheenRoughness: 0.9, clearcoat: 0 },
  satin: { roughness: 0.26, sheen: 1, sheenRoughness: 0.25, clearcoat: 0.35 },
  knit: { roughness: 0.92, sheen: 1, sheenRoughness: 0.55, clearcoat: 0 },
};

/** Exponential smoothing factor: ~95% of the way in 400 ms. */
export const morphK = (dt: number) => 1 - Math.exp(-Math.min(dt, 0.1) * 7.5);
