import { useEffect } from "react";

/**
 * Tiny mutable channels between the voice/UI layer and the render loop. The canvas reads them in
 * useFrame, so mic levels never cause React re-renders.
 */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export const orbSignal = { state: "idle" as OrbState, level: 0 };

/** Drive the orb from React: state as a prop, level as a 0..1 number (or write orbSignal.level per frame). */
export function useOrbState(state: OrbState, level?: number) {
  useEffect(() => {
    orbSignal.state = state;
  }, [state]);
  if (level !== undefined) orbSignal.level = level;
}

export type Vec3 = [number, number, number];
export interface Bounds { y0: number; y1: number; r: number }

export interface FxApi {
  burst(center: Vec3, count: number, color: string, speed?: number): void;
  band(b: Bounds, count: number, color: string): void;
  assemble(from: Vec3, b: Bounds, count: number, color: string, duration?: number): void;
  inward(center: Vec3, radius: number, count: number, color: string): void;
}

let impl: FxApi | null = null;
export function setFxImpl(api: FxApi | null) {
  impl = api;
}
/** Particle effects. Calls before the canvas mounts are dropped, which is fine for decoration. */
export const fx: FxApi = {
  burst: (...a) => impl?.burst(...a),
  band: (...a) => impl?.band(...a),
  assemble: (...a) => impl?.assemble(...a),
  inward: (...a) => impl?.inward(...a),
};
