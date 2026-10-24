import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { Particles } from "./Particles.tsx";
import { WishModel, type WishModelProps } from "./WishModel.tsx";

export type Framing = "voice" | "product" | "top" | "side" | "mini" | "debug";

/** x/y shift the rendered view (fraction of the canvas), d is camera distance. */
const FRAMES: Record<Framing, { x: number; y: number; d: number }> = {
  voice: { x: 0, y: 0.1, d: 4.6 },
  product: { x: 0, y: 0.17, d: 5.5 },
  top: { x: 0, y: 0.27, d: 7.2 },
  side: { x: 0.2, y: 0.04, d: 4.6 },
  mini: { x: 0, y: 0.02, d: 4.3 },
  debug: { x: 0, y: 0, d: 4.2 },
};
const TARGET = new THREE.Vector3(0, 1.0, 0);

function CameraRig({ framing }: { framing: Framing }) {
  const cur = useRef({ ...FRAMES[framing] });
  const offset = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }, dt) => {
    let f = FRAMES[framing];
    const narrow = size.width < 820;
    if (framing === "side" && narrow) f = { x: 0, y: 0.3, d: 6.2 };
    if (framing === "top" && narrow) f = { x: 0, y: 0.3, d: 6.6 };
    const k = 1 - Math.exp(-dt * 4);
    cur.current.x += (f.x - cur.current.x) * k;
    cur.current.y += (f.y - cur.current.y) * k;
    cur.current.d += (f.d - cur.current.d) * k;
    const cam = camera as THREE.PerspectiveCamera;
    cam.setViewOffset(size.width, size.height, cur.current.x * size.width, cur.current.y * size.height, size.width, size.height);
    offset.copy(cam.position).sub(TARGET).setLength(cur.current.d);
    cam.position.copy(TARGET).add(offset);
    cam.updateProjectionMatrix();
  });
  return null;
}

function Backdrop() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color("#2b1f5e") }, mid: { value: new THREE.Color("#140f30") }, bottom: { value: new THREE.Color("#07051a") } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, h)) : mix(mid, bottom, smoothstep(0.0, 0.5, -h)); gl_FragColor = vec4(c, 1.0); }`,
      }),
    [],
  );
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[60, 32, 16]} />
    </mesh>
  );
}

function GlHandle({ onGl }: { onGl?: (gl: THREE.WebGLRenderer) => void }) {
  const gl = useThree((s) => s.gl);
  useMemo(() => onGl?.(gl), [gl, onGl]);
  return null;
}

export interface StageProps extends WishModelProps {
  framing?: Framing;
  bloom?: boolean;
  interactive?: boolean;
  onGl?: (gl: THREE.WebGLRenderer) => void;
}

/** The one canvas: backdrop, studio light, the product, particles, bloom. */
export default function Stage({ framing = "voice", bloom = true, interactive = true, onGl, ...model }: StageProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.25, 4.6], fov: 34, near: 0.1, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <GlHandle onGl={onGl} />
      <CameraRig framing={framing} />
      <Backdrop />
      <Stars radius={40} depth={20} count={1400} factor={2.4} saturation={0.5} fade speed={0.6} />
      <ambientLight intensity={0.45} color="#cbbcff" />
      <directionalLight position={[2.5, 4, 3]} intensity={1.7} color="#fff3e2" />
      <pointLight position={[-2.4, 1.8, -2]} intensity={7} distance={9} color="#98e2c6" />
      <pointLight position={[2.4, 1.2, -2.4]} intensity={7} distance={9} color="#b9a3f0" />
      <pointLight position={[0, 0.35, 0.8]} intensity={1.5} distance={3} color="#b9a3f0" />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.2} position={[0, 3, 3]} scale={[5, 2, 1]} color="#ffffff" />
        <Lightformer intensity={1.3} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[3, 3, 1]} color="#b9a3f0" />
        <Lightformer intensity={1.3} position={[4, 1, 0]} rotation-y={-Math.PI / 2} scale={[3, 3, 1]} color="#98e2c6" />
        <Lightformer intensity={0.8} position={[0, -2, 2]} rotation-x={-Math.PI / 2} scale={[4, 4, 1]} color="#f2c96b" />
      </Environment>
      <WishModel {...model} />
      <Particles />
      <OrbitControls
        enabled={interactive}
        enablePan={false}
        enableZoom={false}
        target={[0, 1.0, 0]}
        minPolarAngle={0.85}
        maxPolarAngle={1.95}
        rotateSpeed={0.6}
        enableDamping
      />
      {bloom && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.62} luminanceSmoothing={0.25} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
