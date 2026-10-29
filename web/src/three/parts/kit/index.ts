import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { isEnumParam, kitById } from "@wishit/shared/kit.ts";
import { getMaterial } from "../materials.ts";
import { type Builder, type KitPath, type Params, type Piece, M, clamp, contrastThread, luminance, paramKey, rbox, Acc } from "./core.ts";
import {
  buckleBelt, buckleSideRelease, buttonSewn, carabiner, cordLock, dRing, grommet, hinge, rivet, screw, snapButton, strapEnd, zipper, zipperPull,
} from "./fasteners.ts";
import { handleGrip, handleTelescoping, knob, rubberFoot, screwCap, wheel, wheelCaster } from "./mechanical.ts";
import { bulb, cameraLens, led, screen, solarPanel, speakerGrille, toggleSwitch, usbPort } from "./electronics.ts";
import { brandPatch, meshPocket, stitching } from "./textile.ts";
import { CLOSURE_BUILDERS } from "./closures.ts";
import { CONSTRUCTION_BUILDERS } from "./construction.ts";
import { TRIM_BUILDERS } from "./trims.ts";
import { POCKET_BUILDERS } from "./pockets.ts";
import { LABEL_BUILDERS } from "./labels.ts";
import { JEWELRY_BUILDERS } from "./jewelry.ts";
import { BAG_BUILDERS } from "./bag.ts";
import { DISPLAY_BUILDERS } from "./display.ts";

/**
 * The procedural kit library. Every part is built at real-world size (meters) in its mount frame
 * (see shared/kit.ts), cached by id + params, and returned as a fresh Group that reuses the cached
 * geometries. Meshes tagged userData.slot = "main" take the part's own material from the renderer.
 */

/** Thread / cord that contrasts with the part body, resolved per material at build time. */
const contrastCord = (m: PartMaterial) => getMaterial(luminance(m.color) > 0.45 ? M.cordGrey : { preset: "cotton", color: "#D9D6CE" });
const buttonThread = (m: PartMaterial) => getMaterial(contrastThread(m));

const BUILDERS: Record<string, Builder> = {
  zipper,
  zipper_pull: () => zipperPull(),
  buckle_side_release: () => buckleSideRelease(),
  buckle_belt: () => buckleBelt(),
  d_ring: () => dRing(),
  carabiner: () => carabiner(),
  handle_grip: handleGrip,
  handle_telescoping: handleTelescoping,
  wheel,
  wheel_caster: () => wheelCaster(),
  screw: () => screw(),
  button_sewn: (p) => buttonSewn(p, buttonThread),
  snap_button: () => snapButton(),
  hinge,
  strap_end: () => strapEnd(),
  screw_cap: screwCap,
  knob,
  rivet: () => rivet(),
  grommet: () => grommet(),
  cord_lock: () => cordLock(contrastCord),
  led: () => led(),
  speaker_grille: speakerGrille,
  usb_port: () => usbPort(),
  toggle_switch: () => toggleSwitch(),
  screen,
  solar_panel: solarPanel,
  camera_lens: cameraLens,
  rubber_foot: () => rubberFoot(),
  stitching,
  brand_patch: brandPatch,
  mesh_pocket: meshPocket,
  bulb: () => bulb(),
  // Detail modules (one file per family; see shared/modules).
  ...CLOSURE_BUILDERS,
  ...CONSTRUCTION_BUILDERS,
  ...TRIM_BUILDERS,
  ...POCKET_BUILDERS,
  ...LABEL_BUILDERS,
  ...JEWELRY_BUILDERS,
  ...BAG_BUILDERS,
  ...DISPLAY_BUILDERS,
};

/** Parts whose glowing element derives from the material; their housing (main) should not glow. */
const GLOW = new Set(["led", "screen", "bulb", "solar_panel"]);

export const KIT_BUILDER_IDS = Object.keys(BUILDERS);

/**
 * Catalog params: numbers clamped to min/max, default when missing or not a finite number. Enum
 * params ("style": "pearl") become the option's index; an unknown option falls back to the default.
 */
export function resolveKitParams(id: string, params: Record<string, unknown> | undefined): Params {
  const spec = kitById(id)?.params ?? {};
  const out: Params = {};
  for (const [k, s] of Object.entries(spec)) {
    const raw = params?.[k];
    if (isEnumParam(s)) {
      const want = typeof raw === "string" ? raw.trim().toLowerCase() : typeof raw === "number" ? s.options[Math.round(raw)] : undefined;
      const i = want ? s.options.indexOf(want) : -1;
      out[k] = i >= 0 ? i : Math.max(0, s.options.indexOf(s.default));
      continue;
    }
    const v = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    out[k] = Number.isFinite(v) ? clamp(v, s.min, s.max) : s.default;
  }
  return out;
}

/** Path kits are cached per path too (rounded to 0.1 mm). Kept small: paths change with every edit. */
const cache = new Map<string, Piece[]>();
const pathKey = (path: KitPath) => path.points.map((q) => q.map((v) => Math.round(v * 1e4)).join(",")).join(";") + (path.normals ? "n" + path.normals.map((q) => q.map((v) => Math.round(v * 100)).join(",")).join(";") : "");

function fallback(): Piece[] {
  return new Acc().add(rbox(0.02, 0.02, 0.01, 0.002, 3).translate(0, 0, 0.005), "main").finish();
}

function piecesFor(id: string, p: Params, path?: KitPath): Piece[] {
  const key = `${id}|${paramKey(p)}${path ? `|${pathKey(path)}` : ""}`;
  let pieces = cache.get(key);
  if (!pieces) {
    const b = BUILDERS[id];
    try {
      pieces = b ? b(p, path) : fallback();
    } catch (err) {
      console.error(`[kit] failed to build ${id}`, err);
      pieces = fallback();
    }
    cache.set(key, pieces);
    // Path kits are rebuilt whenever their path moves: forget the oldest ones (the meshes on screen
    // keep their geometry; it is only dropped from the cache).
    if (path && cache.size > 600) for (const k of cache.keys()) if (k.includes("|") && k.split("|").length > 2 && cache.delete(k) && cache.size <= 500) break;
  }
  return pieces;
}

/**
 * Build a kit part. Meshes with userData.slot === "main" get the part's own (animated, selectable)
 * material from the renderer; every other mesh keeps the finish the builder gave it.
 */
export function buildKit(id: string, params: Record<string, unknown>, mat: PartMaterial, path?: KitPath): THREE.Group {
  const p = resolveKitParams(id, params);
  const pieces = piecesFor(id, p, path);
  const g = new THREE.Group();
  g.name = `kit:${id}`;
  const mainMat = GLOW.has(id) ? { ...mat, emissive: undefined, emissiveIntensity: undefined } : mat;
  for (const pc of pieces) {
    let material: THREE.Material;
    if (pc.mat === "main") material = getMaterial(mainMat);
    else if (typeof pc.mat === "function") material = pc.mat(mat);
    else material = getMaterial(pc.mat);
    const mesh = new THREE.Mesh(pc.geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (pc.mat === "main") mesh.userData.slot = "main";
    g.add(mesh);
  }
  return g;
}

/** Triangle count of a kit part at the given params (for the lab / budgets). */
export function kitTriangles(id: string, params: Record<string, unknown> = {}, path?: KitPath): number {
  return piecesFor(id, resolveKitParams(id, params), path).reduce((n, pc) => n + pc.geo.attributes.position.count / 3, 0);
}
