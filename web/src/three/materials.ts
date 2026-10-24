import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ProductSpec } from "@wishit/shared";
import { lookFor, morphK, patternTexture, type PatternKind } from "./shapes.ts";

/** Product material: color, fabric/finish look and pattern all ease toward the spec. */
export function useProductMaterial(spec: ProductSpec, fallback: string, flash: MutableRefObject<number>, base?: Partial<THREE.MeshPhysicalMaterialParameters>) {
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: spec.color ?? fallback, ...base }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const trim = useMemo(() => new THREE.MeshPhysicalMaterial({ roughness: 0.5 }), []);
  const color = useMemo(() => new THREE.Color(), []);
  color.set(spec.color ?? fallback);
  const look = lookFor(spec);
  usePattern(mat, spec.pattern);
  useFrame((_s, dt) => {
    const k = morphK(dt);
    mat.color.lerp(color, k);
    // A product with its own base roughness (the glossy helmet) keeps it unless fabric or finish says otherwise.
    const rough = base?.roughness !== undefined && !spec.fabric && !spec.finish ? base.roughness : look.roughness;
    mat.roughness += (rough - mat.roughness) * k;
    mat.metalness += (look.metalness - mat.metalness) * k;
    mat.sheen += (look.sheen - mat.sheen) * k;
    if (spec.finish || spec.fabric) mat.clearcoat += (Math.max(look.clearcoat, base?.clearcoat && !spec.finish ? base.clearcoat : 0) - mat.clearcoat) * k;
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = 0.03 + look.glow + flash.current * 0.9;
    trim.color.copy(mat.color).multiplyScalar(0.55);
    trim.emissive.copy(trim.color);
    trim.emissiveIntensity = look.glow * 0.6;
    flash.current = Math.max(0, flash.current - dt * 1.8);
  });
  const part = usePartMaterials(spec);
  return { mat, trim, part };
}

export function usePattern(mat: THREE.MeshPhysicalMaterial, pattern: ProductSpec["pattern"]) {
  const want = pattern && pattern !== "solid" ? (pattern as PatternKind) : null;
  if ((mat.map?.name || null) !== want) {
    mat.map = want ? patternTexture(want) : null;
    if (mat.map) mat.map.name = want!;
    mat.needsUpdate = true;
  }
}

/**
 * Per-part overrides: part(name, baseMaterial) returns the base material, or a copy of it tinted
 * with spec.parts[name].color. Copies follow the base's look every frame and ease to their color.
 */
export function usePartMaterials(spec: ProductSpec) {
  const cache = useRef(new Map<string, { name: string; mat: THREE.MeshPhysicalMaterial; base: THREE.Material; color: THREE.Color }>());
  useFrame((_s, dt) => {
    const k = morphK(dt);
    for (const e of cache.current.values()) {
      const want = spec.parts?.[e.name]?.color;
      if (!want) continue;
      e.color.set(want);
      const b = e.base as THREE.MeshPhysicalMaterial;
      e.mat.roughness = b.roughness ?? 0.5;
      e.mat.metalness = b.metalness ?? 0;
      e.mat.sheen = b.sheen ?? 0;
      e.mat.clearcoat = b.clearcoat ?? 0;
      e.mat.color.lerp(e.color, k);
      e.mat.emissive.copy(e.mat.color);
      e.mat.emissiveIntensity = b.emissiveIntensity ?? 0;
    }
  });
  return (name: string, base: THREE.Material): THREE.Material => {
    const want = spec.parts?.[name]?.color;
    if (!want) return base;
    const key = `${name}:${base.uuid}`;
    let e = cache.current.get(key);
    if (!e) {
      const mat = (base as THREE.MeshPhysicalMaterial).clone();
      mat.map = null;
      mat.color.set(want);
      e = { name, mat, base, color: new THREE.Color(want) };
      cache.current.set(key, e);
    }
    return e.mat;
  };
}

/** Eased per-part scale and visibility: attach the returned ref to the part's pivot group. */
export function usePartTransform(spec: ProductSpec, name: string, uniform = true) {
  const ref = useRef<THREE.Group>(null);
  const s = useRef(1);
  useFrame((_st, dt) => {
    const style = spec.parts?.[name];
    const target = style?.hidden ? 0 : uniform ? style?.scale ?? 1 : 1;
    s.current += (target - s.current) * morphK(dt);
    if (ref.current) {
      ref.current.visible = s.current > 0.02;
      ref.current.scale.setScalar(Math.max(0.0001, s.current));
    }
  });
  return ref;
}
