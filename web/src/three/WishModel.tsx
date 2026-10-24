import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { CLOTHING, type Category, type ProductSpec, type SpecField } from "@wishit/shared";
import { Garment, Mannequin } from "./Garment.tsx";
import { Backpack, Helmet } from "./Products.tsx";
import { Orb, ORB_R, ORB_Y } from "./Orb.tsx";
import { fx, type Bounds } from "./signals.ts";
import { HEM_Y } from "./shapes.ts";

type Kind = Exclude<Category, "generic"> | "orb" | "hero";

const BOUNDS: Record<Kind, Bounds> = {
  dress: { y0: 0.35, y1: 1.58, r: 0.27 },
  top: { y0: 0.86, y1: 1.58, r: 0.24 },
  skirt: { y0: 0.38, y1: 1.18, r: 0.3 },
  backpack: { y0: 0.6, y1: 1.42, r: 0.36 },
  helmet: { y0: 0.82, y1: 1.32, r: 0.38 },
  orb: { y0: ORB_Y - ORB_R, y1: ORB_Y + ORB_R, r: ORB_R },
  hero: { y0: 0.15, y1: 1.6, r: 0.4 },
};

function regionFor(field: SpecField, spec: ProductSpec, kind: Kind): Bounds {
  const whole = BOUNDS[kind];
  if (!CLOTHING.includes(spec.category)) {
    if (field === "features") return kind === "backpack" ? { y0: 1.05, y1: 1.45, r: 0.36 } : { y0: 0.85, y1: 1.15, r: 0.42 };
    return whole;
  }
  const hem = HEM_Y[spec.length ?? "midi"];
  switch (field) {
    case "length":
    case "silhouette":
      return { y0: hem - 0.02, y1: hem + 0.3, r: 0.36 };
    case "sleeves":
      return { y0: 1.2, y1: 1.55, r: 0.3 };
    case "neckline":
      return { y0: 1.38, y1: 1.6, r: 0.16 };
    case "features":
      return { y0: 0.78, y1: 1.2, r: 0.3 };
    default:
      return whole;
  }
}

const VISUAL_FIELDS: SpecField[] = ["category", "length", "silhouette", "sleeves", "neckline", "color", "fabric", "pattern", "features"];
const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

class GlbBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[3d] hero model failed to load, keeping the parametric model", err);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Hero({ url, onReady }: { url: string; onReady: () => void }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => {
    const s = scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.45 / Math.max(size.y, size.x * 0.9, size.z * 0.9, 0.001);
    s.scale.setScalar(scale);
    box.setFromObject(s);
    const c = box.getCenter(new THREE.Vector3());
    s.position.set(-c.x, 0.12 - box.min.y, -c.z);
    s.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "envMapIntensity" in m) m.envMapIntensity = 1.2;
    });
    const g = new THREE.Group();
    g.add(s);
    return g;
  }, [scene]);
  useEffect(() => onReady(), [obj, onReady]);
  return <primitive object={obj} />;
}

function Pedestal() {
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const glowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useFrame((s) => {
    if (ring.current) ring.current.color.setRGB(0.95, 0.85 + Math.sin(s.clock.elapsedTime * 1.5) * 0.06, 0.54);
  });
  return (
    <group>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.56, 0.62, 0.1, 64]} />
        <meshPhysicalMaterial color="#FFFFFF" roughness={0.3} metalness={0} clearcoat={1} emissive="#F2D88A" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 0.101, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.53, 96]} />
        <meshBasicMaterial ref={ring} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.6, 2.6]} />
        <meshBasicMaterial map={glowTex} color="#F2D88A" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}

export interface WishModelProps {
  spec: ProductSpec;
  heroUrl?: string | null;
  /** Increment to trigger the goal-hit spin. */
  celebrateKey?: number;
  pedestal?: boolean;
  /** Show the 3D wish orb for a generic wish. Off when a CSS bubble already plays that role. */
  orb?: boolean;
}

/**
 * The product on its pedestal. Instant parametric model per category, a wish orb for anything
 * else, and an optional Meshy GLB that dissolves in when it arrives.
 */
export function WishModel({ spec, heroUrl, celebrateKey = 0, pedestal = true, orb = true }: WishModelProps) {
  const [heroReady, setHeroReady] = useState<{ url: string; look: string } | null>(null);
  const [heroFailed, setHeroFailed] = useState<string | null>(null);
  const look = JSON.stringify(VISUAL_FIELDS.map((f) => spec[f]));
  // The GLB is a snapshot of the locked spec: a later voice edit falls back to the live parametric model.
  const useHero = !!heroUrl && heroReady?.url === heroUrl && heroReady.look === look && heroFailed !== heroUrl;
  const targetKind: Kind = useHero ? "hero" : spec.category === "generic" ? "orb" : spec.category;
  const [shown, setShown] = useState<Kind>(targetKind);
  const targetRef = useRef(targetKind);
  targetRef.current = targetKind;
  const appear = useRef(0);
  const swapping = useRef(false);
  const flash = useRef(0);
  const scaleGroup = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const spinBoost = useRef(0);
  const prevSpec = useRef<ProductSpec | null>(null);
  const accent = spec.color ?? "#C5D8CF";

  // First appearance: particles swirl up from below (the mic) and assemble into the product.
  useEffect(() => {
    if (shown !== "orb") fx.assemble([0, 0.2, 0.9], BOUNDS[shown], 420, accent, 0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shimmer along whatever changed (only when the kind stays the same; kind swaps get the swirl).
  useEffect(() => {
    const prev = prevSpec.current;
    prevSpec.current = spec;
    if (!prev || prev.category !== spec.category || shown === "orb") return;
    const changed = VISUAL_FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(spec[f]));
    if (!changed.length) return;
    flash.current = 1;
    const seen = new Set<string>();
    for (const f of changed) {
      const b = regionFor(f, spec, shown);
      const key = `${b.y0}:${b.y1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fx.band(b, 160, "#E9C46A");
      fx.band(b, 90, accent);
    }
  }, [spec, shown, accent]);

  useEffect(() => {
    if (celebrateKey > 0) spinBoost.current = 9;
  }, [celebrateKey]);

  useFrame((_s, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = targetRef.current;
    if (target !== shown && !swapping.current) {
      if (shown === "orb") {
        // The orb bursts into particles that assemble into the product in the same spot.
        fx.burst([0, ORB_Y, 0], 260, "#F4A8C8", 1.4);
        fx.assemble([0, ORB_Y, 0], BOUNDS[target], 520, accent, 0.85);
        swapping.current = true;
        appear.current = 0;
        setShown(target);
      } else {
        appear.current -= dt * 5;
        if (appear.current <= 0) {
          fx.band(BOUNDS[shown], 260, accent);
          if (target !== "orb") fx.assemble([0, 1.0, 0], BOUNDS[target], 480, target === "hero" ? "#E9C46A" : accent, 0.9);
          swapping.current = true;
          appear.current = 0;
          setShown(target);
        }
      }
    } else if (target === shown) {
      swapping.current = false;
      if (appear.current < 1) appear.current = Math.min(1, appear.current + dt * 1.5);
    }
    if (scaleGroup.current) {
      const s = shown === "orb" ? 1 : Math.max(0.0001, easeOutBack(Math.max(0, appear.current)));
      scaleGroup.current.scale.setScalar(s);
    }
    if (spin.current) {
      spinBoost.current *= Math.pow(0.45, dt);
      spin.current.rotation.y += dt * (0.22 + spinBoost.current);
    }
  });

  const clothing = shown === "dress" || shown === "top" || shown === "skirt";
  return (
    <group ref={spin}>
      {pedestal && <Pedestal />}
      {orb && <Orb visible={shown === "orb" && targetKind === "orb"} />}
      <group ref={scaleGroup}>
        {clothing && <Mannequin />}
        {clothing && <Garment key={shown} spec={spec} flash={flash} />}
        {shown === "backpack" && <Backpack spec={spec} flash={flash} />}
        {shown === "helmet" && <Helmet spec={spec} flash={flash} />}
        {heroUrl && heroFailed !== heroUrl && (
          <group visible={shown === "hero"}>
            <GlbBoundary key={heroUrl} onError={() => setHeroFailed(heroUrl)}>
              <Suspense fallback={null}>
                <Hero url={heroUrl} onReady={() => setHeroReady((r) => (r?.url === heroUrl ? r : { url: heroUrl, look }))} />
              </Suspense>
            </GlbBoundary>
          </group>
        )}
      </group>
    </group>
  );
}
