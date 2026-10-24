import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { setFxImpl, type Bounds, type FxApi, type Vec3 } from "./signals.ts";

const N = 2400;
const MODE_FREE = 0;
const MODE_ATTRACT = 1;

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
uniform float uPixel;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixel / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  float core = smoothstep(0.18, 0.0, d);
  if (a * vAlpha < 0.002) discard;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6), a * vAlpha);
}`;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const tmpColor = new THREE.Color();

/** One instanced point cloud for every effect: build-in swirl, shimmer bursts, dissolves, thinking. */
export function Particles() {
  const { geo, mat, st } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 10);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uPixel: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const st = {
      vel: new Float32Array(N * 3),
      start: new Float32Array(N * 3),
      target: new Float32Array(N * 3),
      life: new Float32Array(N).fill(1),
      max: new Float32Array(N).fill(1),
      delay: new Float32Array(N),
      swirl: new Float32Array(N),
      size: new Float32Array(N),
      mode: new Uint8Array(N),
      alive: new Uint8Array(N),
      cursor: 0,
    };
    return { geo, mat, st };
  }, []);

  useEffect(() => {
    const pos = geo.attributes.position.array as Float32Array;
    const col = geo.attributes.aColor.array as Float32Array;
    const alloc = (color: string, lifetime: number, size: number) => {
      const i = st.cursor;
      st.cursor = (st.cursor + 1) % N;
      tmpColor.set(color);
      // Slight hue jitter towards white so bursts sparkle instead of looking flat.
      const w = Math.random() * 0.45;
      col[i * 3] = tmpColor.r + (1 - tmpColor.r) * w;
      col[i * 3 + 1] = tmpColor.g + (1 - tmpColor.g) * w;
      col[i * 3 + 2] = tmpColor.b + (1 - tmpColor.b) * w;
      st.life[i] = 0;
      st.max[i] = lifetime;
      st.size[i] = size;
      st.delay[i] = 0;
      st.alive[i] = 1;
      return i;
    };
    const setP = (arr: Float32Array, i: number, x: number, y: number, z: number) => {
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    };
    const onCylinder = (b: Bounds, out: Float32Array, i: number, inset = 1) => {
      const th = Math.random() * Math.PI * 2;
      const y = b.y0 + Math.random() * (b.y1 - b.y0);
      const r = b.r * inset * (0.85 + Math.random() * 0.2);
      setP(out, i, Math.sin(th) * r, y, Math.cos(th) * r * 0.85);
    };

    const api: FxApi = {
      burst(c: Vec3, count, color, speed = 1.6) {
        for (let n = 0; n < count; n++) {
          const i = alloc(color, 0.6 + Math.random() * 0.7, 10 + Math.random() * 16);
          st.mode[i] = MODE_FREE;
          setP(pos, i, c[0], c[1], c[2]);
          const u = Math.random() * 2 - 1;
          const th = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const v = speed * (0.4 + Math.random() * 0.8);
          setP(st.vel, i, s * Math.cos(th) * v, u * v + 0.3, s * Math.sin(th) * v);
          st.swirl[i] = (Math.random() - 0.5) * 3;
        }
      },
      band(b, count, color) {
        for (let n = 0; n < count; n++) {
          const i = alloc(color, 0.5 + Math.random() * 0.6, 8 + Math.random() * 14);
          st.mode[i] = MODE_FREE;
          onCylinder(b, pos, i, 1.05);
          const x = pos[i * 3], z = pos[i * 3 + 2];
          const l = Math.hypot(x, z) || 1;
          setP(st.vel, i, (x / l) * 0.25, 0.35 + Math.random() * 0.4, (z / l) * 0.25);
          st.swirl[i] = 1.5 + Math.random() * 1.5;
        }
      },
      assemble(from, b, count, color, duration = 0.85) {
        for (let n = 0; n < count; n++) {
          const i = alloc(color, duration + 0.35, 9 + Math.random() * 12);
          st.mode[i] = MODE_ATTRACT;
          st.delay[i] = Math.random() * 0.2;
          const th = Math.random() * Math.PI * 2;
          const rr = 0.05 + Math.random() * 0.4;
          setP(st.start, i, from[0] + Math.sin(th) * rr, from[1] + (Math.random() - 0.5) * 0.4, from[2] + Math.cos(th) * rr);
          setP(pos, i, st.start[i * 3], st.start[i * 3 + 1], st.start[i * 3 + 2]);
          onCylinder(b, st.target, i);
          st.swirl[i] = (2.5 + Math.random() * 2.5) * (Math.random() < 0.5 ? -1 : 1);
        }
      },
      inward(c, radius, count, color) {
        for (let n = 0; n < count; n++) {
          const i = alloc(color, 0.9, 6 + Math.random() * 8);
          st.mode[i] = MODE_ATTRACT;
          const th = Math.random() * Math.PI * 2;
          const u = Math.random() * 2 - 1;
          const s = Math.sqrt(1 - u * u);
          const r = radius * (1.6 + Math.random() * 0.8);
          setP(st.start, i, c[0] + s * Math.cos(th) * r, c[1] + u * r, c[2] + s * Math.sin(th) * r);
          setP(pos, i, st.start[i * 3], st.start[i * 3 + 1], st.start[i * 3 + 2]);
          setP(st.target, i, c[0] + s * Math.cos(th) * radius * 0.5, c[1] + u * radius * 0.5, c[2] + s * Math.sin(th) * radius * 0.5);
          st.swirl[i] = 3;
        }
      },
    };
    setFxImpl(api);
    return () => setFxImpl(null);
  }, [geo, st]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    mat.uniforms.uPixel.value = state.size.height * state.viewport.dpr * 0.004;
    const pos = geo.attributes.position.array as Float32Array;
    const alpha = geo.attributes.aAlpha.array as Float32Array;
    const size = geo.attributes.aSize.array as Float32Array;
    const drag = Math.pow(0.12, dt);
    let any = false;
    for (let i = 0; i < N; i++) {
      if (!st.alive[i]) continue;
      any = true;
      st.life[i] += dt;
      const life = st.life[i], max = st.max[i];
      if (life >= max) {
        st.alive[i] = 0;
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      const j = i * 3;
      if (st.mode[i] === MODE_FREE) {
        st.vel[j] *= drag;
        st.vel[j + 1] = st.vel[j + 1] * drag + 0.15 * dt;
        st.vel[j + 2] *= drag;
        let x = pos[j] + st.vel[j] * dt;
        let z = pos[j + 2] + st.vel[j + 2] * dt;
        const a = st.swirl[i] * dt;
        const ca = Math.cos(a), sa = Math.sin(a);
        pos[j] = x * ca - z * sa;
        pos[j + 2] = x * sa + z * ca;
        pos[j + 1] += st.vel[j + 1] * dt;
        const f = life / max;
        alpha[i] = Math.min(1, f * 8) * (1 - f) * (0.7 + 0.3 * Math.sin(life * 30 + i));
      } else {
        const travel = Math.max(0.01, max - 0.35 - st.delay[i]);
        const p = Math.min(1, Math.max(0, (life - st.delay[i]) / travel));
        const e = ease(p);
        const sx = st.start[j], sy = st.start[j + 1], sz = st.start[j + 2];
        const tx = st.target[j], ty = st.target[j + 1], tz = st.target[j + 2];
        const x = sx + (tx - sx) * e, z = sz + (tz - sz) * e;
        const ang = (1 - e) * st.swirl[i];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        pos[j] = x * ca - z * sa;
        pos[j + 2] = x * sa + z * ca;
        pos[j + 1] = sy + (ty - sy) * e + Math.sin(p * Math.PI) * 0.15;
        const fadeOut = life > max - 0.35 ? (max - life) / 0.35 : 1;
        alpha[i] = (life < st.delay[i] ? 0 : Math.min(1, p * 5)) * fadeOut;
      }
      size[i] = st.size[i];
    }
    if (any) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
    }
  });

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={10} />;
}
