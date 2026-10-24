import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ProductSpec } from "@wishit/shared";
import { fillWrapGrid, HIP_Y, makeWrapGrid, morphK, smooth, TORSO_ZS, torsoR, torsoXS, WAIST_Y } from "./shapes.ts";
import { skirtPoint, targetsFor, topY, type Targets } from "./garmentShape.ts";
import { usePartMaterials, usePattern } from "./materials.ts";

const SK_ROWS = 30, SK_COLS = 72;
const BD_ROWS = 18, BD_COLS = 72;

export const DEFAULT_COLOR = "#B9A3F0";

/** Clothing on a stylized dress form. Every spec change morphs over ~400 ms instead of popping. */
export function Garment({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const target = targetsFor(spec);
  const t = useRef(target);
  t.current = target;
  const a = useRef<Targets>({ ...target });
  const dirty = useRef(true);
  const color = useMemo(() => new THREE.Color(), []);
  color.set(spec.color ?? DEFAULT_COLOR);
  // Per-part scale and visibility, eased like everything else (1 = default, 0 = hidden).
  const specRef = useRef(spec);
  specRef.current = spec;
  const partTarget = (name: string) => {
    const p = specRef.current.parts?.[name];
    return p?.hidden ? 0 : p?.scale ?? 1;
  };
  const ps = useRef<Record<string, number>>({ skirt: 1, bodice: 1, sleeves: 1, pockets: 1, seam: 1 });

  const skirtGeo = useMemo(() => makeWrapGrid(SK_ROWS, SK_COLS), []);
  const bodiceGeo = useMemo(() => makeWrapGrid(BD_ROWS, BD_COLS), []);
  const sleeveGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 0.86, 1, 28, 1, true);
    g.translate(0, -0.5, 0);
    return g;
  }, []);
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: spec.color ?? DEFAULT_COLOR, side: THREE.DoubleSide, sheenColor: new THREE.Color("#ffffff") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const pocketMat = useMemo(() => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), []);
  const seamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.7), toneMapped: false, transparent: true }), []);
  usePattern(mat, spec.pattern);
  const part = usePartMaterials(spec);

  const bodiceGroup = useRef<THREE.Group>(null);
  const skirtMesh = useRef<THREE.Mesh>(null);
  const bodiceMesh = useRef<THREE.Mesh>(null);
  const sleeves = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const pockets = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const seam = useRef<THREE.Mesh>(null);
  const showSkirt = spec.category !== "top";
  const showBodice = spec.category !== "skirt";
  const tmp = useMemo(() => [0, 0, 1, 1], []);

  useFrame((state, dt) => {
    const k = morphK(dt);
    const cur = a.current, tgt = t.current;
    let moving = dirty.current;
    for (const key of Object.keys(tgt) as (keyof Targets)[]) {
      const d = tgt[key] - cur[key];
      if (Math.abs(d) > 1e-4) {
        cur[key] += d * k;
        moving = true;
      } else cur[key] = tgt[key];
    }
    const P = ps.current;
    for (const name of Object.keys(P)) {
      const d = partTarget(name) - P[name];
      if (Math.abs(d) > 1e-4) {
        P[name] += d * k;
        if (name === "skirt") moving = true;
      } else P[name] = partTarget(name);
    }
    mat.color.lerp(color, k);
    mat.roughness = cur.roughness;
    mat.metalness = cur.metalness;
    mat.sheen = cur.sheen;
    mat.sheenRoughness = cur.sheenRoughness;
    mat.clearcoat = cur.clearcoat;
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = 0.04 + cur.glow + flash.current * 0.9;
    pocketMat.color.copy(mat.color).multiplyScalar(0.62);
    pocketMat.emissive.copy(mat.color);
    pocketMat.emissiveIntensity = mat.emissiveIntensity;

    const time = state.clock.elapsedTime;
    const sway = Math.sin(time * 0.9) * 0.8;
    if (cur.wFl > 0.01 || cur.wA > 0.01) moving = true; // the hem sways gently
    // A bigger skirt is a fuller one: it flares more below the hips while the waist stays put.
    const fuller = (y: number) => 1 + (Math.max(0.3, P.skirt) - 1) * smooth(WAIST_Y, HIP_Y - 0.2, y);

    if (moving) {
      dirty.current = false;
      if (showSkirt) {
        fillWrapGrid(skirtGeo, SK_ROWS, SK_COLS, (i, th, out) => {
          const s = i / SK_ROWS;
          const hem = cur.hem + cur.wW * 0.07 * Math.sin(th - 0.9);
          const y = WAIST_Y + (hem - WAIST_Y) * s;
          skirtPoint(y, th, cur, sway, out);
          out[0] *= fuller(y);
        });
      }
      if (showBodice) {
        fillWrapGrid(bodiceGeo, BD_ROWS, BD_COLS, (i, th, out) => {
          const s = i / BD_ROWS;
          const y = cur.bodiceBottom + (topY(th, cur) - cur.bodiceBottom) * s;
          const flare = spec.category === "top" ? 0.03 * (1 - s) ** 2 : 0;
          out[0] = torsoR(y) + 0.011 + flare + 0.008 * smooth(1.56, 1.62, y);
          out[1] = y;
          out[2] = torsoXS(y);
          out[3] = TORSO_ZS + 0.02;
        });
      }
    }
    if (skirtMesh.current) skirtMesh.current.visible = P.skirt > 0.02;
    if (bodiceMesh.current) bodiceMesh.current.visible = P.bodice > 0.02;

    // Sleeves hang from the shoulders and grow or shrink with the spec. Off-shoulder drops them a little.
    sleeves.forEach((ref, n) => {
      const g = ref.current;
      if (!g) return;
      g.visible = showBodice && cur.sleeveL > 0.006 && P.sleeves > 0.02;
      const r = cur.sleeveR * Math.max(0.0001, P.sleeves);
      g.scale.set(r, Math.max(0.001, cur.sleeveL), r * 0.92);
      g.rotation.z = (n === 0 ? -1 : 1) * (0.3 - cur.sleeveL * 0.12 + cur.nOff * 0.25);
      g.position.y = -cur.nOff * 0.04;
    });

    // Pockets sit on the skirt surface, tilted with its flare. One has a phone peeking out.
    const py = Math.max(cur.hem + 0.12, 0.84);
    pockets.forEach((ref, n) => {
      const g = ref.current;
      if (!g) return;
      g.visible = showSkirt && cur.pockets > 0.01 && P.pockets > 0.02;
      const th = n === 0 ? -0.95 : 0.95;
      skirtPoint(py, th, cur, sway, tmp);
      const r = (tmp[0] + 0.004) * fuller(py);
      g.position.set(Math.sin(th) * r, py, Math.cos(th) * r * tmp[3]);
      g.rotation.set(-Math.atan(0.3 * cur.wA + 0.56 * cur.wFl + 0.26 * cur.wW - 0.05 * cur.wF) * 0.8, th, 0, "YXZ");
      g.scale.setScalar(Math.max(0.0001, cur.pockets * P.pockets));
    });

    // Convertible seam: a glowing line at the waist that periodically opens.
    const phase = (time % 5) / 5;
    const apart = Math.pow(Math.sin(phase * Math.PI), 6) * cur.seam;
    if (bodiceGroup.current) bodiceGroup.current.position.y = apart * 0.06;
    if (seam.current) {
      seam.current.visible = cur.seam > 0.01 && P.seam > 0.02;
      seam.current.scale.set(1, 1, Math.max(0.2, P.seam)).multiplyScalar(0.98 + cur.seam * 0.02);
      seam.current.position.y = WAIST_Y + apart * 0.03;
      seamMat.opacity = cur.seam * (0.65 + apart * 0.35);
      const seamColor = specRef.current.parts?.seam?.color;
      if (seamColor) seamMat.color.set(seamColor).multiplyScalar(2);
      else seamMat.color.setRGB(2.4, 1.8, 0.7);
    }
    flash.current = Math.max(0, flash.current - dt * 1.8);
  });

  return (
    <group>
      {showSkirt && <mesh ref={skirtMesh} geometry={skirtGeo} material={part("skirt", mat)} castShadow />}
      <group ref={bodiceGroup}>
        {showBodice && <mesh ref={bodiceMesh} geometry={bodiceGeo} material={part("bodice", mat)} castShadow />}
        {[0, 1].map((n) => (
          <group key={n} position={[n === 0 ? -0.18 : 0.18, 1.47, 0]}>
            <group ref={sleeves[n]}>
              <mesh geometry={sleeveGeo} material={part("sleeves", mat)} />
            </group>
          </group>
        ))}
      </group>
      {[0, 1].map((n) => (
        <group key={n} ref={pockets[n]}>
          <mesh material={part("pockets", pocketMat)}>
            <planeGeometry args={[0.12, 0.13]} />
          </mesh>
          {n === 0 && (
            <group position={[0.01, 0.075, -0.006]}>
              <mesh>
                <boxGeometry args={[0.062, 0.11, 0.008]} />
                <meshStandardMaterial color="#20202a" roughness={0.3} metalness={0.4} />
              </mesh>
              <mesh position={[0, 0.005, 0.0045]}>
                <planeGeometry args={[0.05, 0.09]} />
                <meshBasicMaterial color={new THREE.Color(0.25, 0.55, 0.5)} toneMapped={false} />
              </mesh>
            </group>
          )}
        </group>
      ))}
      <mesh ref={seam} material={seamMat} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]}>
        <torusGeometry args={[0.172, 0.006, 8, 96]} />
      </mesh>
    </group>
  );
}

/** Smooth faceless dress form on a pole. */
export function Mannequin() {
  const geo = useMemo(() => {
    const rows = 40, cols = 48;
    const g = makeWrapGrid(rows, cols);
    fillWrapGrid(g, rows, cols, (i, _th, out) => {
      const y = 0.8 + (1.62 - 0.8) * (i / rows);
      out[0] = torsoR(y);
      out[1] = y;
      out[2] = torsoXS(y);
      out[3] = TORSO_ZS;
    });
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#ebe5f8", roughness: 0.55, sheen: 0.4, emissive: "#b9a3f0", emissiveIntensity: 0.05 }), []);
  return (
    <group>
      <mesh geometry={geo} material={mat} />
      <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat} scale={[1, TORSO_ZS, 1]}>
        <circleGeometry args={[0.18, 48]} />
      </mesh>
      <mesh position={[0, 1.66, 0]} material={mat}>
        <cylinderGeometry args={[0.048, 0.052, 0.08, 24]} />
      </mesh>
      <mesh position={[0, 1.78, 0]} material={mat} scale={[1, 1.18, 1]}>
        <sphereGeometry args={[0.095, 32, 24]} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 0.7, 12]} />
        <meshStandardMaterial color="#d8c88f" metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}
