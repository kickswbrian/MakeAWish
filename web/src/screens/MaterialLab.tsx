import { Suspense, useEffect, useMemo, useState } from "react";
import { StudioEnvironment } from "../three/StudioEnv.tsx";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MATERIAL_PRESETS, type MaterialPreset, type PartMaterial } from "@wishit/shared";
import { createMaterial, preloadMaterials, PRESET_INFO } from "../three/parts/materials.ts";
import { boxProjectUVs, scaleUVs } from "../three/parts/uv.ts";

/**
 * Visual test bench for the material presets: every preset on a few shapes, in a mid color and a
 * dark or light one, lit like the product stage (Stage.tsx): transparent canvas over the cream
 * CSS backdrop, NeutralToneMapping at 0.92, the studio HDRI at 0.62, key/rim/fill lights, N8AO,
 * bloom and SMAA. Keep the lighting below in sync with Stage.tsx.
 * URL params: ?p=leather,nylon (only these presets), ?cols=3, ?view=close (camera close-up),
 * ?shapes=box,sphere,panel,cyl,window (default box,sphere), ?fx=0 (no post effects),
 * ?rough=0.3 / ?metal=1 (override every material).
 */

const TINTS: Record<MaterialPreset, [string, string]> = {
  nylon: ["#D7263D", "#1F2A55"],
  leather: ["#7B4A2D", "#1A1A1D"],
  canvas: ["#C9B48A", "#1E5631"],
  metal_brushed: ["#C0C4CC", "#E2B13C"],
  plastic_matte: ["#3A6FD8", "#F4F4F2"],
  plastic_gloss: ["#D7263D", "#1A1A1D"],
  rubber: ["#F28C28", "#1E1E21"],
  wood: ["#B98B57", "#5C3A21"],
  glass: ["#DCEFF2", "#2E9E5B"],
  metal_polished: ["#D8DCE2", "#B87333"],
  ceramic: ["#F1EEE6", "#1E8C8C"],
  cotton: ["#E8798E", "#F4EBD0"],
  knit: ["#9CAF88", "#3A3D42"],
  satin: ["#B0102D", "#F7C5D5"],
  denim: ["#2F4F7F", "#9CCBF0"],
  suede: ["#A8794F", "#1F2A55"],
  concrete: ["#A7A39B", "#E8E4DC"],
  marble: ["#EDEBE6", "#2B2D30"],
  cork: ["#C08A55", "#4A4D52"],
};

const BOX = { w: 0.24, h: 0.28, d: 0.14, r: 0.028 };
const SPHERE_R = 0.1;
const CYL = { r: 0.07, h: 0.26 };
/** A thin flat sheet: phone screen, toaster window, display case. */
const PANEL = { w: 0.22, h: 0.27, d: 0.008 };
const SHAPE_STEP = 0.29;
const CELL_D = 0.8;
const GAP = 0.22;

/** window: a panel in front of an opaque block (toaster window, phone screen over a display). */
type Shape = "box" | "sphere" | "panel" | "cyl" | "window";
const SHAPES: Record<Shape, { y: number; rotY: number }> = {
  box: { y: BOX.h / 2, rotY: 0 },
  sphere: { y: SPHERE_R, rotY: 0 },
  panel: { y: PANEL.h / 2, rotY: -0.45 },
  cyl: { y: CYL.h / 2, rotY: 0 },
  window: { y: PANEL.h / 2, rotY: 0 },
};
const BACKING: PartMaterial = { preset: "plastic_matte", color: "#E07A3F" };

let geometries: Record<Shape, THREE.BufferGeometry> | null = null;
function getGeometries() {
  geometries ??= {
    box: boxProjectUVs(new RoundedBoxGeometry(BOX.w, BOX.h, BOX.d, 6, BOX.r)),
    sphere: scaleUVs(new THREE.SphereGeometry(SPHERE_R, 96, 64), 2 * Math.PI * SPHERE_R, Math.PI * SPHERE_R),
    panel: boxProjectUVs(new RoundedBoxGeometry(PANEL.w, PANEL.h, PANEL.d, 2, PANEL.d * 0.45)),
    cyl: scaleUVs(new THREE.CylinderGeometry(CYL.r, CYL.r, CYL.h, 96, 1), 2 * Math.PI * CYL.r, CYL.h),
    window: boxProjectUVs(new RoundedBoxGeometry(PANEL.w, PANEL.h, PANEL.d, 2, PANEL.d * 0.45)),
  };
  return geometries;
}

function Swatch({ shape, spec, x }: { shape: Shape; spec: PartMaterial; x: number }) {
  const mat = useMemo(() => createMaterial(spec), [spec]);
  useEffect(() => () => mat.dispose(), [mat]);
  const backing = useMemo(() => (shape === "window" ? createMaterial(BACKING) : null), [shape]);
  useEffect(() => () => backing?.dispose(), [backing]);
  const { y, rotY } = SHAPES[shape];
  return (
    <>
      <mesh geometry={getGeometries()[shape]} material={mat} position={[x, y, 0]} rotation-y={rotY} castShadow receiveShadow />
      {backing && (
        <mesh geometry={getGeometries().box} material={backing} position={[x + 0.06, BOX.h * 0.3, -0.09]} scale={[0.6, 0.6, 0.6]} castShadow receiveShadow />
      )}
    </>
  );
}

function Cell({ preset, position, overrides, shapes }: { preset: MaterialPreset; position: [number, number, number]; overrides: Partial<PartMaterial>; shapes: Shape[] }) {
  const [a, b] = TINTS[preset];
  const specA = useMemo<PartMaterial>(() => ({ preset, color: a, ...overrides }), [preset, a, overrides]);
  const specB = useMemo<PartMaterial>(() => ({ preset, color: b, ...overrides }), [preset, b, overrides]);
  const n = shapes.length * 2;
  const x0 = -((n - 1) * SHAPE_STEP) / 2;
  return (
    <group position={position}>
      {[specA, specB].flatMap((spec, t) =>
        shapes.map((shape, i) => <Swatch key={`${t}-${shape}`} shape={shape} spec={spec} x={x0 + (t * shapes.length + i) * SHAPE_STEP} />),
      )}
      <Html position={[0, 0.005, 0.2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ font: "600 12px/1.2 system-ui, sans-serif", color: "#3b3a36", whiteSpace: "nowrap", textAlign: "center", textShadow: "0 1px 0 #fff8" }}>
          {PRESET_INFO[preset].label}
          <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>{a} · {b}</div>
        </div>
      </Html>
    </group>
  );
}

export default function MaterialLab() {
  const params = new URLSearchParams(window.location.search);
  const only = params.get("p")?.split(",").filter((p): p is MaterialPreset => (MATERIAL_PRESETS as readonly string[]).includes(p));
  const presets: MaterialPreset[] = only?.length ? only : [...MATERIAL_PRESETS];
  const cols = Number(params.get("cols")) || Math.min(presets.length, presets.length > 9 ? 4 : presets.length > 4 ? 3 : presets.length > 1 ? 2 : 1);
  const rows = Math.ceil(presets.length / cols);
  const view = params.get("view");
  const shapes = (params.get("shapes") ?? "box,sphere").split(",").filter((x): x is Shape => x in SHAPES);
  const cellW = shapes.length * 2 * SHAPE_STEP - 0.04;
  const effects = params.get("fx") !== "0";
  const overrides = useMemo<Partial<PartMaterial>>(() => {
    const o: Partial<PartMaterial> = {};
    if (params.get("rough")) o.roughness = Number(params.get("rough"));
    if (params.get("metal")) o.metalness = Number(params.get("metal"));
    if (params.get("color")) o.color = `#${params.get("color")}`;
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    void preloadMaterials().then(() => setReady(true));
  }, []);

  const width = cols * cellW + (cols - 1) * GAP;
  const depth = rows * CELL_D;
  const cells = presets.map((p, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { p, pos: [c * (cellW + GAP) - width / 2 + cellW / 2, 0, r * CELL_D - depth / 2 + CELL_D / 2] as [number, number, number] };
  });

  // Fit the grid from a camera looking down ~32 degrees.
  const aspect = window.innerWidth / window.innerHeight;
  const vfov = (30 * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const pitch = ((rows > 1 ? 46 : 26) * Math.PI) / 180;
  const fitW = (width / 2 + 0.06) / Math.tan(hfov / 2);
  const fitD = ((depth * Math.sin(pitch) + 0.3) / 2) / Math.tan(vfov / 2);
  const dist = Math.max(fitW, fitD, 0.8) + depth / 2 - 0.2;
  let camPos: [number, number, number] = [0, Math.sin(pitch) * dist + 0.1, Math.cos(pitch) * dist];
  let target: [number, number, number] = [0, 0.1, 0];
  if (view === "close") {
    const [x, , z] = cells[0].pos;
    const left = x - cellW / 2 + SHAPE_STEP * 0.75;
    target = [left, 0.15, z];
    camPos = [left + 0.12, 0.24, z + 0.42];
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 40%, #FFFFFF, #FFFCF7 55%, #EEF4F1)" }}>
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        camera={{ position: camPos, fov: 30, near: 0.02, far: 100 }}
        gl={{ antialias: !effects, alpha: true, stencil: false }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 0.92;
          gl.setClearColor(0x000000, 0);
        }}
      >
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
          shadow-camera-left={-width / 2 - 1}
          shadow-camera-right={width / 2 + 1}
          shadow-camera-top={depth / 2 + 1}
          shadow-camera-bottom={-depth / 2 - 1}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
        />
        <directionalLight position={[2.2, 1.6, -2.6]} intensity={1.1} color="#e6f0ff" />
        <directionalLight position={[2.4, 0.8, 2.0]} intensity={0.35} color="#ffe9f2" />
        {cells.map(({ p, pos }) => (
          <Cell key={p} preset={p} position={pos} overrides={overrides} shapes={shapes} />
        ))}
        {/* Shadow catcher only: the CSS backdrop shows through, as on the product stage. */}
        <mesh rotation-x={-Math.PI / 2} position-y={-0.0005} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <shadowMaterial opacity={0.12} color="#3b3226" />
        </mesh>
        <ContactShadows position={[0, 0.0005, 0]} scale={[width + 1, depth + 1]} resolution={1024} blur={2.2} far={0.6} opacity={0.55} color="#3b3226" frames={1} />
        <OrbitControls target={target} makeDefault />
        {effects && (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <N8AO aoRadius={0.18} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes color="#2a2018" />
            <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} />
            <SMAA />
          </EffectComposer>
        )}
      </Canvas>
      <div style={{ position: "absolute", left: 16, top: 12, font: "600 13px system-ui, sans-serif", color: "#3b3a36" }}>
        Material lab {ready ? "" : "· loading textures…"}
      </div>
    </div>
  );
}
