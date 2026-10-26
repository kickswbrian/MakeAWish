import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { orbSignal } from "./signals.ts";

/**
 * UI variation 2's bubble as a real 3D object, drawn over the product canvas: a glass shell with a
 * soap-film sheen whose rim brightens with the voice. The canvas is a little larger than the bubble so
 * the rim's glow isn't clipped.
 */

export const BUBBLE3D_OVERSCAN = 1.2;

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

function Scene({ revealed }: { revealed: boolean }) {
  const group = useRef<THREE.Group>(null);
  const amp = useRef(0);

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
  useEffect(() => () => {
    front.dispose();
    back.dispose();
  }, [front, back]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Shown at full size the moment the intro hands over: the ring's coin turn (CSS) is the reveal.
    const r = revealed ? 1 : 0;
    group.current?.scale.setScalar(Math.max(0.0001, r));

    const target = orbSignal.state === "listening" || orbSignal.state === "speaking" ? Math.min(1, orbSignal.level * 2) : 0;
    amp.current += (target - amp.current) * (target > amp.current ? 0.4 : 0.1);
    front.uniforms.uTime.value = back.uniforms.uTime.value = t;
    front.uniforms.uAmp.value = back.uniforms.uAmp.value = amp.current;
    front.uniforms.uAlpha.value = back.uniforms.uAlpha.value = r;
  });

  return (
    <group ref={group}>
      <mesh material={back}>
        <sphereGeometry args={[1, 96, 64]} />
      </mesh>
      <mesh material={front} renderOrder={2}>
        <sphereGeometry args={[1, 96, 64]} />
      </mesh>
    </group>
  );
}

export interface Bubble3DProps {
  /** Show the sphere (springs in when this turns true). */
  revealed: boolean;
  /** Stop rendering (nothing to show yet). */
  paused?: boolean;
}

export default function Bubble3D({ revealed, paused = false }: Bubble3DProps) {
  // Perspective camera at distance 9 framing the sphere (radius 1) at 1 / OVERSCAN of the canvas.
  const fov = (2 * Math.atan(BUBBLE3D_OVERSCAN / 9) * 180) / Math.PI;
  return (
    <div className="bubble3d" aria-hidden="true">
      <Canvas frameloop={paused ? "never" : "always"} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} camera={{ fov, position: [0, 0, 9], near: 0.1, far: 50 }} style={{ pointerEvents: "none" }}>
        <Scene revealed={revealed} />
      </Canvas>
    </div>
  );
}
