import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { fx, orbSignal } from "./signals.ts";

export const ORB_Y = 1.12;
export const ORB_R = 0.42;

const vert = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uSwirl;
varying vec3 vN;
varying vec3 vView;
varying float vNoise;
float n3(vec3 p) {
  return sin(p.x * 3.1 + uSwirl * 1.3) * sin(p.y * 2.7 - uSwirl * 1.1) * sin(p.z * 3.3 + uSwirl * 0.9);
}
void main() {
  float nz = n3(normal * 2.2 + vec3(0.0, uTime * 0.2, 0.0));
  vec3 p = position + normal * nz * (0.02 + uLevel * 0.14);
  vNoise = nz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uGlow;
varying vec3 vN;
varying vec3 vView;
varying float vNoise;
void main() {
  float f = pow(1.0 - max(dot(vN, vView), 0.0), 2.0);
  vec3 col = mix(uA, uB, 0.5 + 0.5 * vNoise);
  col = mix(col, uC, f);
  gl_FragColor = vec4(col * (0.85 + f * 0.35) * min(uGlow, 1.15), 0.35 + 0.55 * f);
}`;

/** The genie's sparkle orb. Idle breathes, listening ripples with the mic, thinking swirls, speaking pulses. */
export function Orb({ visible = true }: { visible?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const moons = useRef<THREE.Group>(null);
  const s = useRef({ level: 0, swirl: 0, glow: 1, lastInward: 0, lastSparkle: 0 });
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        uniforms: {
          uTime: { value: 0 }, uLevel: { value: 0 }, uSwirl: { value: 0 }, uGlow: { value: 1 },
          uA: { value: new THREE.Color("#C5D8CF") }, uB: { value: new THREE.Color("#F9C6DC") }, uC: { value: new THREE.Color("#FFFFFF") },
        },
      }),
    [],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const st = orbSignal.state;
    const cur = s.current;
    const lvl = st === "listening" || st === "speaking" ? orbSignal.level : 0;
    cur.level += (lvl - cur.level) * Math.min(1, dt * 14);
    const swirlSpeed = st === "thinking" ? 3.2 : st === "speaking" ? 1.2 : 0.45;
    cur.swirl += dt * swirlSpeed;
    const glowT = st === "thinking" ? 1.35 : st === "speaking" ? 1.15 + cur.level * 1.4 : st === "listening" ? 1.1 + cur.level : 1;
    cur.glow += (glowT - cur.glow) * Math.min(1, dt * 8);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uLevel.value = cur.level;
    mat.uniforms.uSwirl.value = cur.swirl;
    mat.uniforms.uGlow.value = cur.glow;
    let scale = 1 + Math.sin(t * 1.6) * 0.03;
    if (st === "listening") scale = 1 + cur.level * 0.28;
    if (st === "speaking") scale = 1.02 + cur.level * 0.2;
    if (st === "thinking") scale = 0.95 + Math.sin(t * 7) * 0.015;
    if (group.current) {
      const target = visible ? scale : 0;
      group.current.scale.setScalar(group.current.scale.x + (target - group.current.scale.x) * Math.min(1, dt * 10));
      group.current.visible = group.current.scale.x > 0.01;
    }
    if (core.current) core.current.scale.setScalar(0.5 + cur.glow * 0.12);
    if (moons.current) moons.current.rotation.y += dt * (0.6 + swirlSpeed * 0.5);
    if (visible && t - cur.lastSparkle > 0.07) {
      cur.lastSparkle = t;
      fx.band({ y0: ORB_Y - 0.55, y1: ORB_Y + 0.45, r: 0.66 }, 2, Math.random() < 0.6 ? "#E9C46A" : "#F4A8C8");
    }
    if (visible && st === "thinking" && t - cur.lastInward > 0.12) {
      cur.lastInward = t;
      fx.inward([0, ORB_Y, 0], ORB_R, 10, Math.random() < 0.5 ? "#E9C46A" : "#F4A8C8");
    }
  });

  return (
    <group position={[0, ORB_Y, 0]}>
      <group ref={group} scale={0.001}>
        <mesh material={mat}>
          <icosahedronGeometry args={[ORB_R, 24]} />
        </mesh>
        <mesh ref={core}>
          <sphereGeometry args={[ORB_R * 0.45, 32, 24]} />
          <meshBasicMaterial color={new THREE.Color(1.3, 1.25, 1.05)} toneMapped={false} transparent opacity={0.5} />
        </mesh>
        <group ref={moons}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[Math.cos((i * Math.PI * 2) / 3) * 0.62, Math.sin(i * 2.1) * 0.18, Math.sin((i * Math.PI * 2) / 3) * 0.62]}>
              <sphereGeometry args={[0.022, 12, 12]} />
              <meshBasicMaterial color={i === 0 ? new THREE.Color(2.2, 1.8, 0.8) : i === 1 ? new THREE.Color(0.8, 2, 1.5) : new THREE.Color(1.6, 1.3, 2.2)} toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
