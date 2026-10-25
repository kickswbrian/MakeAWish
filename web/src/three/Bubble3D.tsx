import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { orbSignal } from "./signals.ts";

/**
 * UI variation 2's bubble as a real 3D object, drawn over the product canvas: a glass shell with a
 * soap-film sheen, a particle vortex and light ribbons inside that react to the voice (swirl while
 * listening, pulse while the genie speaks, spin hard while it thinks), and clouds that spin in
 * when the bubble first forms. The canvas is 1.7x the bubble so the clouds can orbit it.
 */

export const BUBBLE3D_OVERSCAN = 1.7;
// Saturated enough to read on the cream page (additive white would vanish into it).
const PALETTE = ["#E9C46A", "#F08FB8", "#8FBFAE", "#FFFFFF", "#F2D88A", "#F4A8C8", "#9FBFB2"];

// ---------- Glass shell ----------

const shellVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vObj = position;
    gl_Position = projectionMatrix * mv;
  }`;
const shellFrag = /* glsl */ `
  uniform float uTime; uniform float uAmp; uniform float uAlpha; uniform float uBack;
  varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  void main() {
    vec3 n = normalize(vN);
    if (uBack > 0.5) n = -n;
    vec3 v = normalize(vV);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.3);
    // Thin-film bands drifting over the surface, like a soap bubble.
    float band = fres * 1.5 + vObj.y * 0.5 + sin(vObj.x * 3.1 + uTime * 0.55) * 0.2 + uTime * 0.035;
    vec3 film = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + band));
    // Kept close to the brand pastels (pink, gold, sage) so it reads as pearl, not rainbow.
    vec3 pastel = mix(vec3(0.976, 0.776, 0.863), vec3(0.949, 0.847, 0.541), 0.5 + 0.5 * sin(band * 3.0));
    pastel = mix(pastel, vec3(0.773, 0.847, 0.812), 0.5 + 0.5 * sin(band * 2.0 + 1.7));
    vec3 col = mix(pastel, film, 0.4);
    col = mix(vec3(1.0), col, 0.5 + 0.5 * fres);
    vec3 l1 = normalize(vec3(-0.55, 0.65, 0.6));
    vec3 l2 = normalize(vec3(0.65, -0.45, 0.45));
    float s1 = pow(max(dot(n, normalize(l1 + v)), 0.0), 110.0);
    float s2 = pow(max(dot(n, normalize(l2 + v)), 0.0), 36.0) * 0.3;
    float a = (0.04 + fres * 0.78 + uAmp * fres * 0.35) * uAlpha;
    if (uBack > 0.5) { a *= 0.3; s1 = 0.0; }
    gl_FragColor = vec4(col + (s1 + s2) * 1.1, clamp(a + (s1 + s2) * uAlpha, 0.0, 1.0));
  }`;

// ---------- Vortex particles ----------

const vortexVert = /* glsl */ `
  uniform float uTime; uniform float uSpin; uniform float uPulse; uniform float uTight; uniform float uSize; uniform float uFade;
  attribute vec4 aSeed; attribute vec3 aColor;
  varying vec3 vColor; varying float vA;
  void main() {
    float r = aSeed.x; float a0 = aSeed.y; float y = aSeed.z; float k = aSeed.w;
    float ang = a0 + uSpin * (0.55 + 0.75 / (r + 0.25));
    float rr = r * mix(1.0, 0.5, uTight) * (1.0 + uPulse * 0.35 * sin(uTime * 7.0 + k * 12.0 + r * 9.0));
    float yy = y * (1.0 - 0.4 * uTight) + 0.07 * sin(uTime * 1.3 + k * 21.0);
    rr = min(rr, sqrt(max(0.0, 0.84 - yy * yy)));
    vec3 p = vec3(cos(ang) * rr, yy, sin(ang) * rr);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.5 + k) * (1.0 + uPulse * 0.7) / -mv.z;
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vA = uFade * (0.3 + 0.7 * k);
  }`;
const pointFrag = /* glsl */ `
  varying vec3 vColor; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vA);
    #include <colorspace_fragment>
  }`;

// ---------- Ribbons ----------

const ribbonVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ribbonFrag = /* glsl */ `
  uniform float uTime; uniform float uGlow; uniform vec3 uColor; uniform float uPhase;
  varying vec2 vUv;
  void main() {
    float w = 0.5 + 0.5 * sin(vUv.x * 18.85 - uTime * 2.2 + uPhase);
    float a = pow(w, 4.0) * uGlow;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), w * 0.35), a);
    #include <colorspace_fragment>
  }`;

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = 34 + rnd() * 60, y = 44 + rnd() * 40, r = 18 + rnd() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.75)");
    grad.addColorStop(0.85, "rgba(255,255,255,0.2)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Targets { spin: number; pulse: number; tight: number; ribbons: number; fade: number }
function targetsFor(state: string, level: number, dim: boolean): Targets {
  const amp = Math.min(1, level * 2.2);
  const t: Targets =
    state === "thinking" ? { spin: 2.4, pulse: 0.15, tight: 0.55, ribbons: 0.85, fade: 0.9 }
      : state === "speaking" ? { spin: 0.8, pulse: 0.25 + amp * 1.5, tight: 0.05, ribbons: 0.45 + amp * 0.6, fade: 0.85 }
      : state === "listening" ? { spin: 0.55 + amp * 1.4, pulse: amp * 1.1, tight: 0.12, ribbons: 0.3 + amp * 0.7, fade: 0.8 }
      : { spin: 0.3, pulse: 0, tight: 0, ribbons: 0, fade: 0 };
  if (dim && state !== "thinking") {
    t.fade *= 0.18;
    t.ribbons *= 0.3;
  }
  return t;
}

function Scene({ revealed, burstKey, dim }: { revealed: boolean; burstKey: number; dim: boolean }) {
  const { size, gl } = useThree();
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const cur = useRef<Targets>({ spin: 0.3, pulse: 0, tight: 0, ribbons: 0.2, fade: 0.6 });
  const spin = useRef(0);
  const reveal = useRef(0);
  const burstAt = useRef(-1);
  const cloudLevel = useRef(0);

  const front = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAmp: { value: 0 }, uAlpha: { value: 0 }, uBack: { value: 0 } },
  }), []);
  const back = useMemo(() => {
    const m = front.clone();
    m.uniforms = THREE.UniformsUtils.clone(front.uniforms);
    m.uniforms.uBack.value = 1;
    m.side = THREE.BackSide;
    return m;
  }, [front]);

  const vortex = useMemo(() => {
    const n = 900;
    const seed = new Float32Array(n * 4), color = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      seed.set([0.12 + Math.random() * 0.74, Math.random() * Math.PI * 2, (Math.random() * 2 - 1) * 0.72, Math.random()], i * 4);
      c.set(PALETTE[i % PALETTE.length]);
      color.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const m = new THREE.ShaderMaterial({
      vertexShader: vortexVert, fragmentShader: pointFrag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSpin: { value: 0 }, uPulse: { value: 0 }, uTight: { value: 0 }, uSize: { value: 30 }, uFade: { value: 0 } },
    });
    return { g, m };
  }, []);

  const ribbons = useMemo(() => [0, 1, 2].map((i) => {
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s < 64; s++) {
      const th = (s / 64) * Math.PI * 2;
      const r = 0.6 + 0.12 * Math.sin(3 * th + i * 1.7);
      pts.push(new THREE.Vector3(Math.cos(th) * r, 0.22 * Math.sin(2 * th + i), Math.sin(th) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const g = new THREE.TubeGeometry(curve, 220, 0.011, 6, true);
    const m = new THREE.ShaderMaterial({
      vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uColor: { value: new THREE.Color(["#E9C46A", "#F08FB8", "#7FB5A2"][i]) }, uPhase: { value: i * 2.1 } },
    });
    return { g, m, tilt: new THREE.Euler(0.5 + i * 0.7, i * 1.1, 0.3 - i * 0.5) };
  }), []);

  const cloudTex = useMemo(() => cloudTexture(), []);
  const clouds = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    base: (i / 12) * Math.PI * 2 + Math.random() * 0.4,
    y: (Math.random() * 2 - 1) * 0.35,
    s: 0.45 + Math.random() * 0.35,
    speed: 0.5 + Math.random() * 0.35,
    mat: new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false, color: new THREE.Color(["#F2CF72", "#F39CC2", "#9CCAB8"][i % 3]) }),
  })), [cloudTex]);
  const cloudRefs = useRef<(THREE.Sprite | null)[]>([]);

  useEffect(() => {
    if (burstKey > 0) burstAt.current = -2; // armed: starts on the next frame's clock
  }, [burstKey]);
  useEffect(() => () => {
    front.dispose(); back.dispose(); vortex.g.dispose(); vortex.m.dispose(); cloudTex.dispose();
    ribbons.forEach((r) => { r.g.dispose(); r.m.dispose(); });
    clouds.forEach((c) => c.mat.dispose());
  }, [front, back, vortex, ribbons, clouds, cloudTex]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 4);
    const want = targetsFor(orbSignal.state, orbSignal.level, dim);
    const c = cur.current;
    (Object.keys(want) as (keyof Targets)[]).forEach((key) => { c[key] += (want[key] - c[key]) * k; });
    spin.current += dt * c.spin;

    // Reveal: the sphere springs up from nothing when the intro hands over.
    const goal = revealed ? 1 : 0;
    reveal.current += (goal - reveal.current) * (1 - Math.exp(-dt * (revealed ? 5 : 8)));
    const r = reveal.current;
    const springy = r < 0.001 ? 0.0001 : 1 + Math.sin(r * Math.PI) * 0.06 * (1 - r) * 4;
    group.current?.scale.setScalar(Math.max(0.0001, r * springy));

    const amp = Math.min(1, orbSignal.level * 2);
    front.uniforms.uTime.value = back.uniforms.uTime.value = t;
    front.uniforms.uAmp.value = back.uniforms.uAmp.value = amp;
    front.uniforms.uAlpha.value = back.uniforms.uAlpha.value = r;

    const px = gl.getPixelRatio() * (size.height / 640);
    const vu = vortex.m.uniforms;
    vu.uTime.value = t; vu.uSpin.value = spin.current; vu.uPulse.value = c.pulse; vu.uTight.value = c.tight; vu.uFade.value = c.fade * r; vu.uSize.value = 62 * px;
    ribbons.forEach((rb) => { rb.m.uniforms.uTime.value = t; rb.m.uniforms.uGlow.value = c.ribbons * r; });
    if (inner.current) {
      inner.current.rotation.y = t * 0.12;
      inner.current.rotation.x = Math.sin(t * 0.21) * 0.25;
    }

    // When the bubble forms the clouds spin in around it, then fade away.
    if (burstAt.current === -2) burstAt.current = t;
    const since = burstAt.current >= 0 ? t - burstAt.current : 99;
    const rest = 0;
    const cloudGoal = since < 0.5 ? since / 0.5 : since < 3.2 ? 1 : Math.max(rest, 1 - (since - 3.2) / 2.2);
    cloudLevel.current += (cloudGoal * r - cloudLevel.current) * (1 - Math.exp(-dt * 3));
    const swirl = since < 3.2 ? 2.6 - since * 0.6 : 0.35;
    const radius = since < 1.4 ? 2.1 - (since / 1.4) * 0.85 : 1.18;
    clouds.forEach((cl, i) => {
      const sp = cloudRefs.current[i];
      if (!sp) return;
      const a = cl.base + t * cl.speed * swirl * 0.4 + since * 0.3;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      sp.position.set(x, cl.y + Math.sin(a * 2) * 0.12, z);
      sp.scale.setScalar(cl.s * (0.9 + 0.1 * Math.sin(t + i)));
      // Behind the sphere: fainter, so they read as going around it.
      cl.mat.opacity = cloudLevel.current * (z < 0 ? 0.45 : 0.95);
    });
  });

  return (
    <group ref={group}>
      <mesh material={back}>
        <sphereGeometry args={[1, 96, 64]} />
      </mesh>
      <group ref={inner}>
        <points geometry={vortex.g} material={vortex.m} frustumCulled={false} />
        {ribbons.map((rb, i) => (
          <mesh key={i} geometry={rb.g} material={rb.m} rotation={rb.tilt} />
        ))}
      </group>
      <mesh material={front} renderOrder={2}>
        <sphereGeometry args={[1, 96, 64]} />
      </mesh>
      {clouds.map((cl, i) => (
        <sprite key={i} ref={(s) => { cloudRefs.current[i] = s; }} material={cl.mat} renderOrder={4} />
      ))}
    </group>
  );
}

export interface Bubble3DProps {
  /** Show the sphere (springs in when this turns true). */
  revealed: boolean;
  /** Bump to spin the clouds in. */
  burstKey: number;
  /** A product is showing inside: keep the vortex quiet so it doesn't cover it. */
  dim?: boolean;
}

export default function Bubble3D({ revealed, burstKey, dim = false }: Bubble3DProps) {
  // Perspective camera at distance 9 framing the sphere (radius 1) at 1 / OVERSCAN of the canvas.
  const fov = (2 * Math.atan(BUBBLE3D_OVERSCAN / 9) * 180) / Math.PI;
  return (
    <div className="bubble3d" aria-hidden="true">
      <Canvas dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} camera={{ fov, position: [0, 0, 9], near: 0.1, far: 50 }} style={{ pointerEvents: "none" }}>
        <Scene revealed={revealed} burstKey={burstKey} dim={dim} />
      </Canvas>
    </div>
  );
}
