import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { KIT, kitById, type KitEntry } from "@wishit/shared/kit.ts";
import { buildKit, kitTriangles } from "../three/parts/kit/index.ts";

/**
 * Kit test bench at /lab/kit. Every kit part mounted on a neutral wall, each scaled up uniformly
 * to fit its cell. `?id=zipper` shows one part large from a 3/4 view; `?color=#hex` overrides the
 * main color; `?p.length=0.6` style params are passed through as kitParams.
 */

const HDR = "/hdri/studio.hdr";

/** A pleasant demo finish per part (main slot). */
const LAB_MAT: Record<string, Partial<PartMaterial>> = {
  zipper: { color: "#22324F" },
  zipper_pull: { color: "#8A8D94" },
  buckle_side_release: { color: "#1F2023" },
  buckle_belt: { color: "#D6D9DE" },
  d_ring: { color: "#CDD0D6" },
  carabiner: { color: "#E0643A" },
  handle_grip: { color: "#26272B" },
  handle_telescoping: { color: "#BFC3CA" },
  wheel: { color: "#232427" },
  wheel_caster: { color: "#2D5D8A" },
  screw: { color: "#B9BDC4" },
  button_sewn: { color: "#7B4A2D" },
  snap_button: { color: "#D2D5DA" },
  hinge: { color: "#B5B9C0" },
  strap_end: { color: "#2E4A3F" },
  screw_cap: { color: "#3C6E91" },
  knob: { color: "#C3C6CC" },
  rivet: { color: "#C9A657" },
  grommet: { color: "#C9CCD2" },
  cord_lock: { color: "#1E1F22" },
  led: { color: "#2B2D31", emissive: "#3BFF8A" },
  speaker_grille: { color: "#3A3D42" },
  usb_port: { color: "#C9CCD2" },
  toggle_switch: { color: "#D7263D" },
  screen: { color: "#1C1D21", emissive: "#7FE3FF" },
  solar_panel: { color: "#F2F2F0", emissive: "#1D3E8A" },
  camera_lens: { color: "#2A2C31" },
  rubber_foot: { color: "#1F2022" },
  stitching: { color: "#C0392B" },
  brand_patch: { color: "#2F6B55" },
  mesh_pocket: { color: "#2B3A55" },
  bulb: { color: "#FFD38A" },
};

/** Parts centered on their origin (free parts): push them out of the wall so they're fully visible. */
const FREE = new Set(["wheel", "carabiner", "bulb", "wheel_caster", "cord_lock"]);

function labMaterial(e: KitEntry, color?: string): PartMaterial {
  const m = LAB_MAT[e.id] ?? {};
  return { preset: e.material as PartMaterial["preset"], color: color ?? m.color ?? "#9AA0A8", ...(m.emissive ? { emissive: m.emissive } : {}) } as PartMaterial;
}

function useHdr(url: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url, { method: "HEAD" })
      .then((r) => live && setOk(r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")))
      .catch(() => live && setOk(false));
    return () => {
      live = false;
    };
  }, [url]);
  return ok;
}

function Env({ hdr }: { hdr: boolean }) {
  if (hdr) return <Environment files={HDR} environmentIntensity={0.7} />;
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer intensity={2.4} position={[0, 4, 4]} scale={[8, 3, 1]} color="#ffffff" />
      <Lightformer intensity={1.4} position={[-5, 1, 2]} rotation-y={Math.PI / 2.5} scale={[4, 4, 1]} color="#f4f1ea" />
      <Lightformer intensity={1.1} position={[5, 1, 2]} rotation-y={-Math.PI / 2.5} scale={[4, 4, 1]} color="#eef2f6" />
      <Lightformer intensity={0.6} position={[0, -3, 3]} rotation-x={-Math.PI / 2} scale={[8, 4, 1]} color="#ffffff" />
      <Lightformer form="ring" intensity={3} position={[2.5, 3, 5]} scale={1.2} color="#ffffff" />
    </Environment>
  );
}

interface Placed {
  entry: KitEntry;
  object: THREE.Group;
  tris: number;
}

function usePart(entry: KitEntry, fit: number, params: Record<string, unknown>, color?: string): Placed {
  return useMemo(() => {
    const g = buildKit(entry.id, params, labMaterial(entry, color));
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const s = fit / Math.max(size.x, size.y, size.z * 0.6, 1e-4);
    const wrap = new THREE.Group();
    g.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3());
    const pushZ = FREE.has(entry.id) ? -box.min.z : 0;
    g.position.set(-c.x * s, -c.y * s, pushZ * s);
    wrap.add(g);
    return { entry, object: wrap, tris: kitTriangles(entry.id, params) };
  }, [entry, fit, params, color]);
}

function Cell({ entry, x, y, fit }: { entry: KitEntry; x: number; y: number; fit: number }) {
  const params = useMemo(() => ({}), []);
  const part = usePart(entry, fit, params);
  return (
    <group position={[x, y, 0]}>
      <primitive object={part.object} />
      <Html position={[0, -0.62, 0.02]} center zIndexRange={[10, 0]}>
        <a href={`/lab/kit?id=${entry.id}`} style={labelStyle}>
          {entry.id}
          <span style={{ opacity: 0.5, marginLeft: 6 }}>{Math.round(part.tris / 100) / 10}k</span>
        </a>
      </Html>
    </group>
  );
}

const labelStyle: React.CSSProperties = {
  font: "600 11px Inter, system-ui, sans-serif",
  color: "#2b2f33",
  background: "rgba(255,255,255,0.78)",
  padding: "3px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  textDecoration: "none",
  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
};

function Wall({ w, h }: { w: number; h: number }) {
  return (
    <mesh position={[0, 0, -0.0005]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#CFCBC4" roughness={0.95} />
    </mesh>
  );
}

function Grid() {
  const cols = 8;
  const cell = 1.35;
  const rows = Math.ceil(KIT.length / cols);
  return (
    <group>
      <Wall w={cols * cell + 2} h={rows * cell + 2} />
      {KIT.map((e, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        return <Cell key={e.id} entry={e} x={(c - (cols - 1) / 2) * cell} y={((rows - 1) / 2 - r) * cell + 0.1} fit={0.95} />;
      })}
    </group>
  );
}

function Single({ entry, params, color, zoom, focus }: { entry: KitEntry; params: Record<string, unknown>; color?: string; zoom: number; focus: [number, number] }) {
  const part = usePart(entry, 2.2 * zoom, params, color);
  return (
    <group>
      <Wall w={60} h={40} />
      <group position={[-focus[0] * 2.2 * zoom, -focus[1] * 2.2 * zoom, 0]}>
        <primitive object={part.object} />
      </group>
    </group>
  );
}

function Lights({ span }: { span: number }) {
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[-3, 5, 7]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.01}
        shadow-radius={6}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
      />
      <directionalLight position={[4, 1, 5]} intensity={0.5} color="#eef3ff" />
    </>
  );
}

export default function KitLab() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const id = q.get("id");
  const color = q.get("color") ?? undefined;
  const params = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of q.entries()) if (k.startsWith("p.")) out[k.slice(2)] = Number(v);
    return out;
  }, [q]);
  const entry = id ? kitById(id) : undefined;
  const zoom = Number(q.get("zoom") ?? 1) || 1;
  // Focus point as a fraction of the part's largest dimension (e.g. fx=0.4 looks at the +X end).
  const focus: [number, number] = [Number(q.get("fx") ?? 0) || 0, Number(q.get("fy") ?? 0) || 0];
  const hdr = useHdr(HDR);
  const single = !!entry;
  const tris = entry ? kitTriangles(entry.id, params) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#CFCBC4" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={single ? { position: [3.0, 1.75, 4.3], fov: 32, near: 0.05, far: 100 } : { position: [1.6, 1.6, 13], fov: 38, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.85;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
      >
        <color attach="background" args={["#CFCBC4"]} />
        <Lights span={single ? 3 : 7} />
        {hdr !== null && (
          <Suspense fallback={null}>
            <Env hdr={hdr} />
          </Suspense>
        )}
        {single && entry ? <Single entry={entry} params={params} color={color} zoom={zoom} focus={focus} /> : <Grid />}
        <OrbitControls target={[0, 0, single ? 0.3 : 0]} enableDamping makeDefault />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.45} luminanceThreshold={1.1} luminanceSmoothing={0.15} />
        </EffectComposer>
      </Canvas>
      <div style={{ position: "fixed", top: 14, left: 16, font: "600 13px Inter, system-ui, sans-serif", color: "#2b2f33" }}>
        <a href="/lab/kit" style={{ color: "inherit", textDecoration: "none" }}>Kit lab</a>
        {entry && (
          <span style={{ fontWeight: 500, opacity: 0.75 }}>
            {"  /  "}
            {entry.name} — {entry.size.map((v) => `${(v * 1000).toFixed(1)}`).join(" × ")} mm — {(tris / 1000).toFixed(1)}k tris
          </span>
        )}
        <span style={{ fontWeight: 500, opacity: 0.5, marginLeft: 12 }}>env: {hdr === null ? "…" : hdr ? "studio.hdr" : "lightformers"}</span>
      </div>
    </div>
  );
}
