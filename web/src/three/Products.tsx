import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { ProductSpec } from "@wishit/shared";
import { FABRIC_LOOK, morphK, patternTexture } from "./shapes.ts";

function useProductMaterial(spec: ProductSpec, fallback: string, flash: MutableRefObject<number>, base?: Partial<THREE.MeshPhysicalMaterialParameters>) {
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: spec.color ?? fallback, ...base }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const trim = useMemo(() => new THREE.MeshPhysicalMaterial({ roughness: 0.5 }), []);
  const color = useMemo(() => new THREE.Color(), []);
  color.set(spec.color ?? fallback);
  const look = FABRIC_LOOK[spec.fabric ?? "cotton"];
  const pattern = spec.pattern && spec.pattern !== "solid" ? spec.pattern : null;
  if ((mat.map?.name ?? null) !== pattern) {
    mat.map = pattern ? patternTexture(pattern) : null;
    if (mat.map) mat.map.name = pattern!;
    mat.needsUpdate = true;
  }
  useFrame((_s, dt) => {
    const k = morphK(dt);
    mat.color.lerp(color, k);
    if (!base?.roughness) mat.roughness += (look.roughness - mat.roughness) * k;
    mat.sheen += (look.sheen - mat.sheen) * k;
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = 0.03 + flash.current * 0.9;
    trim.color.copy(mat.color).multiplyScalar(0.55);
    flash.current = Math.max(0, flash.current - dt * 1.8);
  });
  return { mat, trim };
}

const strapCurve = (x: number) =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, 1.32, -0.12), new THREE.Vector3(x * 1.1, 1.36, -0.26),
    new THREE.Vector3(x * 1.25, 1.1, -0.3), new THREE.Vector3(x * 1.15, 0.78, -0.24), new THREE.Vector3(x, 0.66, -0.13),
  ]);

export function Backpack({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const { mat, trim } = useProductMaterial(spec, "#7FB7A4", flash);
  const hasStand = (spec.features ?? []).includes("laptop_stand");
  const hasPockets = (spec.features ?? []).includes("phone_pockets");
  const stand = useRef<THREE.Group>(null);
  const laptop = useRef<THREE.Group>(null);
  const side = useRef<THREE.Group>(null);
  const open = useRef(hasStand ? 1 : 0);
  const straps = useMemo(() => [-0.17, 0.17].map((x) => new THREE.TubeGeometry(strapCurve(x), 32, 0.03, 10, false)), []);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e6c46a", metalness: 0.9, roughness: 0.25 }), []);

  useFrame((state, dt) => {
    open.current += ((hasStand ? 1 : 0) - open.current) * morphK(dt) * 0.8;
    const o = open.current;
    if (stand.current) {
      stand.current.visible = o > 0.01;
      stand.current.rotation.x = -o * 1.45; // folds out from the top front edge to a flat platform
    }
    if (laptop.current) {
      laptop.current.visible = o > 0.6;
      const s = Math.max(0, (o - 0.6) / 0.4);
      laptop.current.scale.setScalar(s);
      laptop.current.position.y = 0.012 + Math.sin(state.clock.elapsedTime * 2) * 0.004 * s;
    }
    if (side.current) side.current.scale.setScalar(hasPockets ? 1 : 0.0001);
  });

  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.36, -0.02]} material={gold}>
        <cylinderGeometry args={[0.018, 0.022, 0.52, 12]} />
      </mesh>
      <RoundedBox args={[0.62, 0.78, 0.3]} radius={0.13} smoothness={6} position={[0, 1.0, 0]} material={mat} />
      <RoundedBox args={[0.46, 0.32, 0.1]} radius={0.05} smoothness={4} position={[0, 0.82, 0.16]} material={mat} />
      <mesh position={[0, 0.98, 0.215]} material={gold}>
        <boxGeometry args={[0.36, 0.008, 0.006]} />
      </mesh>
      <mesh position={[0.16, 0.95, 0.22]} material={gold}>
        <sphereGeometry args={[0.018, 12, 12]} />
      </mesh>
      <mesh position={[0, 1.42, -0.02]} rotation={[0, 0, 0]} material={trim}>
        <torusGeometry args={[0.07, 0.016, 10, 24, Math.PI]} />
      </mesh>
      {straps.map((g, i) => <mesh key={i} geometry={g} material={trim} />)}
      <group ref={side} position={[0.32, 0.88, 0.02]}>
        <RoundedBox args={[0.05, 0.2, 0.17]} radius={0.02} smoothness={3} material={trim} />
        <mesh position={[0.012, 0.11, 0]}>
          <boxGeometry args={[0.012, 0.1, 0.06]} />
          <meshStandardMaterial color="#20202a" />
        </mesh>
      </group>
      {/* Laptop stand: a platform hinged at the top front edge, with two kickstand legs. */}
      <group position={[0, 1.36, 0.16]}>
        <group ref={stand}>
          <group position={[0, -0.22, 0.012]}>
            <RoundedBox args={[0.5, 0.44, 0.022]} radius={0.01} smoothness={2} material={trim} />
            <mesh position={[0, -0.21, 0.03]} material={gold}>
              <boxGeometry args={[0.46, 0.012, 0.05]} />
            </mesh>
          </group>
          <group ref={laptop} position={[0, -0.24, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh position={[0, 0.006, 0]}>
              <boxGeometry args={[0.36, 0.012, 0.24]} />
              <meshStandardMaterial color="#c9ccd6" metalness={0.7} roughness={0.3} />
            </mesh>
            <group position={[0, 0.012, -0.12]} rotation={[-1.85, 0, 0]}>
              <mesh position={[0, 0, -0.12]}>
                <boxGeometry args={[0.36, 0.01, 0.24]} />
                <meshStandardMaterial color="#c9ccd6" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.006, -0.12]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.33, 0.21]} />
                <meshBasicMaterial color={new THREE.Color(0.8, 1.3, 1.6)} toneMapped={false} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export function Helmet({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const { mat, trim } = useProductMaterial(spec, "#F28DB2", flash, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 });
  const hasPhones = (spec.features ?? []).includes("headphones");
  const cups = useRef<THREE.Group>(null);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 1.3), toneMapped: false }), []);
  const on = useRef(hasPhones ? 1 : 0);
  const head = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#ebe5f8", roughness: 0.55, sheen: 0.4, emissive: "#b9a3f0", emissiveIntensity: 0.05 }), []);
  useFrame((state, dt) => {
    on.current += ((hasPhones ? 1 : 0) - on.current) * morphK(dt);
    if (cups.current) {
      cups.current.visible = on.current > 0.01;
      cups.current.scale.setScalar(on.current);
    }
    glow.color.setRGB(0.5, 1.4 + Math.sin(state.clock.elapsedTime * 3) * 0.4, 1.1);
  });
  return (
    <group position={[0, 1.08, 0]}>
      <mesh material={mat} scale={[1, 0.82, 1.2]}>
        <sphereGeometry args={[0.32, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      </mesh>
      {[-0.11, 0, 0.11].map((x) => (
        <mesh key={x} position={[x, 0.255, -0.02]} rotation={[0.1, 0, 0]} scale={[1, 0.35, 1]}>
          <capsuleGeometry args={[0.024, 0.2, 6, 12]} />
          <meshStandardMaterial color="#15121f" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.08, 0.36]} rotation={[0.5, 0, 0]} material={trim}>
        <cylinderGeometry args={[0.18, 0.2, 0.02, 32, 1, false, -Math.PI / 2, Math.PI]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} scale={[1, 1.2, 1]} material={trim}>
        <torusGeometry args={[0.312, 0.012, 8, 64]} />
      </mesh>
      {/* Faceless display head on a pole, so the helmet sits on something. */}
      <mesh position={[0, -0.1, 0.01]} scale={[0.9, 1.12, 1]} material={head}>
        <sphereGeometry args={[0.24, 40, 28]} />
      </mesh>
      <mesh position={[0, -0.4, 0]} material={head}>
        <cylinderGeometry args={[0.08, 0.1, 0.2, 24]} />
      </mesh>
      <mesh position={[0, -0.72, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 0.5, 12]} />
        <meshStandardMaterial color="#d8c88f" metalness={0.8} roughness={0.25} />
      </mesh>
      <group ref={cups}>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.335, -0.09, 0.0]} rotation={[0, 0, (s * Math.PI) / 2]}>
            <mesh>
              <cylinderGeometry args={[0.095, 0.1, 0.07, 32]} />
              <meshStandardMaterial color="#1c1a26" metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh position={[0, -0.037, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow}>
              <torusGeometry args={[0.07, 0.008, 8, 40]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
