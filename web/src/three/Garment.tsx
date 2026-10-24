import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ProductSpec } from "@wishit/shared";
import {
  FABRIC_LOOK, fillWrapGrid, HEM_Y, HIP_Y, makeWrapGrid, morphK, patternTexture, smooth,
  TORSO_ZS, torsoR, torsoXS, WAIST_Y,
} from "./shapes.ts";

const SK_ROWS = 30, SK_COLS = 72;
const BD_ROWS = 18, BD_COLS = 72;

interface Targets {
  hem: number; wF: number; wA: number; wW: number; wFl: number;
  nCrew: number; nV: number; nSq: number; nH: number;
  sleeveL: number; sleeveR: number; bodiceBottom: number;
  roughness: number; sheen: number; sheenRoughness: number; clearcoat: number;
  pockets: number; seam: number;
}

export const DEFAULT_COLOR = "#DCC7A2";

function targetsFor(spec: ProductSpec): Targets {
  const cat = spec.category;
  const len = spec.length ?? "midi";
  const sil = spec.silhouette ?? "a_line";
  const neck = spec.neckline ?? "crew";
  const sleeves = spec.sleeves ?? (cat === "top" ? "short" : "none");
  const look = FABRIC_LOOK[spec.fabric ?? "cotton"];
  const f = spec.features ?? [];
  return {
    hem: HEM_Y[len],
    wF: sil === "fitted" ? 1 : 0, wA: sil === "a_line" ? 1 : 0, wW: sil === "wrap" ? 1 : 0, wFl: sil === "flowy" ? 1 : 0,
    nCrew: neck === "crew" ? 1 : 0, nV: neck === "v" ? 1 : 0, nSq: neck === "square" ? 1 : 0, nH: neck === "halter" ? 1 : 0,
    sleeveL: { none: 0, cap: 0.085, short: 0.21, long: 0.62 }[sleeves],
    sleeveR: sleeves === "cap" ? 0.078 : 0.062,
    bodiceBottom: cat === "top" ? 0.86 : WAIST_Y - 0.02,
    ...look,
    pockets: f.includes("phone_pockets") && cat !== "top" ? 1 : 0,
    seam: f.includes("converts_to_skirt") && cat === "dress" ? 1 : 0,
  };
}

/** Neckline height around the body; theta = 0 is the front. Weights blend so necklines morph. */
function topY(th: number, a: Targets) {
  const ath = Math.abs(th);
  const crew = 1.555 - 0.035 * Math.max(0, Math.cos(th)) ** 4;
  const v = 1.555 - 0.21 * Math.max(0, 1 - ath / 0.55);
  const sq = 1.555 - 0.13 * (1 - smooth(0.55, 0.75, ath));
  const halter = ath < 0.32 ? 1.575 : 1.575 - 0.2 * smooth(0.32, 0.7, ath) - 0.1 * smooth(1.8, 2.6, ath);
  const sum = a.nCrew + a.nV + a.nSq + a.nH || 1;
  return (crew * a.nCrew + v * a.nV + sq * a.nSq + halter * a.nH) / sum;
}

function skirtPoint(y: number, th: number, a: Targets, sway: number, out: number[]) {
  const rHip = 0.235 + a.wFl * 0.015 + a.wA * 0.005;
  let r: number;
  let zs: number;
  if (y > HIP_Y) {
    r = 0.168 + (rHip - 0.168) * smooth(WAIST_Y, HIP_Y, y);
    zs = TORSO_ZS + 0.04;
  } else {
    const dy = HIP_Y - y;
    const slope = a.wF * -0.05 + a.wA * 0.3 + a.wW * 0.26 + a.wFl * 0.56;
    r = rHip + dy * slope;
    const depth = Math.min(1, dy / 0.45);
    r += (a.wFl * 0.042 + a.wA * 0.006 + a.wW * 0.01) * depth * Math.sin(th * 9 + sway * (0.4 + a.wFl));
    r += a.wW * 0.014 * Math.max(0, Math.sin(th + 0.5));
    zs = TORSO_ZS + 0.04 + 0.16 * Math.min(1, dy / 0.5);
  }
  out[0] = r;
  out[1] = y;
  out[2] = 1;
  out[3] = zs;
}

/** Clothing on a stylized dress form. Every spec change morphs over ~400 ms instead of popping. */
export function Garment({ spec, flash }: { spec: ProductSpec; flash: MutableRefObject<number> }) {
  const target = targetsFor(spec);
  const t = useRef(target);
  t.current = target;
  const a = useRef<Targets>({ ...target });
  const dirty = useRef(true);
  const color = useMemo(() => new THREE.Color(), []);
  color.set(spec.color ?? DEFAULT_COLOR);

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

  useEffect(() => {
    mat.map = spec.pattern && spec.pattern !== "solid" ? patternTexture(spec.pattern) : null;
    mat.needsUpdate = true;
  }, [spec.pattern, mat]);

  const bodiceGroup = useRef<THREE.Group>(null);
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
    mat.color.lerp(color, k);
    mat.roughness = cur.roughness;
    mat.sheen = cur.sheen;
    mat.sheenRoughness = cur.sheenRoughness;
    mat.clearcoat = cur.clearcoat;
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = 0.04 + flash.current * 0.9;
    pocketMat.color.copy(mat.color).multiplyScalar(0.62);
    pocketMat.emissive.copy(mat.color);
    pocketMat.emissiveIntensity = mat.emissiveIntensity;

    const time = state.clock.elapsedTime;
    const sway = Math.sin(time * 0.9) * 0.8;
    if (cur.wFl > 0.01 || cur.wA > 0.01) moving = true; // the hem sways gently

    if (moving) {
      dirty.current = false;
      if (showSkirt) {
        fillWrapGrid(skirtGeo, SK_ROWS, SK_COLS, (i, th, out) => {
          const s = i / SK_ROWS;
          const hem = cur.hem + cur.wW * 0.07 * Math.sin(th - 0.9);
          const y = WAIST_Y + (hem - WAIST_Y) * s;
          skirtPoint(y, th, cur, sway, out);
        });
      }
      if (showBodice) {
        fillWrapGrid(bodiceGeo, BD_ROWS, BD_COLS, (i, th, out) => {
          const s = i / BD_ROWS;
          const y = cur.bodiceBottom + (topY(th, cur) - cur.bodiceBottom) * s;
          const flare = spec.category === "top" ? 0.03 * (1 - s) ** 2 : 0;
          out[0] = torsoR(y) + 0.011 + flare;
          out[1] = y;
          out[2] = torsoXS(y);
          out[3] = TORSO_ZS + 0.02;
        });
      }
    }

    // Sleeves hang from the shoulders and grow or shrink with the spec.
    sleeves.forEach((ref, n) => {
      const g = ref.current;
      if (!g) return;
      g.visible = showBodice && cur.sleeveL > 0.006;
      g.scale.set(cur.sleeveR, Math.max(0.001, cur.sleeveL), cur.sleeveR * 0.92);
      g.rotation.z = (n === 0 ? -1 : 1) * (0.3 - cur.sleeveL * 0.12);
    });

    // Pockets sit on the skirt surface, tilted with its flare. One has a phone peeking out.
    const py = Math.max(cur.hem + 0.12, 0.84);
    pockets.forEach((ref, n) => {
      const g = ref.current;
      if (!g) return;
      g.visible = showSkirt && cur.pockets > 0.01;
      const th = n === 0 ? -0.95 : 0.95;
      skirtPoint(py, th, cur, sway, tmp);
      const r = tmp[0] + 0.004;
      g.position.set(Math.sin(th) * r, py, Math.cos(th) * r * tmp[3]);
      g.rotation.set(-Math.atan(0.3 * cur.wA + 0.56 * cur.wFl + 0.26 * cur.wW - 0.05 * cur.wF) * 0.8, th, 0, "YXZ");
      g.scale.setScalar(cur.pockets);
    });

    // Convertible seam: a glowing line at the waist that periodically opens.
    const phase = (time % 5) / 5;
    const apart = Math.pow(Math.sin(phase * Math.PI), 6) * cur.seam;
    if (bodiceGroup.current) bodiceGroup.current.position.y = apart * 0.06;
    if (seam.current) {
      seam.current.visible = cur.seam > 0.01;
      seam.current.scale.set(1, 1, 1).multiplyScalar(0.98 + cur.seam * 0.02);
      seam.current.position.y = WAIST_Y + apart * 0.03;
      seamMat.opacity = cur.seam * (0.65 + apart * 0.35);
    }
    flash.current = Math.max(0, flash.current - dt * 1.8);
  });

  return (
    <group>
      {showSkirt && <mesh geometry={skirtGeo} material={mat} castShadow />}
      <group ref={bodiceGroup}>
        {showBodice && <mesh geometry={bodiceGeo} material={mat} castShadow />}
        {[0, 1].map((n) => (
          <group key={n} position={[n === 0 ? -0.18 : 0.18, 1.47, 0]}>
            <group ref={sleeves[n]}>
              <mesh geometry={sleeveGeo} material={mat} />
            </group>
          </group>
        ))}
      </group>
      {[0, 1].map((n) => (
        <group key={n} ref={pockets[n]}>
          <mesh material={pocketMat}>
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
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#F4F1EA", roughness: 0.55, sheen: 0.4, emissive: "#C5D8CF", emissiveIntensity: 0.05 }), []);
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
