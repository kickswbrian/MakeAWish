import { Component, createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, PivotControls } from "@react-three/drei";
import { a, useSpring } from "@react-spring/three";
import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { geometryKey, buildGeometry } from "./geometry.ts";
import { applyMaterial, createMaterial } from "./materials.ts";
import { buildKit } from "./kit/index.ts";
import { addHulls, hullMaterial } from "./hull.ts";
import { fx } from "../signals.ts";
import type { Part, Product, Vec3 } from "@wishit/shared";

/** A tap on a part: point and normal in that part's local frame, plus a flush-mount rotation. */
export interface PartHit {
  partId: string;
  point: Vec3;
  normal: Vec3;
  /** Euler XYZ degrees turning +Z onto the normal (how a kit part sits flush on the surface). */
  rotation: Vec3;
  world: THREE.Vector3;
}

/** Live scene objects per part id, for camera framing, anchors and the outline sent to the genie. */
export class PartRegistry {
  groups = new Map<string, THREE.Group>();
  meshes = new Map<string, THREE.Object3D>();
  /** Geometry bounds in the part's own frame. */
  boxes = new Map<string, THREE.Box3>();
  /** The group whose frame is "product space" (meters, root at origin). */
  root: THREE.Group | null = null;
  /** The fitted product's world-space size on the stage, bumped (version) whenever the fit changes. */
  fit = { version: 0, height: 0, width: 0 };
  /** Jump a part's spring straight to a transform (used by the gizmo so commits don't snap back). */
  setters = new Map<string, (t: Part["transform"]) => void>();

  /** World-space box of one part (its own mesh only, not children). */
  worldBox(id: string, out = new THREE.Box3()): THREE.Box3 | null {
    const m = this.meshes.get(id);
    if (!m) return null;
    m.updateWorldMatrix(true, true);
    return out.setFromObject(m);
  }
}

const DEG = Math.PI / 180;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export function localMatrix(p: Part, out = new THREE.Matrix4()): THREE.Matrix4 {
  const [rx, ry, rz] = p.transform.rotation;
  tmpQ.setFromEuler(tmpE.set(rx * DEG, ry * DEG, rz * DEG, "XYZ"));
  return out.compose(new THREE.Vector3(...p.transform.position), tmpQ, new THREE.Vector3(...p.transform.scale));
}

/** A part's matrix in product space (root frame), from transform data alone (no scene needed). */
export function partMatrix(product: Product, id: string): THREE.Matrix4 {
  const chain: Part[] = [];
  let cur: Part | undefined = product.parts[id];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent ? product.parts[cur.parent] : undefined;
  }
  const m = new THREE.Matrix4();
  for (const p of chain) m.multiply(localMatrix(p, tmpM));
  return m;
}

// ---------- Spawn clock: parts added together pop in one after another ----------

let nextSlot = 0;
function spawnDelay(): number {
  const now = performance.now();
  nextSlot = Math.max(nextSlot, now);
  const d = nextSlot - now;
  nextSlot += 55;
  return Math.min(d, 1600);
}

// ---------- Context ----------

interface Ctx {
  product: Product;
  children: Map<string, Part[]>;
  cutters: Map<string, Part[]>;
  selectedId: string | null;
  registry: PartRegistry;
  animate: boolean;
  interactive: boolean;
  onHit?: (hit: PartHit) => void;
  onHover?: (id: string | null) => void;
  hovered: MutableRefObject<string | null>;
  explode: number;
  /** Parts that get a name tag in the exploded view. */
  labels: Set<string>;
}
const ViewCtx = createContext<Ctx | null>(null);

const castsShadow = (m: Part["material"]) => m.preset !== "glass" && (m.opacity ?? 1) > 0.6;

const isOpenSurface = (p: Part) => {
  const g = p.geometry;
  if (!g) return false;
  if (g.type === "sphere") return g.params.angle < 179;
  if (g.type === "cylinder") return g.params.open;
  if (g.type === "lathe") {
    const pts = g.params.points;
    return g.params.angle < 359 || pts[0][0] > 1e-4 || pts[pts.length - 1][0] > 1e-4;
  }
  if (g.type === "torus") return false;
  return false;
};

// ---------- CSG ----------

const evaluator = new Evaluator();
evaluator.attributes = ["position", "uv", "normal"];
evaluator.useGroups = false;

function carve(base: THREE.BufferGeometry, cutters: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  try {
    let result = new Brush(base);
    result.updateMatrixWorld();
    for (const c of cutters) {
      const b = new Brush(c.geometry);
      c.matrix.decompose(b.position, b.quaternion, b.scale);
      b.updateMatrixWorld();
      result = evaluator.evaluate(result, b, SUBTRACTION);
    }
    const g = result.geometry;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  } catch (err) {
    console.warn("[csg] cut failed, keeping the uncut part", err);
    return base;
  }
}

// ---------- Mesh for one part ----------

/** Kit parts whose glowing element is its own mesh: the housing (main slot) must not glow too. */
const GLOW_KITS = new Set(["led", "screen", "bulb", "solar_panel"]);
const meshMaterial = (p: Part) =>
  p.kind === "kit" && p.kitAsset && GLOW_KITS.has(p.kitAsset) ? { ...p.material, emissive: undefined, emissiveIntensity: undefined } : p.material;

const PartMesh = memo(function PartMesh({ part, cutters, selected }: { part: Part; cutters: Part[]; selected: boolean }) {
  const ctx = useContext(ViewCtx)!;
  const spec = meshMaterial(part);
  const mat = useMemo(() => createMaterial(spec), []); // eslint-disable-line react-hooks/exhaustive-deps
  const targetColor = useRef(new THREE.Color(part.material.color));
  const flash = useRef(0);
  const holder = useRef<THREE.Group>(null);

  // Geometry (with CSG cuts) for primitives, a built group for kit parts.
  // Cuts depend on where each cutter sits relative to this part (either one may move).
  const cutKey = cutters.length
    ? cutters.map((c) => {
        const rel = partMatrix(ctx.product, part.id).invert().multiply(partMatrix(ctx.product, c.id));
        return geometryKey(c.geometry) + rel.elements.map((v) => v.toFixed(4)).join(",");
      }).join("|")
    : "";
  const geometry = useMemo(() => {
    if (part.kind !== "primitive" || !part.geometry) return null;
    let base: THREE.BufferGeometry;
    try {
      base = buildGeometry(part.geometry);
    } catch (err) {
      console.warn(`[parts] ${part.id}: bad geometry, showing a placeholder`, err);
      base = new THREE.SphereGeometry(0.01, 12, 8);
      base.computeBoundingBox();
    }
    if (!cutters.length) return base;
    const inv = partMatrix(ctx.product, part.id).invert();
    // Each cut is a full BVH boolean; cap them so a runaway product can't freeze the page.
    const cuts = cutters
      .filter((c) => c.geometry)
      .slice(0, 8)
      .map((c) => ({ geometry: buildGeometry(c.geometry!), matrix: inv.clone().multiply(partMatrix(ctx.product, c.id)) }));
    const out = carve(base, cuts);
    for (const c of cuts) c.geometry.dispose();
    if (out !== base) base.dispose();
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey(part.geometry), part.kind, cutKey]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Shape morph: when the new geometry has the same topology as the old one (same type, same
  // vertex layout, e.g. a bigger shade), glide every vertex to its new place instead of snapping.
  const shown = useRef<THREE.BufferGeometry | null>(null);
  const morph = useRef<{ geo: THREE.BufferGeometry; fromP: Float32Array; toP: Float32Array; fromN: Float32Array; toN: Float32Array; t: number } | null>(null);
  useLayoutEffect(() => {
    const prev = shown.current;
    shown.current = geometry;
    if (!geometry || !prev || !ctx.animate) return;
    const a = prev.attributes.position, b = geometry.attributes.position;
    const na = prev.attributes.normal, nb = geometry.attributes.normal;
    if (!a || !b || !na || !nb || a.count !== b.count || (prev.index?.count ?? -1) !== (geometry.index?.count ?? -1)) return;
    const toP = new Float32Array(b.array as Float32Array), toN = new Float32Array(nb.array as Float32Array);
    const fromP = new Float32Array(a.array as Float32Array), fromN = new Float32Array(na.array as Float32Array);
    (b.array as Float32Array).set(fromP);
    (nb.array as Float32Array).set(fromN);
    b.needsUpdate = nb.needsUpdate = true;
    morph.current = { geo: geometry, fromP, toP, fromN, toN, t: 0 };
  }, [geometry, ctx.animate]);
  useFrame((_s, dt) => {
    const m = morph.current;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / 0.38);
    const k = 1 - Math.pow(1 - m.t, 3);
    const p = m.geo.attributes.position, n = m.geo.attributes.normal;
    const pa = p.array as Float32Array, na2 = n.array as Float32Array;
    for (let i = 0; i < pa.length; i++) pa[i] = m.fromP[i] + (m.toP[i] - m.fromP[i]) * k;
    for (let i = 0; i < na2.length; i++) na2[i] = m.fromN[i] + (m.toN[i] - m.fromN[i]) * k;
    p.needsUpdate = n.needsUpdate = true;
    if (m.t >= 1) {
      m.geo.computeBoundingBox();
      m.geo.computeBoundingSphere();
      morph.current = null;
    }
  });

  const kitKey = part.kind === "kit" ? `${part.kitAsset}:${JSON.stringify(part.kitParams ?? {})}:${JSON.stringify(part.material)}` : "";
  const kit = useMemo(() => {
    if (part.kind !== "kit" || !part.kitAsset) return null;
    let g: THREE.Group;
    try {
      g = buildKit(part.kitAsset, part.kitParams ?? {}, part.material);
    } catch (err) {
      console.warn(`[parts] ${part.id}: kit ${part.kitAsset} failed to build`, err);
      g = new THREE.Group();
    }
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      if (m.userData.slot === "main") m.material = mat;
    });
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitKey]);

  // Material spec changes: apply instantly, but let the color glide there.
  const matKey = JSON.stringify(spec);
  const first = useRef(true);
  useEffect(() => {
    const from = mat.color.clone();
    applyMaterial(mat, spec);
    // applyMaterial already makes glass double-sided (its back walls show through the front).
    if (isOpenSurface(part)) mat.side = THREE.DoubleSide;
    // See-through finishes let light through: no hard shadow (kit hardware's main slot included).
    kit?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.slot === "main") o.castShadow = castsShadow(spec);
    });
    targetColor.current.set(part.material.color);
    if (!first.current) mat.color.copy(from);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matKey, kit]);
  useEffect(() => () => mat.dispose(), [mat]);

  // Bounds in the part's frame, for fitting and outlines.
  useLayoutEffect(() => {
    const box = new THREE.Box3();
    if (geometry) box.copy(geometry.boundingBox!);
    else if (kit) {
      kit.updateMatrixWorld(true);
      box.setFromObject(kit);
    }
    ctx.registry.boxes.set(part.id, box);
    if (holder.current) ctx.registry.meshes.set(part.id, holder.current);
  }, [geometry, kit, part.id, ctx.registry]);
  useEffect(() => () => {
    ctx.registry.boxes.delete(part.id);
    ctx.registry.meshes.delete(part.id);
  }, [part.id, ctx.registry]);

  // Any visible change after mount: a quick glow.
  const look = `${geometryKey(part.geometry)}|${kitKey}|${matKey}|${JSON.stringify(part.transform)}`;
  const lastLook = useRef(look);
  useEffect(() => {
    if (lastLook.current === look) return;
    lastLook.current = look;
    flash.current = 1;
    // A small burst in the part's (new) color, at its center.
    if (ctx.animate && holder.current) {
      holder.current.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(holder.current);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        const n = Math.round(Math.min(34, 10 + size * 40));
        fx.burst([c.x, c.y, c.z], n, part.material.color, 0.35 + Math.min(0.5, size));
        fx.burst([c.x, c.y, c.z], Math.round(n * 0.5), "#F2D88A", 0.3 + Math.min(0.4, size));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);

  const baseEmissive = useRef({ color: new THREE.Color(), intensity: 0 });
  const gold = useMemo(() => new THREE.Color("#F2C14E"), []);
  useFrame((st, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    mat.color.lerp(targetColor.current, k);
    if (!spec.emissive) {
      const hover = ctx.hovered.current === part.id ? 0.08 : 0;
      if (selected) {
        // Selected: a slow gold breath on the part itself, on top of the outline.
        mat.emissive.copy(gold);
        mat.emissiveIntensity = 0.14 + 0.08 * Math.sin(st.clock.elapsedTime * 3.2) + flash.current * 0.4;
      } else {
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = flash.current * 0.55 + hover;
      }
    } else {
      baseEmissive.current.intensity = spec.emissiveIntensity ?? 1.5;
      mat.emissiveIntensity = baseEmissive.current.intensity + flash.current;
    }
    flash.current = Math.max(0, flash.current - dt * 2.2);
  });

  // Selected: a pulsing gold silhouette around this part's own meshes (not its children).
  const meshHolder = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!selected || !meshHolder.current) return;
    return addHulls(meshHolder.current);
  }, [selected, geometry, kit]);

  const content = geometry ? (
    // Glass and see-through parts let light through: no hard shadow.
    <mesh
      geometry={geometry}
      material={mat}
      castShadow={castsShadow(spec)}
      receiveShadow
    />
  ) : kit ? (
    <primitive object={kit} />
  ) : null;
  return (
    <group ref={holder} userData={{ partId: part.id }}>
      <group ref={meshHolder}>{content}</group>
    </group>
  );
});

/** One broken part (bad data, a builder bug) must never take the whole product down. */
class PartBoundary extends Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn(`[parts] ${this.props.id} failed to render`, err);
  }
  componentDidUpdate(prev: { id: string; children: React.ReactNode }) {
    // A later patch may fix the part: try again when its content changes.
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ---------- One node of the part tree ----------

const PartNode = memo(function PartNode({ part, depth }: { part: Part; depth: number }) {
  const ctx = useContext(ViewCtx)!;
  const kids = ctx.children.get(part.id) ?? [];
  const group = useRef<THREE.Group>(null);
  const t = part.transform;
  // Exploded view: every part slides away from its parent's center, so assemblies open up.
  const ex = depth > 0 ? 1 + ctx.explode * (0.55 + 0.35 / depth) : 1;
  const target = {
    position: [t.position[0] * ex, t.position[1] * ex, t.position[2] * ex] as Vec3,
    rotation: [t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG] as Vec3,
    scale: t.scale,
  };
  const [spawn] = useState(() => (ctx.animate ? spawnDelay() : 0));
  const delay = useRef(spawn);
  const [spring, springApi] = useSpring(() => ({
    from: ctx.animate ? { position: target.position, rotation: target.rotation, scale: [0.001, 0.001, 0.001] as Vec3 } : target,
    to: target,
    delay: delay.current,
    config: { tension: 230, friction: 17 },
  }), []);
  // A part whose shape or material changes gets a quick squash-and-settle, like it was re-made.
  const shapeKey = `${geometryKey(part.geometry)}|${part.kitAsset ?? ""}|${JSON.stringify(part.kitParams ?? {})}|${JSON.stringify(part.material)}`;
  const lastShape = useRef(shapeKey);
  useEffect(() => {
    if (lastShape.current === shapeKey) return;
    lastShape.current = shapeKey;
    if (!ctx.animate) return;
    const sc = part.transform.scale;
    void springApi.start({
      from: { scale: [sc[0] * 0.9, sc[1] * 1.08, sc[2] * 0.9] as Vec3 },
      to: { scale: sc },
      config: { tension: 420, friction: 13 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  // Later edits glide to the new transform (the gizmo writes the same values, so it's a no-op there).
  const key = JSON.stringify(t) + ctx.explode;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void springApi.start({ ...target, delay: 0, config: { tension: 260, friction: 22 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Sparkle burst when a part appears.
  useEffect(() => {
    if (!ctx.animate) return;
    const timer = setTimeout(() => {
      const g = group.current;
      if (!g) return;
      g.updateWorldMatrix(true, false);
      const box = ctx.registry.boxes.get(part.id);
      const world = (box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3()).applyMatrix4(g.matrixWorld);
      const big = depth === 0 ? 1 : 0.45;
      fx.burst([world.x, world.y, world.z], Math.round(26 * big + 10), part.material.color, 0.55 * big + 0.25);
      fx.burst([world.x, world.y, world.z], Math.round(16 * big + 6), "#F2D88A", 0.45 * big + 0.2);
    }, delay.current + 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (group.current) ctx.registry.groups.set(part.id, group.current);
    ctx.registry.setters.set(part.id, (tr) => {
      springApi.set({ position: tr.position, rotation: tr.rotation.map((v) => v * DEG) as Vec3, scale: tr.scale });
    });
    return () => {
      ctx.registry.groups.delete(part.id);
      ctx.registry.setters.delete(part.id);
    };
  }, [part.id, ctx.registry, springApi]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!ctx.interactive || !ctx.onHit) return;
    e.stopPropagation();
    // A drag (orbit) is not a tap.
    if (e.delta > 6) return;
    const g = group.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    const inv = g.matrixWorld.clone().invert();
    const local = e.point.clone().applyMatrix4(inv);
    const n = (e.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone();
    // Face normal is in the hit mesh's frame; bring it to world, then to this part's frame.
    n.transformDirection((e.object as THREE.Mesh).matrixWorld).transformDirection(inv).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const eul = new THREE.Euler().setFromQuaternion(q, "XYZ");
    const r3 = (v: number) => Math.round(v * 10000) / 10000;
    ctx.onHit({
      partId: part.id,
      point: [r3(local.x), r3(local.y), r3(local.z)],
      normal: [r3(n.x), r3(n.y), r3(n.z)],
      rotation: [Math.round(eul.x / DEG), Math.round(eul.y / DEG), Math.round(eul.z / DEG)],
      world: e.point.clone(),
    });
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    if (!ctx.interactive) return;
    e.stopPropagation();
    ctx.hovered.current = part.id;
    ctx.onHover?.(part.id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    if (ctx.hovered.current === part.id) {
      ctx.hovered.current = null;
      ctx.onHover?.(null);
    }
    document.body.style.cursor = "";
  };

  return (
    <a.group
      ref={group}
      position={spring.position as unknown as Vec3}
      rotation={spring.rotation as unknown as Vec3}
      scale={spring.scale as unknown as Vec3}
      onClick={onClick}
      onPointerOver={onOver}
      onPointerOut={onOut}
    >
      <PartBoundary id={part.id}>
        <PartMesh part={part} cutters={ctx.cutters.get(part.id) ?? EMPTY} selected={ctx.selectedId === part.id} />
      </PartBoundary>
      {kids.map((c) => (
        <PartNode key={c.id} part={c} depth={depth + 1} />
      ))}
      {ctx.labels.has(part.id) && <PartLabel part={part} />}
    </a.group>
  );
});
const EMPTY: Part[] = [];
const NO_LABELS = new Set<string>();

/**
 * A name tag floating at the top of a part, for the exploded view (moves with the part). Its box
 * is measured after render (and kit parts load late), so it follows the box every frame and stays
 * hidden on parts too small to label.
 */
function PartLabel({ part }: { part: Part }) {
  const ctx = useContext(ViewCtx)!;
  const anchor = useRef<THREE.Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const size = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const box = ctx.registry.boxes.get(part.id);
    const ok = !!box && !box.isEmpty() && box.getSize(size).length() > 0.02;
    if (ok && anchor.current) anchor.current.position.set((box!.min.x + box!.max.x) / 2, box!.max.y, (box!.min.z + box!.max.z) / 2);
    if (tag.current) tag.current.style.visibility = ok ? "visible" : "hidden";
  });
  return (
    <group ref={anchor}>
      <Html center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tag} className="xlabel" style={{ visibility: "hidden" }}>{part.name}</div>
      </Html>
    </group>
  );
}

// ---------- Move/rotate/scale gizmo ----------

function Gizmo({ id, onCommit }: { id: string; onCommit: (id: string, t: Part["transform"]) => void }) {
  const ctx = useContext(ViewCtx)!;
  const part = ctx.product.parts[id];
  const base = useMemo(() => partMatrix(ctx.product, id), [ctx.product, id]);
  const parentInv = useMemo(
    () => (part?.parent ? partMatrix(ctx.product, part.parent).invert() : new THREE.Matrix4()),
    [ctx.product, part?.parent],
  );
  const [matrix, setMatrix] = useState(base);
  useEffect(() => setMatrix(base), [base]);
  const pending = useRef<Part["transform"] | null>(null);
  if (!part) return null;
  return (
    <PivotControls
      matrix={matrix}
      autoTransform={false}
      fixed
      scale={120}
      lineWidth={3.5}
      depthTest={false}
      axisColors={["#E8798E", "#7FB7A4", "#7EA6E0"]}
      hoveredColor="#E9C46A"
      onDrag={(l) => {
        setMatrix(l.clone());
        const local = parentInv.clone().multiply(l);
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        local.decompose(pos, q, sc);
        const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
        const r4 = (v: number) => Math.round(v * 10000) / 10000;
        const t: Part["transform"] = {
          position: [r4(pos.x), r4(pos.y), r4(pos.z)],
          rotation: [Math.round((e.x / DEG) * 10) / 10, Math.round((e.y / DEG) * 10) / 10, Math.round((e.z / DEG) * 10) / 10],
          scale: [r4(Math.max(0.01, sc.x)), r4(Math.max(0.01, sc.y)), r4(Math.max(0.01, sc.z))],
        };
        pending.current = t;
        ctx.registry.setters.get(id)?.(t);
      }}
      onDragEnd={() => {
        if (pending.current) onCommit(id, pending.current);
        pending.current = null;
      }}
    />
  );
}

// ---------- The product ----------

export interface ProductViewProps {
  product: Product;
  selectedId?: string | null;
  registry?: PartRegistry;
  /** Pop-in springs and sparkles. Off for thumbnails and static views. */
  animate?: boolean;
  interactive?: boolean;
  onHit?: (hit: PartHit) => void;
  onHover?: (id: string | null) => void;
  /** World height the product's largest dimension is fitted to. */
  fitSize?: number;
  /** World y of the floor the product stands on. */
  floorY?: number;
  /** Show the move/rotate/scale gizmo on the selected part. */
  gizmo?: boolean;
  onTransform?: (id: string, t: Part["transform"]) => void;
  /** 0 = assembled, 1 = exploded view. */
  explode?: number;
  /** Called once this product has been drawn (it is built and its shaders compiled). */
  onShown?: (productId: string) => void;
}

/**
 * Renders a part-based product: real-world meters inside, auto-fitted to the stage outside.
 * The fit is sticky so "make it bigger" visibly grows; it only refits on big changes.
 */
export function ProductView({
  product, selectedId = null, registry: reg, animate = true, interactive = false, onHit, onHover, fitSize = 1.25, floorY = 0.105,
  gizmo = false, onTransform, explode = 0, onShown,
}: ProductViewProps) {
  const registry = useMemo(() => reg ?? new PartRegistry(), [reg]);
  // The first frame with this product in it has been rendered by the time the next one starts.
  const shownFrames = useRef(0);
  useFrame(() => {
    if (shownFrames.current < 2 && ++shownFrames.current === 2) onShown?.(product.id);
  });
  const hovered = useRef<string | null>(null);
  const fit = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  const { children, cutters } = useMemo(() => {
    const children = new Map<string, Part[]>();
    const cutters = new Map<string, Part[]>();
    for (const p of Object.values(product.parts)) {
      if (p.csg) {
        const list = cutters.get(p.csg.withPartId) ?? [];
        list.push(p);
        cutters.set(p.csg.withPartId, list);
        continue;
      }
      if (!p.parent) continue;
      // Cutters don't render, so their children hang on the cutter's own parent instead.
      let parentId: string = p.parent;
      for (let hops = 0; product.parts[parentId]?.csg && product.parts[parentId].parent && hops < 8; hops++) parentId = product.parts[parentId].parent!;
      const list = children.get(parentId) ?? [];
      list.push(p);
      children.set(parentId, list);
    }
    return { children, cutters };
  }, [product.parts]);

  // Exploded view: name tags on the main sub-assemblies, the root's biggest children. Parts not
  // measured yet (just added) rank last but still qualify; PartLabel hides any that turn out tiny.
  const labels = useMemo(() => {
    if (explode < 0.5) return NO_LABELS;
    const size = (id: string) => {
      const b = registry.boxes.get(id);
      return b && !b.isEmpty() ? b.getSize(new THREE.Vector3()).length() : 0.03;
    };
    // A root with only a carrier part or two (drone: body > belly > everything): look one level deeper.
    let pool = children.get(product.rootId) ?? [];
    if (pool.length < 4) pool = [...pool, ...pool.flatMap((p) => children.get(p.id) ?? [])];
    const top = pool.filter((p) => size(p.id) > 0.02);
    return new Set(top.sort((a, b) => size(b.id) - size(a.id)).slice(0, 12).map((p) => p.id));
  }, [explode, children, product.rootId, registry]);

  const ctx = useMemo<Ctx>(
    () => ({ product, children, cutters, selectedId, registry, animate, interactive, onHit, onHover, hovered, explode, labels }),
    [product, children, cutters, selectedId, registry, animate, interactive, onHit, onHover, explode, labels],
  );

  // Fit target, recomputed from transform data + geometry bounds whenever the product changes.
  const goal = useRef({ scale: 0, x: 0, y: 0, z: 0 });
  const dirty = useRef(true);
  const lastRoot = useRef("");
  useEffect(() => {
    dirty.current = true;
  }, [product]);
  useEffect(() => {
    registry.root = inner.current;
  }, [registry]);

  useFrame((st, dt) => {
    hullMaterial.uniforms.uResolution.value.set(st.size.width, st.size.height);
    hullMaterial.uniforms.uWidth.value = 3.6 + Math.sin(st.clock.elapsedTime * 3.2) * 1.0;
    hullMaterial.uniforms.uOpacity.value = 0.85 + Math.sin(st.clock.elapsedTime * 3.2) * 0.15;
    if (dirty.current) {
      const box = productBox(product, registry);
      if (box) {
        dirty.current = false;
        const size = box.getSize(new THREE.Vector3());
        // Tall things fit by height; wide things must also stay within the pedestal's footprint.
        const want = Math.min(fitSize / Math.max(size.y, 1e-4), (fitSize * 0.86) / Math.max(size.x, size.z, 1e-4));
        const g = goal.current;
        const newProduct = lastRoot.current !== product.rootId;
        lastRoot.current = product.rootId;
        if (!g.scale || newProduct || want / g.scale > 1.6 || want / g.scale < 0.8) g.scale = want;
        const c = box.getCenter(new THREE.Vector3());
        g.x = -c.x;
        g.z = -c.z;
        g.y = -box.min.y;
        if (newProduct && fit.current) fit.current.scale.setScalar(g.scale);
        const h = size.y * g.scale, w = Math.max(size.x, size.z) * g.scale;
        if (Math.abs(h - registry.fit.height) > 0.02 || Math.abs(w - registry.fit.width) > 0.02) {
          registry.fit = { version: registry.fit.version + 1, height: h, width: w };
        }
      }
    }
    const f = fit.current, i = inner.current, g = goal.current;
    if (!f || !i || !g.scale) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    const s = f.scale.x + (g.scale - f.scale.x) * k;
    f.scale.setScalar(s);
    f.position.y = floorY;
    i.position.x += (g.x - i.position.x) * k;
    i.position.y += (g.y - i.position.y) * k;
    i.position.z += (g.z - i.position.z) * k;
  });

  // Removed parts shrink away with a puff of sparkles instead of vanishing. The live objects are
  // still in the scene while this render runs, so snapshot them now (before React unmounts them).
  const prevProduct = useRef(product);
  const ghosts = useRef<{ obj: THREE.Object3D; t: number; base: THREE.Vector3 }[]>([]);
  if (prevProduct.current !== product) {
    const before = prevProduct.current;
    prevProduct.current = product;
    if (animate && inner.current && before.id === product.id && before.rootId === product.rootId) {
      const innerInv = inner.current.matrixWorld.clone().invert();
      for (const id of Object.keys(before.parts)) {
        if (product.parts[id] || before.parts[id].csg) continue;
        const parentId = before.parts[id].parent;
        if (parentId && !product.parts[parentId]) continue; // its removed parent carries it
        const g = registry.groups.get(id);
        if (!g) continue;
        g.updateWorldMatrix(true, true);
        const ghost = g.clone(true);
        ghost.traverse((o) => {
          o.raycast = () => {};
          if ((o as THREE.Mesh).userData.isHull) o.visible = false;
        });
        innerInv.clone().multiply(g.matrixWorld).decompose(ghost.position, ghost.quaternion, ghost.scale);
        ghosts.current.push({ obj: ghost, t: 0, base: ghost.scale.clone() });
        inner.current.add(ghost);
        const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
        fx.burst([c.x, c.y, c.z], 30, before.parts[id].material.color, 0.7);
        fx.burst([c.x, c.y, c.z], 16, "#F2D88A", 0.5);
      }
    }
  }
  useFrame((_s, dt) => {
    for (const gh of ghosts.current) {
      gh.t += dt / 0.32;
      const k = Math.max(0, 1 - gh.t);
      gh.obj.scale.copy(gh.base).multiplyScalar(k * k * (1 + 0.25 * Math.sin(gh.t * Math.PI)));
      if (gh.t >= 1) gh.obj.removeFromParent();
    }
    ghosts.current = ghosts.current.filter((gh) => gh.t < 1);
  });

  const root = product.parts[product.rootId];
  return (
    <ViewCtx.Provider value={ctx}>
      <group ref={fit}>
        <group ref={inner}>
          {root && <PartNode key={root.id} part={root} depth={0} />}
          {gizmo && selectedId && onTransform && product.parts[selectedId] && <Gizmo key={selectedId} id={selectedId} onCommit={onTransform} />}
        </group>
      </group>
    </ViewCtx.Provider>
  );
}

/** Product-space bounds from transform data and each part's geometry box. Null until all boxes exist. */
export function productBox(product: Product, registry: PartRegistry): THREE.Box3 | null {
  // Wait for the root; parts that can't render (failed, hidden) simply don't count.
  if (!registry.boxes.get(product.rootId)) return null;
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const p of Object.values(product.parts)) {
    if (p.csg) continue;
    const b = registry.boxes.get(p.id);
    if (!b) continue;
    if (b.isEmpty()) continue;
    box.union(tmp.copy(b).applyMatrix4(partMatrix(product, p.id)));
  }
  return box.isEmpty() ? null : box;
}

/** Each part's product-space center and size (meters), sent to the genie so it knows the layout. */
export function outlineOf(product: Product, registry: PartRegistry): { id: string; center: Vec3; size: Vec3 }[] {
  const out: { id: string; center: Vec3; size: Vec3 }[] = [];
  const tmp = new THREE.Box3();
  const c = new THREE.Vector3(), s = new THREE.Vector3();
  const r = (v: number) => Math.round(v * 1000) / 1000;
  for (const p of Object.values(product.parts)) {
    const b = registry.boxes.get(p.id);
    if (!b || b.isEmpty()) continue;
    tmp.copy(b).applyMatrix4(partMatrix(product, p.id));
    tmp.getCenter(c);
    tmp.getSize(s);
    out.push({ id: p.id, center: [r(c.x), r(c.y), r(c.z)], size: [r(s.x), r(s.y), r(s.z)] });
  }
  return out;
}

/** Real-world size (meters) of one part including its scale, or of the whole product (no id). */
export function sizeOf(product: Product, registry: PartRegistry, id?: string): Vec3 | null {
  if (!id) {
    const b = productBox(product, registry);
    if (!b) return null;
    const v = b.getSize(new THREE.Vector3());
    return [v.x, v.y, v.z];
  }
  const b = registry.boxes.get(id);
  if (!b || b.isEmpty()) return null;
  const v = b.clone().applyMatrix4(partMatrix(product, id)).getSize(new THREE.Vector3());
  return [v.x, v.y, v.z];
}

/** "32 × 45 × 15 cm" (or mm for tiny parts). */
export function formatSize(v: Vec3 | null): string {
  if (!v) return "";
  const max = Math.max(...v);
  if (max < 0.02) return v.map((x) => Math.max(1, Math.round(x * 1000))).join(" × ") + " mm";
  return v.map((x) => (x < 0.1 ? (Math.round(x * 1000) / 10).toString() : Math.round(x * 100).toString())).join(" × ") + " cm";
}
