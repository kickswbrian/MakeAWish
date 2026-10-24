import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MESH_MODELS, deformNormal, deformPoint, hasDeform, type DeformParams } from "@wishit/shared";
import { boxProjectUVs } from "./uv.ts";

/**
 * Prepared base meshes for fashion templates (kind "mesh" parts). Each model is one GLB whose
 * nodes are garment pieces already placed in the model frame (meters, Y up, +Z front). Fabric
 * presets tile in meters, so `uv` becomes the model's own UVs rescaled to 1 unit = 1 m (pattern-piece
 * UVs keep the weave running along the garment, unlike a box projection); the original 0..1 UVs move
 * to `uv1` for the model's baked fold/seam normal map when it has one.
 */

interface LoadedModel {
  nodes: Map<string, THREE.BufferGeometry>;
  /** The model's baked normal map (folds, seams), sampled with uv1. */
  foldNormal: THREE.Texture | null;
}

const models = new Map<string, LoadedModel>();
const pending = new Map<string, Promise<LoadedModel | null>>();
const listeners = new Set<() => void>();
let loader: GLTFLoader | null = null;

function gltf(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export function loadMeshModel(id: string): Promise<LoadedModel | null> {
  const ready = models.get(id);
  if (ready) return Promise.resolve(ready);
  let p = pending.get(id);
  if (p) return p;
  const spec = MESH_MODELS[id];
  if (!spec) return Promise.resolve(null);
  const fold = spec.fold ? loadFold(spec.fold) : Promise.resolve(null);
  p = Promise.all([gltf().loadAsync(spec.url), fold])
    .then(([g, foldNormal]) => {
      const nodes = new Map<string, THREE.BufferGeometry>();
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = floatGeometry(m.geometry);
        geo.applyMatrix4(m.matrixWorld);
        if (geo.attributes.uv) {
          geo.setAttribute("uv1", geo.attributes.uv.clone());
          meterUVs(geo);
        } else boxProjectUVs(geo);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        // Smooth tangents: without them three derives one per triangle from UV derivatives, and
        // anisotropic presets (satin) shatter into facets along the decimated mesh.
        if (geo.index) {
          geo.computeTangents();
          fixTangents(geo);
        }
        // The prep script's _FOLD (where the fold map applies) arrives as "_fold".
        const w = geo.attributes._fold;
        if (w) {
          geo.setAttribute("fold", w);
          geo.deleteAttribute("_fold");
        }
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        // Node names come from the prep script; a mesh under a named group takes the group's name.
        const name = m.name && spec.nodes.includes(m.name) ? m.name : m.parent?.name ?? m.name;
        const prev = nodes.get(name);
        nodes.set(name, prev ? mergeTwo(prev, geo) : geo);
      });
      const out = { nodes, foldNormal };
      models.set(id, out);
      for (const fn of listeners) fn();
      return out;
    })
    .catch((err) => {
      console.warn(`[mesh] failed to load ${id}`, err);
      return null;
    });
  pending.set(id, p);
  return p;
}

/**
 * A plain Float32 copy of a loaded geometry. Meshopt-compressed models arrive quantized (normalized
 * Int16 positions, interleaved, undone by the node's scale): baking the node matrix into those would
 * clamp everything past +-1 (a 1.1 m pair of jeans), so every attribute is dequantized first.
 */
/** Degenerate UV triangles give NaN tangents, and one NaN pixel turns the whole bloomed frame black. */
function fixTangents(geo: THREE.BufferGeometry): void {
  const t = geo.attributes.tangent as THREE.BufferAttribute | undefined, n = geo.attributes.normal;
  if (!t || !n) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < t.count; i++) {
    a.set(t.getX(i), t.getY(i), t.getZ(i));
    if (Number.isFinite(a.x + a.y + a.z + t.getW(i)) && a.lengthSq() > 1e-12) continue;
    b.set(n.getX(i), n.getY(i), n.getZ(i));
    a.set(Math.abs(b.y) < 0.9 ? 0 : 1, Math.abs(b.y) < 0.9 ? 1 : 0, 0).cross(b).normalize();
    t.setXYZW(i, a.x, a.y, a.z, 1);
  }
}

function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  return geo;
}

function loadFold(url: string): Promise<THREE.Texture | null> {
  return new THREE.TextureLoader()
    .loadAsync(url)
    .then((t) => {
      // Sampled with the model's glTF UVs (uv1): no flip, linear data, sharp at grazing angles.
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    })
    .catch(() => null);
}

/** Rescale UVs so one unit spans one meter of surface (from the mesh's 3D area over its UV area). */
function meterUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position, uv = geo.attributes.uv as THREE.BufferAttribute;
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area3 = 0, areaUV = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    area3 += b.sub(a).cross(c.sub(a)).length() / 2;
    const u0 = uv.getX(i0), v0 = uv.getY(i0), u1 = uv.getX(i1), v1 = uv.getY(i1), u2 = uv.getX(i2), v2 = uv.getY(i2);
    areaUV += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
  }
  if (areaUV < 1e-12) {
    boxProjectUVs(geo);
    return;
  }
  const k = Math.sqrt(area3 / areaUV);
  const out = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    out[i * 2] = uv.getX(i) * k;
    out[i * 2 + 1] = uv.getY(i) * k;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(out, 2));
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  // Rare (a node split into several primitives by the exporter): concatenate non-indexed.
  const na = a.index ? a.toNonIndexed() : a, nb = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const key of Object.keys(na.attributes)) {
    const x = na.attributes[key] as THREE.BufferAttribute, y = nb.attributes[key] as THREE.BufferAttribute | undefined;
    if (!y) continue;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(key, new THREE.BufferAttribute(arr, x.itemSize));
  }
  out.computeBoundingBox();
  return out;
}

/** Load every prepared model (at app start, behind the loading state). */
export function preloadMeshModels(): Promise<void> {
  return Promise.all(Object.keys(MESH_MODELS).map(loadMeshModel)).then(() => undefined);
}

/** Subscribe to model loads (parts waiting for their mesh re-render). */
export function onMeshModelLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function meshModelReady(id: string): boolean {
  return models.has(id);
}

/** The model's baked fold normal map, if it has one and this node carries fold weights. */
export function meshFoldNormal(asset: string): THREE.Texture | null {
  const [model, node] = asset.split("/");
  const loaded = models.get(model);
  return loaded?.foldNormal && loaded.nodes.get(node)?.attributes.fold ? loaded.foldNormal : null;
}

/**
 * A fresh geometry for a mesh part ("<model>/<node>") with its deformers applied, or null while the
 * model loads. The caller owns (and disposes) the returned geometry.
 */
export function meshGeometry(asset: string, params: DeformParams | undefined): THREE.BufferGeometry | null {
  const [model, node] = asset.split("/");
  const loaded = models.get(model);
  if (!loaded) {
    void loadMeshModel(model);
    return null;
  }
  const base = loaded.nodes.get(node);
  if (!base) return null;
  const geo = base.clone();
  if (params && hasDeform(params)) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i++) {
      const p: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (nrm) {
        const n = deformNormal(p, [nrm.getX(i), nrm.getY(i), nrm.getZ(i)], params);
        nrm.setXYZ(i, n[0], n[1], n[2]);
      }
      const q = deformPoint(p, params);
      pos.setXYZ(i, q[0], q[1], q[2]);
    }
    pos.needsUpdate = true;
    if (nrm) nrm.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  return geo;
}
