import type { ModuleCategory } from "../kit.ts";
import type { Part, PartMaterial } from "../product.ts";

/**
 * Fashion templates: a detailed base (garment pieces, bag body, earring frames) with parametric
 * controls (length, fit, leg shape...), named material slots, and named attachment zones that
 * detail modules (kit parts: zippers, pockets, stitching, trims, chains...) are placed on.
 *
 * Everything is real-world size in meters, Y up, +Z the front, like every other product.
 */

export type V3 = [number, number, number];

/** A parametric control with a few named settings ("length": cropped | regular | long). */
export interface ControlSpec {
  options: string[];
  default: string;
  description: string;
}

/**
 * A named attachment zone, in the frame of part `part`. Either a point (a pocket's center, an earlobe
 * hook) with the outward surface normal (+Z of a module mounted there) and up direction (+Y), or a
 * path along the surface (a seam, hem, placket edge, strap) with per-point normals.
 */
export interface Zone {
  part: string;
  /** Plain words for the prompt and spoken replies: "left chest", "front placket". */
  label: string;
  at?: V3;
  normal?: V3;
  up?: V3;
  path?: V3[];
  normals?: V3[];
  /** Room for a module here [width, height] in meters; sized modules (pockets, patches) shrink to fit. */
  room?: [number, number];
  /** Surface curvature radius around the zone's up axis (0 or missing = flat). Bendable panels follow it. */
  bend?: number;
}

/** A material slot: base parts that share one material (shell, lining, rib trim), changed together. */
export interface MaterialSlot {
  description: string;
  /** Base part ids in this slot (module-only slots like "hardware" list none). */
  parts: string[];
  default: PartMaterial;
  /**
   * A template-specific slot the style system doesn't know (a trucker's collar) takes the material of
   * the first of these slots the outfit sets: "shell", or "lining:sherpa,fleece" (only in those presets).
   */
  follows?: string[];
}

/**
 * One detail module placed on a zone. `zone` may be:
 *  - "chest_left": the zone itself;
 *  - "pocket_*": every zone matching (both sides of a pair);
 *  - "placket@0.3": a point at 30% along a path zone (point modules only);
 *  - "chest_left~0.01,-0.02": a point zone shifted 1 cm right, 2 cm down in its surface plane.
 * A point module on a path zone with params.count = n is placed n times, evenly along the path.
 */
export interface ModulePlacement {
  module: string;
  zone: string;
  params?: Record<string, number | string>;
  /** A slot name ("hardware", "thread", "shell"...) or an explicit material. */
  material?: string | PartMaterial;
  /** Part id (default: "<module>_<zone>"), and display name. */
  id?: string;
  name?: string;
}

export interface FashionTemplate {
  id: string;
  name: string;
  /** Product noun: "jacket", "jeans", "tote", "earrings". */
  category: string;
  /** Module compatibility class (see MODULE_CATEGORIES). */
  kind: ModuleCategory;
  keywords: string[];
  description: string;
  targetPriceUsd: number;
  controls: Record<string, ControlSpec>;
  slots: Record<string, MaterialSlot>;
  /** Base parts for these control values, with each slot's default material. */
  build(controls: Record<string, string>): Part[];
  /** Zones for these control values (they move when the garment is cropped, widened...). */
  zones(controls: Record<string, string>): Record<string, Zone>;
  /** The standard construction details every version has (seams, closures, labels). */
  modules: ModulePlacement[];
  /** How the stage presents it. */
  display: "form" | "hanger" | "stand" | "pedestal";
}

/** A complete outfit design: what the style compiler and the genie produce for a new wish. */
export interface OutfitSpec {
  template: string;
  controls?: Record<string, string>;
  /** Slot name -> material. Missing slots keep the template default. */
  materials?: Record<string, PartMaterial>;
  modules?: ModulePlacement[];
  /** Standard modules (by placement id) to leave out. */
  without?: string[];
  styles?: string[];
}
