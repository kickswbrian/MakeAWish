import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { memo, useEffect, useState } from "react";
import * as THREE from "three";
import { ENV_HDRI_URL, setStudioReflections, STUDIO_ENV_INTENSITY, STUDIO_ENV_ROTATION } from "./parts/materials.ts";

/** `?env=plain` leaves out the softboxes, for comparison. */
const PLAIN = typeof location !== "undefined" && new URLSearchParams(location.search).get("env") === "plain";

/**
 * Lighting for reflections. The scene gets the studio HDRI. Mirror-like finishes (polished metal,
 * gloss plastic) instead get a copy with product-photography softboxes baked in, so chrome picks up
 * crisp strip highlights and lit sweeps instead of the HDRI's even grey walls. That copy is
 * rendered into an offscreen scene and handed to those materials only: on matte surfaces and the
 * pedestal the big panels would just wash out the shading.
 *
 * Memoized: drei re-renders the cube (and its PMREM) whenever an Environment with children
 * re-renders, and the stage re-renders on every streamed patch.
 */
export const StudioEnvironment = memo(function StudioEnvironment() {
  return (
    <>
      <Environment files={ENV_HDRI_URL} environmentIntensity={STUDIO_ENV_INTENSITY} environmentRotation={[0, STUDIO_ENV_ROTATION, 0]} />
      {!PLAIN && <StudioReflections />}
    </>
  );
});

const StudioReflections = memo(function StudioReflections() {
  const [target] = useState(() => new THREE.Scene());
  useFrame(() => setStudioReflections(target.environment));
  useEffect(() => () => setStudioReflections(null), []);
  return (
    <Environment scene={target} files={ENV_HDRI_URL} resolution={512} frames={2}>
      {/* Placed in world terms (the materials rotate this map like the scene's); each faces the product. */}
      <group rotation={[0, -STUDIO_ENV_ROTATION, 0]}>
        {/* Overhead softbox: the long highlight along tops and shoulders. */}
        <Lightformer form="rect" intensity={2} color="#fff8ee" position={[0, 5, 0.01]} scale={[7, 1.8, 1]} />
        {/* Up and behind: what top faces (lids, caps, cylinder ends) reflect from a camera above. */}
        <Lightformer form="rect" intensity={1.1} color="#fffaf2" position={[0, 3.5, -4.5]} scale={[8, 3, 1]} />
        {/* Tall strips left and right: vertical highlights that define edges. */}
        <Lightformer form="rect" intensity={1.8} color="#fff4e6" position={[-5, 1.2, 1.5]} scale={[1.1, 6, 1]} />
        <Lightformer form="rect" intensity={1.3} color="#eef4ff" position={[5, 1.4, -1]} scale={[0.9, 6, 1]} />
        {/* A soft key panel front-left, matching the key light's direction. */}
        <Lightformer form="rect" intensity={1.1} color="#fff6ea" position={[-2.5, 2.8, 4]} scale={[2.4, 2.4, 1]} />
        {/* A white sweep on the floor in front: flat front faces reflect a soft lit gradient. */}
        <Lightformer form="rect" intensity={0.8} color="#ffffff" position={[0, -3.5, 3.5]} scale={[12, 7, 1]} />
      </group>
    </Environment>
  );
});
