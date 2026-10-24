import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StudioEnvironment } from "./StudioEnv.tsx";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, ContactShadows, MeshReflectorMaterial, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Part, Product } from "@wishit/shared";
import { Particles } from "./Particles.tsx";
import { anchorSignal, fx, orbSignal, viewSignal } from "./signals.ts";
import { ProductView, PartRegistry, type PartHit } from "./parts/ProductView.tsx";
import { createMaterial, preloadMaterials } from "./parts/materials.ts";
import { preloadMeshModels } from "./parts/mesh.ts";
import { MATERIAL_PRESETS } from "@wishit/shared";

export type Framing = "voice" | "product" | "top" | "side" | "mini" | "bubble" | "debug" | "edit";

/** x/y shift the rendered view (fraction of the canvas), d is camera distance. */
const FRAMES: Record<Framing, { x: number; y: number; d: number }> = {
  voice: { x: 0, y: 0.1, d: 4.6 },
  product: { x: 0, y: 0.17, d: 5.5 },
  top: { x: 0, y: 0.27, d: 7.2 },
  side: { x: 0.2, y: 0.04, d: 4.6 },
  mini: { x: 0, y: 0.02, d: 4.3 },
  bubble: { x: 0, y: 0.03, d: 4.7 },
  debug: { x: 0, y: 0, d: 4.2 },
  edit: { x: 0, y: 0.0, d: 4.4 },
};
const FLOOR_Y = 0.105;
/** Post effects, overridable with ?fx=ao,bloom,smaa for A/B checks. */
const FX = new Set((new URLSearchParams(location.search).get("fx") ?? "ao,bloom,smaa,reflect").split(","));
const FIT = 1.25;
const TARGET = new THREE.Vector3(0, FLOOR_Y + FIT * 0.48, 0);

/** Shifts the projection (view offset) so the product can sit off-center for some layouts. */
function ViewOffset({ framing }: { framing: Framing }) {
  const cur = useRef({ ...FRAMES[framing] });
  useFrame(({ camera, size }, dt) => {
    let f = FRAMES[framing];
    if ((framing === "side" || framing === "top") && size.width < 820) f = { x: 0, y: 0.3, d: f.d };
    const k = 1 - Math.exp(-dt * 4);
    cur.current.x += (f.x - cur.current.x) * k;
    cur.current.y += (f.y - cur.current.y) * k;
    const cam = camera as THREE.PerspectiveCamera;
    cam.setViewOffset(size.width, size.height, cur.current.x * size.width, cur.current.y * size.height, size.width, size.height);
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Camera: orbit with damping, zoom-to-part on selection, back to the full view on deselect.
 * A small minimum box keeps tiny parts (a screw) from filling the whole screen.
 */
function CameraRig({ framing, focusId, registry, interactive, focusKey }: { framing: Framing; focusId: string | null; registry: PartRegistry; interactive: boolean; focusKey: number }) {
  const controls = useRef<CameraControls>(null);
  const d = FRAMES[framing].d;
  const seen = useRef(-1);
  const home = useRef({ y: TARGET.y, d, polar: 1.15 });
  // Spoken camera commands ("show me the back", "zoom in").
  const seenView = useRef(viewSignal.version);
  useFrame(() => {
    const c = controls.current;
    if (!c || viewSignal.version === seenView.current) return;
    seenView.current = viewSignal.version;
    const az: Record<string, number> = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
    const cmd = viewSignal.command;
    if (cmd && cmd in az) {
      void c.rotateTo(az[cmd], 1.2, true);
    } else if (cmd === "top") void c.rotatePolarTo(0.3, true);
    else if (cmd === "bottom") void c.rotatePolarTo(1.9, true);
    else if (cmd === "zoom_in") void c.dolly(home.current.d * 0.3, true);
    else if (cmd === "zoom_out") void c.dolly(-home.current.d * 0.3, true);
    else if (cmd === "reset") {
      void c.moveTo(0, home.current.y, 0, true);
      void c.dollyTo(home.current.d, true);
      void c.rotateTo(-0.55, home.current.polar, true);
    }
  });

  // Frame the whole product whenever its fitted size changes (and nothing is selected).
  useFrame(() => {
    const c = controls.current;
    if (!c || registry.fit.version === seen.current) return;
    seen.current = registry.fit.version;
    const { height: h, width: w } = registry.fit;
    if (!h) return;
    const margin = framing === "bubble" ? 1.42 : 1.5;
    const k = margin / (2 * Math.tan((34 / 2) * (Math.PI / 180)));
    // Flat, wide things are seen best from higher up; tall things closer to eye level.
    const aspect = Math.min(1.6, h / Math.max(w, 1e-3));
    const polar = THREE.MathUtils.lerp(0.92, 1.24, aspect / 1.6);
    home.current = { y: FLOOR_Y + h * 0.46, d: Math.max((h + 0.25) * k, (w + 0.35) * k * 0.86, 2.2), polar };
    if (!focusId) {
      void c.moveTo(0, home.current.y, 0, true);
      void c.dollyTo(home.current.d, true);
      void c.rotatePolarTo(polar, true);
    }
  });
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (focusId) {
      // Let the part settle (pop-in springs) before measuring it.
      const t = setTimeout(() => {
        const box = registry.worldBox(focusId);
        if (!box || box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const min = 0.58;
        const grown = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(Math.max(size.x, min), Math.max(size.y, min), Math.max(size.z, min)));
        void c.fitToBox(grown, true, { paddingTop: 0.16, paddingBottom: 0.16, paddingLeft: 0.16, paddingRight: 0.16 });
      }, 30);
      return () => clearTimeout(t);
    }
    void c.moveTo(0, home.current.y, 0, true);
    void c.dollyTo(home.current.d, true);
    void c.rotatePolarTo(home.current.polar, true);
  }, [focusId, focusKey, d, registry]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      enabled={interactive}
      minDistance={0.6}
      maxDistance={9}
      minPolarAngle={0.25}
      maxPolarAngle={1.95}
      smoothTime={0.32}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
      truckSpeed={0}
    />
  );
}

/** Spins the product slowly when nobody is touching it. */
function Turntable({ children, paused, celebrateKey }: { children: React.ReactNode; paused: boolean; celebrateKey: number }) {
  const g = useRef<THREE.Group>(null);
  const idle = useRef(0);
  const speed = useRef(0);
  const boost = useRef(0);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const touch = () => (idle.current = 0);
    el.addEventListener("pointerdown", touch);
    el.addEventListener("wheel", touch, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", touch);
      el.removeEventListener("wheel", touch);
    };
  }, [gl]);
  useEffect(() => {
    if (celebrateKey > 0) boost.current = 9;
  }, [celebrateKey]);
  const seenSpin = useRef(viewSignal.version);
  useFrame((_s, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    idle.current += dt;
    const want = paused || idle.current < 6 ? 0 : 0.22;
    speed.current += (want - speed.current) * (1 - Math.exp(-dt * 1.5));
    if (viewSignal.version !== seenSpin.current) {
      seenSpin.current = viewSignal.version;
      if (viewSignal.command === "spin") boost.current = 7;
    }
    boost.current *= Math.pow(0.45, dt);
    if (g.current) g.current.rotation.y += dt * (speed.current + boost.current);
  });
  return <group ref={g}>{children}</group>;
}

function Pedestal({ reflect }: { reflect: boolean }) {
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => {
    if (ring.current) ring.current.color.setRGB(1.1, 0.95 + Math.sin(s.clock.elapsedTime * 1.5) * 0.06, 0.62);
  });
  return (
    <group>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.62, 0.68, 0.1, 96]} />
        <meshPhysicalMaterial color="#EFE9DF" roughness={0.42} metalness={0} clearcoat={0.6} clearcoatRoughness={0.3} envMapIntensity={0.7} />
      </mesh>
      <mesh position={[0, FLOOR_Y - 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.575, 0.6, 128]} />
        <meshBasicMaterial ref={ring} toneMapped={false} />
      </mesh>
      {reflect && (
        // A softly blurred reflection of the product in the glossy pedestal top.
        <mesh position={[0, FLOOR_Y - 0.0004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.572, 96]} />
          <MeshReflectorMaterial
            mirror={0}
            blur={[300, 100]}
            resolution={512}
            mixBlur={1}
            mixStrength={0.55}
            mixContrast={1}
            depthScale={1.2}
            minDepthThreshold={0.2}
            maxDepthThreshold={0.9}
            roughness={0.7}
            metalness={0}
            color="#F1EBE1"
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * drei's ContactShadows relies on renderer.autoClear, which the post-processing composer turns
 * off; without it the shadow buffer accumulates ghosts. The composer clears its own buffers, so
 * keeping it on is safe.
 */
function AutoClear() {
  const gl = useThree((st) => st.gl);
  useFrame(() => {
    gl.autoClear = true;
  });
  return null;
}

/** Soft cream-to-mist gradient as the scene background (not a mesh, so shadows never see it). */
function Backdrop() {
  const scene = useThree((st) => st.scene);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#FFFFFF");
    grad.addColorStop(0.55, "#FFFCF7");
    grad.addColorStop(1, "#EEF4F1");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene]);
  return null;
}

/**
 * Studio light, product-photography style: HDRI for reflections, a soft key from the upper left that
 * casts real shadows between parts, a cool rim from behind to separate the silhouette, low fill.
 */
function Lighting() {
  return (
    <>
      <Suspense fallback={null}>
        <StudioEnvironment />
      </Suspense>
      <directionalLight
        position={[-1.8, 3.4, 2.4]}
        intensity={2.1}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.01}
        shadow-radius={8}
        shadow-camera-left={-1.1}
        shadow-camera-right={1.1}
        shadow-camera-top={1.8}
        shadow-camera-bottom={-0.3}
        shadow-camera-near={0.5}
        shadow-camera-far={9}
      />
      <directionalLight position={[2.2, 1.6, -2.6]} intensity={1.1} color="#e6f0ff" />
      <directionalLight position={[2.4, 0.8, 2.0]} intensity={0.35} color="#ffe9f2" />
    </>
  );
}

/** While the genie works, gold and pink motes spiral in toward the product (instant feedback). */
function Conjure({ registry }: { registry: PartRegistry }) {
  const acc = useRef(0);
  const n = useRef(0);
  useFrame((_s, dt) => {
    if (orbSignal.state !== "thinking") return;
    acc.current += dt;
    if (acc.current < 0.09) return;
    acc.current = 0;
    const h = registry.fit.height || 0.9;
    const y = FLOOR_Y + h * (0.25 + 0.5 * Math.random());
    fx.inward([0, y, 0], 0.55 + h * 0.25, 7, n.current++ % 2 ? "#F2D88A" : "#F4A8C8");
  });
  return null;
}

/** Projects the selected part's tap point to screen space for the DOM genie bubble. */
function AnchorTracker({ registry, anchor }: { registry: PartRegistry; anchor?: { partId: string; point: [number, number, number] } | null }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    anchorSignal.width = size.width;
    anchorSignal.height = size.height;
    const g = anchor ? registry.groups.get(anchor.partId) : undefined;
    if (!anchor || !g) {
      anchorSignal.visible = false;
      return;
    }
    v.set(...anchor.point).applyMatrix4(g.matrixWorld).project(camera);
    anchorSignal.visible = v.z < 1;
    anchorSignal.x = ((v.x + 1) / 2) * size.width;
    anchorSignal.y = ((1 - v.y) / 2) * size.height;
  });
  return null;
}

/**
 * Compile every material preset's shader once textures are in, off-screen, so the first product
 * (and the first preset swap) doesn't hitch while the GPU builds programs.
 */
const warmMaterials: THREE.Material[] = [];
function ShaderWarmup() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let cancelled = false;
    void preloadMaterials().then(async () => {
      if (cancelled) return;
      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(0.01, 8, 6);
      const mats = MATERIAL_PRESETS.flatMap((preset) => [
        createMaterial({ preset, color: "#888888" }),
        createMaterial({ preset, color: "#888888", emissive: "#ffaa55", emissiveIntensity: 1 }),
      ]);
      for (const m of mats) {
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.set(0, -50, 0);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      if (gl.getContext().isContextLost()) return;
      scene.add(group);
      try {
        // Only the warm-up group (with the scene's lights): product materials may recompile meanwhile,
        // and three's async readiness check trips over a program released mid-compile.
        await gl.compileAsync(group, camera, scene);
      } catch {
        /* warm-up is best effort */
      }
      scene.remove(group);
      // Keep the materials alive: disposing them would release the compiled programs again.
      warmMaterials.push(...mats);
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera]);
  return null;
}

function GlHandle({ onGl }: { onGl?: (gl: THREE.WebGLRenderer) => void }) {
  const gl = useThree((s) => s.gl);
  useMemo(() => onGl?.(gl), [gl, onGl]);
  return null;
}

export interface StageProps {
  product: Product;
  framing?: Framing;
  interactive?: boolean;
  /** Clear background so the page (or the CSS bubble) shows through. */
  transparent?: boolean;
  pedestal?: boolean;
  /** Preload every material texture and precompile shaders (defaults to `interactive`). */
  preload?: boolean;
  /** Post effects (AO, AA, bloom, outline). Off on low-end/static views. */
  effects?: boolean;
  animate?: boolean;
  celebrateKey?: number;
  selectedId?: string | null;
  registry?: PartRegistry;
  gizmo?: boolean;
  /** Bump to re-run the camera focus even when the selection didn't change. */
  focusKey?: number;
  /** 0 = assembled, 1 = exploded view. */
  explode?: number;
  /** Track this point (part-local) for the DOM genie bubble. */
  anchor?: { partId: string; point: [number, number, number] } | null;
  onHit?: (hit: PartHit) => void;
  onHover?: (id: string | null) => void;
  onMiss?: () => void;
  onTransform?: (id: string, t: Part["transform"]) => void;
  onGl?: (gl: THREE.WebGLRenderer) => void;
  /** A product has been drawn for the first time (see ProductView). */
  onShown?: (productId: string) => void;
}

/**
 * Recover from a lost WebGL context (GPU reset, too many tabs): allow the browser to restore it,
 * then rebuild the whole canvas so every texture and buffer is re-uploaded.
 */
function ContextGuard({ onRestore }: { onRestore: () => void }) {
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      console.warn("[stage] WebGL context lost; waiting for restore");
    };
    const restored = () => onRestore();
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", restored);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, onRestore]);
  return null;
}

/** The one canvas: studio light, the part-built product, particles, post effects. */
export default function Stage(props: StageProps) {
  const [generation, setGeneration] = useState(0);
  const restore = useMemo(() => () => setGeneration((g) => g + 1), []);
  return <StageCanvas key={generation} {...props} onRestore={restore} />;
}

function StageCanvas({
  product, framing = "bubble", interactive = true, preload, transparent = false, pedestal = true, effects = true, animate = true,
  celebrateKey = 0, selectedId = null, registry: reg, gizmo = false, focusKey = 0, anchor = null, explode = 0, onHit, onHover, onMiss, onTransform, onGl, onShown,
  onRestore,
}: StageProps & { onRestore: () => void }) {
  const registry = useMemo(() => reg ?? new PartRegistry(), [reg]);
  const hasProduct = !!product.parts[product.rootId];
  // The studio preloads every texture set; view-only stages (the phone pledge page) fetch just what they show.
  const warm = preload ?? interactive;
  useEffect(() => {
    if (!warm) return;
    void preloadMaterials();
    // Garment and bag base models load behind the first wish, so a fashion template shows at once.
    void preloadMeshModels();
  }, [warm]);
  // Adaptive quality: drop resolution, then ambient occlusion, if the GPU can't hold the frame rate.
  const [dpr, setDpr] = useState(Math.min(2, window.devicePixelRatio || 1));
  const [lowPower, setLowPower] = useState(false);
  return (
    <Canvas
      shadows="soft"
      camera={{ position: [-1.5, 1.75, FRAMES[framing].d * 0.9], fov: 34, near: 0.05, far: 200 }}
      dpr={dpr}
      gl={{ antialias: false, alpha: transparent, preserveDrawingBuffer: true, powerPreference: "high-performance", stencil: false }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 0.92;
        // Clear alpha 0 even on an opaque canvas: ContactShadows' render targets rely on it.
        gl.setClearColor(0x000000, 0);
        camera.lookAt(TARGET);
      }}
      onPointerMissed={(e) => {
        // Only a real tap on empty space deselects, not the end of an orbit drag.
        if (e.type === "click") onMiss?.();
      }}
    >
      <GlHandle onGl={onGl} />
      <ContextGuard onRestore={onRestore} />
      <PerformanceMonitor
        bounds={() => [40, 58]}
        onDecline={() => {
          setDpr((d) => Math.max(1, +(d - 0.5).toFixed(2)));
          setLowPower((was) => was || dpr <= 1);
        }}
        onIncline={() => setDpr((d) => Math.min(Math.min(2, window.devicePixelRatio || 1), +(d + 0.25).toFixed(2)))}
        flipflops={4}
        onFallback={() => {
          setDpr(1);
          setLowPower(true);
        }}
      />
      {warm && <ShaderWarmup />}
      <ViewOffset framing={framing} />
      <CameraRig framing={framing} focusId={selectedId} registry={registry} interactive={interactive} focusKey={focusKey} />
      <AnchorTracker registry={registry} anchor={anchor} />
      {!transparent && <Backdrop />}
      <Lighting />
      <>
        <Turntable paused={!!selectedId} celebrateKey={celebrateKey}>
          {pedestal && <Pedestal reflect={effects && !lowPower && FX.has("reflect")} />}
          {hasProduct && (
            // A different product (the showroom piece -> your wish) starts fresh: no ghosts, morphs or
            // sticky framing carried over from the last one.
            <ProductView
              key={product.id}
              product={product}
              registry={registry}
              selectedId={selectedId}
              animate={animate}
              interactive={interactive}
              onHit={onHit}
              onHover={onHover}
              gizmo={gizmo}
              onTransform={onTransform}
              fitSize={FIT}
              floorY={FLOOR_Y}
              explode={explode}
              onShown={onShown}
            />
          )}
          {pedestal && <AutoClear />}
          {pedestal && (
            <ContactShadows position={[0, FLOOR_Y + 0.001, 0]} scale={1.6} resolution={1024} blur={2.2} opacity={0.75} far={0.9} color="#3b3226" frames={animate ? Infinity : 1} />
          )}
        </Turntable>
        <Particles />
        <Conjure registry={registry} />
        {effects && (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            {FX.has("ao") && !lowPower ? <N8AO aoRadius={0.18} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes color="#2a2018" /> : <></>}
            {FX.has("bloom") ? <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} /> : <></>}
            {FX.has("smaa") ? <SMAA /> : <></>}
          </EffectComposer>
        )}
      </>
    </Canvas>
  );
}
