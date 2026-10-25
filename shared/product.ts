import { z } from "zod";
import { KIT_IDS } from "./kit.ts";
import { MESH_MODELS } from "./meshes.ts";
import { svgOutline, thinPoints } from "./svgpath.ts";

/**
 * The product data model. A product is a flat map of parts with parent links; every edit is a patch.
 *
 * Conventions (shared with the renderer and the genie's system prompt):
 * - Units are meters, at real-world size. The renderer fits the product into the orb.
 * - Y is up, +Z faces the viewer (the product's front), X is to the viewer's right.
 * - transform.position is in the parent's local frame, relative to the parent's origin.
 * - transform.rotation is Euler XYZ in DEGREES. Scale multiplies the part and its children.
 * - roundedBox, sphere, cylinder, capsule and torus are centered on their origin.
 *   cylinder and capsule run along Y; torus lies in the XY plane (its hole faces +Z).
 * - lathe revolves [radius, y] points around the Y axis; y values are used as given.
 * - tube sweeps through [x, y, z] points given in the part's own frame.
 * - extrude takes an [x, y] outline in the XY plane and extrudes it along Z, centered on z = 0.
 * - A part with `csg` is an invisible cutter carved out of part `csg.withPartId`.
 * - kind "mesh" shows one named piece of a prepared base model (meshAsset = "<model>/<node>"),
 *   e.g. a jacket sleeve; kitParams drive its deformers (crop, fit) where the model has them.
 * - Path kits (stitching, zippers, chains, trims) follow kitPath, [x, y, z] points in the part's
 *   frame, with optional per-point surface normals in kitNormals.
 * - zone names the template attachment zone a detail part was placed on, so it can follow the
 *   garment when its controls change (cropped, oversized).
 */

export const MATERIAL_PRESETS = [
  "nylon", "leather", "canvas", "metal_brushed", "plastic_matte", "plastic_gloss", "rubber", "wood", "glass",
  "metal_polished", "ceramic", "cotton", "knit", "satin", "denim", "suede", "concrete", "marble", "cork",
  // Fashion fabrics, finishes and jewelry.
  "jersey", "rib_knit", "cable_knit", "fleece", "sherpa", "linen", "wool_suiting", "tweed", "corduroy", "velvet",
  "denim_light", "leather_pebbled", "patent_leather", "mesh_fabric", "lace", "gingham", "quilted", "pearl", "gem", "horn",
] as const;
export type MaterialPreset = (typeof MATERIAL_PRESETS)[number];

export const GEOMETRY_TYPES = ["roundedBox", "lathe", "tube", "extrude", "sphere", "cylinder", "capsule", "torus", "text"] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];

export const LIMITS = { parts: 160, points: 96, idLength: 40 } as const;

// ---------- Small schemas ----------

const num = z.coerce.number().refine(Number.isFinite, "not finite");
const clamp = (lo: number, hi: number) => num.transform((v) => Math.min(hi, Math.max(lo, v)));
const size = clamp(0.0005, 20);
const coord = clamp(-50, 50);
const vec3 = z.tuple([coord, coord, coord]);
const vec2 = z.tuple([coord, coord]);
const deg = (lo: number, hi: number, d: number) => clamp(lo, hi).default(d);
const count = (lo: number, hi: number) => clamp(lo, hi).transform(Math.round);

const pointList = <T extends z.ZodTypeAny>(p: T, min: number) => z.array(p).min(min).max(LIMITS.points);

export const GeometryParams = {
  roundedBox: z.object({
    width: size, height: size, depth: size,
    /** Corner radius. Defaults to 12% of the smallest side. */
    radius: clamp(0, 10).optional(),
  }),
  lathe: z.object({
    /** [radius, y] profile points, bottom to top. Start/end at radius 0 for a closed solid. */
    points: pointList(z.tuple([clamp(0, 20), coord]), 2),
    /** Sweep angle in degrees (360 = full revolution). */
    angle: deg(1, 360, 360),
    segments: count(3, 128).optional(),
    /** Keep the profile's corners sharp instead of smoothing a curve through the points. */
    sharp: z.boolean().default(false),
    /** Vertical ripples around the surface (skirt folds, pleats, fluted vases, ribbed bottles). */
    flutes: count(0, 96).optional(),
    /** Ripple depth as a fraction of the radius (0.02 subtle ribs, 0.08 soft folds). */
    fluteDepth: clamp(0, 0.3).optional(),
    /** Where ripples are strongest: "bottom" (folds flaring to a hem), "top", or "even". */
    fluteFade: z.enum(["even", "bottom", "top"]).optional(),
  }),
  tube: z.object({
    points: pointList(vec3, 2),
    /** Round cross-section radius (ignored for flat tubes except as half-thickness fallback). */
    radius: size,
    /** Flat strap: cross-section width. When set, radius is the half-thickness. */
    width: size.optional(),
    /** For flat straps: the direction the strap's wide face looks at. Default +Z. */
    faceNormal: vec3.optional(),
    closed: z.boolean().default(false),
    /** Straight segments between points instead of a smooth curve. */
    sharp: z.boolean().default(false),
  }),
  extrude: z.object({
    /** Outline in the XY plane, counter-clockwise. */
    shape: pointList(vec2, 3),
    holes: z.array(pointList(vec2, 3)).max(8).optional(),
    depth: size,
    /** Bevel size; rounds the edges. Default 15% of depth, capped. */
    bevel: clamp(0, 5).optional(),
    /** Treat the outline as a smooth closed curve through the points. */
    smooth: z.boolean().default(false),
    /**
     * An SVG path ("d") to draw instead of the shape: emblems, silhouettes, logos. Any units, y down;
     * drawn `width` meters wide and centered. Subpaths inside others are holes. `shape` is then filled
     * in from it (a coarse fallback).
     */
    svg: z.string().max(30000).optional(),
    width: size.optional(),
  }),
  sphere: z.object({
    radius: size,
    /** Vertical sweep in degrees from the top: 90 = upper hemisphere (a dome), 180 = full sphere. */
    angle: deg(1, 180, 180),
  }),
  cylinder: z.object({
    radiusTop: clamp(0, 20), radiusBottom: clamp(0, 20), height: size,
    /** Bevel/rounding of the rim edges. */
    bevel: clamp(0, 5).optional(),
    open: z.boolean().default(false),
    segments: count(3, 128).optional(),
  }),
  capsule: z.object({ radius: size, length: clamp(0, 20) }),
  torus: z.object({
    radius: size,
    tube: size,
    /** Arc in degrees (180 = a half ring, e.g. a handle). Starts at +X, sweeps through +Y. */
    arc: deg(1, 360, 360),
  }),
  /** Real lettering: the words in 3D letters, facing +Z, centered, extruded by depth along Z. */
  text: z.object({
    /** The words ("\n" breaks a line). */
    text: z.string().min(1).max(80),
    /** Capital-letter height in meters. */
    size,
    depth: size,
    font: z.enum(["sans", "serif", "round"]).default("sans"),
    bevel: clamp(0, 1).optional(),
    /** The most room it has, in meters: longer words shrink to fit. */
    width: size.optional(),
    /** Wrap around a round surface of this radius (a mug, a bottle), bending back toward -Z. */
    curve: size.optional(),
  }),
} satisfies Record<GeometryType, z.ZodTypeAny>;

export type GeometryOf<T extends GeometryType> = { type: T; params: z.infer<(typeof GeometryParams)[T]> };
export type Geometry = { [T in GeometryType]: GeometryOf<T> }[GeometryType];

export const GeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roundedBox"), params: GeometryParams.roundedBox }),
  z.object({ type: z.literal("lathe"), params: GeometryParams.lathe }),
  z.object({ type: z.literal("tube"), params: GeometryParams.tube }),
  z.object({ type: z.literal("extrude"), params: GeometryParams.extrude }),
  z.object({ type: z.literal("sphere"), params: GeometryParams.sphere }),
  z.object({ type: z.literal("cylinder"), params: GeometryParams.cylinder }),
  z.object({ type: z.literal("capsule"), params: GeometryParams.capsule }),
  z.object({ type: z.literal("torus"), params: GeometryParams.torus }),
  z.object({ type: z.literal("text"), params: GeometryParams.text }),
]) as unknown as z.ZodType<Geometry>;

const hex = z.string().transform((s, ctx) => {
  const h = normalizeHex(s);
  if (!h) {
    ctx.addIssue({ code: "custom", message: "bad color" });
    return z.NEVER;
  }
  return h;
});

export const MaterialSchema = z.object({
  preset: z.enum(MATERIAL_PRESETS).catch("plastic_matte"),
  color: hex,
  roughness: clamp(0, 1).optional(),
  metalness: clamp(0, 1).optional(),
  /** Glow color (lights, screens, LEDs). */
  emissive: hex.optional(),
  emissiveIntensity: clamp(0, 20).optional(),
  opacity: clamp(0.05, 1).optional(),
});
export type PartMaterial = z.infer<typeof MaterialSchema>;

export const TransformSchema = z.object({
  position: vec3.default([0, 0, 0]),
  rotation: z.tuple([clamp(-720, 720), clamp(-720, 720), clamp(-720, 720)]).default([0, 0, 0]),
  scale: z.tuple([clamp(0.01, 50), clamp(0.01, 50), clamp(0.01, 50)]).default([1, 1, 1]),
});
export type Transform = z.infer<typeof TransformSchema>;

export const PartId = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, LIMITS.idLength))
  .refine((s) => s.length > 0, "empty id");

const KitParam = z.union([z.number().finite(), z.boolean(), z.string().max(40)]);

export const PartSchema = z
  .object({
    id: PartId,
    name: z.string().trim().min(1).max(60).catch("Part"),
    kind: z.enum(["primitive", "kit", "mesh"]),
    geometry: GeometrySchema.optional(),
    kitAsset: z.string().optional(),
    /** Per-kit options, see the catalog (e.g. zipper length). */
    kitParams: z.record(KitParam).optional(),
    kitPath: z.array(vec3).min(2).max(LIMITS.points).optional(),
    kitNormals: z.array(vec3).max(LIMITS.points).optional(),
    meshAsset: z.string().max(80).optional(),
    zone: z.string().max(LIMITS.idLength).optional(),
    parent: PartId.nullable().default(null),
    transform: TransformSchema.default({}),
    material: MaterialSchema,
    csg: z.object({ op: z.literal("subtract"), withPartId: PartId }).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "primitive" && !p.geometry) ctx.addIssue({ code: "custom", message: "primitive part needs geometry" });
    if (p.kind === "kit" && !(p.kitAsset && KIT_IDS.has(p.kitAsset))) ctx.addIssue({ code: "custom", message: `unknown kit asset ${p.kitAsset}` });
    if (p.kind === "mesh" && !(p.meshAsset && MESH_MODELS[p.meshAsset.split("/")[0]]?.nodes.includes(p.meshAsset.split("/")[1] ?? ""))) {
      ctx.addIssue({ code: "custom", message: `unknown mesh asset ${p.meshAsset}` });
    }
  });

export type Part = {
  id: string;
  name: string;
  kind: "primitive" | "kit" | "mesh";
  geometry?: Geometry;
  kitAsset?: string;
  kitParams?: Record<string, number | boolean | string>;
  kitPath?: [number, number, number][];
  kitNormals?: [number, number, number][];
  meshAsset?: string;
  zone?: string;
  parent: string | null;
  transform: Transform;
  material: PartMaterial;
  csg?: { op: "subtract"; withPartId: string };
};

export interface Product {
  id: string;
  title: string;
  /** One-line description, used for the "does it exist" search and the campaign page. */
  description?: string;
  /** Short product noun ("backpack", "desk lamp"), used for maker matching and icons. */
  category?: string;
  /** What a shopper would type into a store search for this ("electric kettle tea infuser"). */
  searchQuery?: string;
  targetPriceUsd?: number;
  parts: Record<string, Part>;
  rootId: string;
  /** Set when the product was built from a fashion template: its id and control values (fit, length...). */
  fashion?: FashionState;
}

export interface FashionState {
  template: string;
  controls: Record<string, string>;
  styles?: string[];
  /** Current material of each template slot (shell, hardware...), so a slot change finds its parts. */
  slots?: Record<string, PartMaterial>;
}

export type Patch =
  | { op: "add"; part: Part }
  | { op: "update"; id: string; changes: PartChanges }
  | { op: "remove"; id: string };

/** Partial<Part>, where transform, material and geometry params merge instead of replacing. */
export type PartChanges = Partial<Omit<Part, "id" | "transform" | "material" | "geometry">> & {
  transform?: Partial<Transform>;
  material?: Partial<PartMaterial>;
  geometry?: { type?: GeometryType; params?: Record<string, unknown> };
};

export const ProductMetaSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  category: z.string().trim().max(40).optional(),
  // Truncated, not rejected: an over-long query must not drop the title and description with it.
  searchQuery: z.string().trim().transform((q) => q.slice(0, 80)).optional(),
  targetPriceUsd: z.coerce.number().positive().max(100000).optional(),
});
export type ProductMeta = z.infer<typeof ProductMetaSchema>;

// ---------- Product helpers ----------

export function emptyProduct(id = "draft"): Product {
  return { id, title: "Untitled wish", parts: {}, rootId: "" };
}

export const isEmpty = (p: Product) => !p.rootId || !p.parts[p.rootId];

export function childrenOf(p: Product, id: string | null): Part[] {
  return Object.values(p.parts).filter((x) => x.parent === id);
}

export function subtreeIds(p: Product, id: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => {
    out.push(cur);
    for (const c of childrenOf(p, cur)) walk(c.id);
  };
  if (p.parts[id]) walk(id);
  return out;
}

export function ancestors(p: Product, id: string): string[] {
  const out: string[] = [];
  let cur = p.parts[id]?.parent ?? null;
  while (cur && p.parts[cur] && !out.includes(cur)) {
    out.push(cur);
    cur = p.parts[cur].parent;
  }
  return out;
}

/** Parts in parent-before-child order (stable by insertion within a level). */
export function partsInOrder(p: Product): Part[] {
  const out: Part[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id) || !p.parts[id]) return;
    seen.add(id);
    out.push(p.parts[id]);
    for (const c of childrenOf(p, id)) walk(c.id);
  };
  if (p.rootId) walk(p.rootId);
  for (const id of Object.keys(p.parts)) walk(id);
  return out;
}

/** Common LLM slips, repaired before validation: flattened geometry params, a kit given as geometry. */
function repairPart(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const p = { ...(raw as Record<string, unknown>) };
  const g = p.geometry as Record<string, unknown> | undefined;
  if (g && typeof g === "object" && !g.params) {
    const { type, ...rest } = g;
    p.geometry = { type, params: rest };
  }
  if (!p.kind) p.kind = p.kitAsset ? "kit" : p.meshAsset ? "mesh" : "primitive";
  // An SVG drawing: derive the plain outline from it, so everything reading `shape` still works.
  const geo = p.geometry as { type?: unknown; params?: Record<string, unknown> } | undefined;
  if (geo?.type === "extrude" && geo.params && typeof geo.params.svg === "string") {
    const width = Number(geo.params.width) > 0 ? Number(geo.params.width) : 0.05;
    const drawn = svgOutline(geo.params.svg, width);
    if (drawn?.shapes.length) {
      const main = drawn.shapes[0];
      p.geometry = { ...geo, params: { ...geo.params, width, shape: thinPoints(main.outer, LIMITS.points), holes: main.holes.slice(0, 8).map((h) => thinPoints(h, LIMITS.points)), smooth: false } };
    }
  }
  if (!p.material || typeof p.material !== "object") p.material = { preset: "plastic_matte", color: typeof p.color === "string" ? p.color : "#C9CCD2" };
  return p;
}

/** Validate an untrusted part. Returns the cleaned part or the reason it was rejected. */
export function parsePart(raw: unknown): { part: Part } | { error: string } {
  const r = PartSchema.safeParse(repairPart(raw));
  if (!r.success) return { error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const part = r.data as Part;
  if (part.kind !== "primitive") delete part.geometry;
  if (part.kind !== "kit") {
    delete part.kitAsset;
    delete part.kitPath;
    delete part.kitNormals;
  }
  if (part.kind === "primitive") delete part.kitParams;
  if (part.kind !== "mesh") delete part.meshAsset;
  if (part.kitNormals && part.kitPath && part.kitNormals.length !== part.kitPath.length) delete part.kitNormals;
  if (!part.zone) delete part.zone;
  return { part };
}

function uniqueId(p: Product, base: string): string {
  if (!p.parts[base]) return base;
  for (let i = 2; ; i++) {
    const id = `${base.slice(0, LIMITS.idLength - 4)}_${i}`;
    if (!p.parts[id]) return id;
  }
}

function mergeChanges(part: Part, changes: PartChanges): unknown {
  const next: Record<string, unknown> = { ...part, ...changes, id: part.id };
  if (changes.transform) next.transform = { ...part.transform, ...changes.transform };
  if (changes.material) next.material = { ...part.material, ...changes.material };
  if (changes.geometry) {
    const sameType = !changes.geometry.type || changes.geometry.type === part.geometry?.type;
    next.geometry = sameType && part.geometry
      ? { type: part.geometry.type, params: { ...part.geometry.params, ...(changes.geometry.params ?? {}) } }
      : changes.geometry;
  }
  if (changes.kitParams) next.kitParams = { ...(part.kitParams ?? {}), ...changes.kitParams };
  return next;
}

export interface ApplyResult {
  product: Product;
  /** The patches as applied (ids and parents resolved), suitable for animation and undo. */
  applied: Patch[];
  rejected: { patch: unknown; reason: string }[];
}

/**
 * Apply patches in order. Never throws: invalid patches are rejected with a reason, the rest apply.
 * Adds that collide get a fresh id; a missing parent attaches to the root; removes take the subtree.
 */
export function applyPatches(product: Product, patches: unknown[]): ApplyResult {
  let p: Product = { ...product, parts: { ...product.parts } };
  const applied: Patch[] = [];
  const rejected: ApplyResult["rejected"] = [];
  const reject = (patch: unknown, reason: string) => rejected.push({ patch, reason });

  for (const raw of patches) {
    if (!raw || typeof raw !== "object") {
      reject(raw, "not an object");
      continue;
    }
    const patch = raw as Record<string, unknown>;
    if (patch.op === "add") {
      if (Object.keys(p.parts).length >= LIMITS.parts) {
        reject(raw, "part limit reached");
        continue;
      }
      const res = parsePart(patch.part);
      if ("error" in res) {
        reject(raw, res.error);
        continue;
      }
      const part = res.part;
      // Re-adding an existing id from the same stream is an update in disguise; keep both by renaming.
      part.id = uniqueId(p, part.id);
      if (!p.rootId || !p.parts[p.rootId]) {
        part.parent = null;
        p.rootId = part.id;
      } else if (!part.parent || !p.parts[part.parent]) {
        part.parent = p.rootId;
      }
      if (part.csg && !p.parts[part.csg.withPartId]) delete part.csg;
      p.parts[part.id] = part;
      applied.push({ op: "add", part });
    } else if (patch.op === "update") {
      const id = PartId.safeParse(patch.id);
      const cur = id.success ? p.parts[id.data] : undefined;
      if (!cur) {
        reject(raw, `no part ${String(patch.id)}`);
        continue;
      }
      const changes = (patch.changes && typeof patch.changes === "object" ? patch.changes : {}) as PartChanges;
      const res = parsePart(mergeChanges(cur, changes));
      if ("error" in res) {
        reject(raw, res.error);
        continue;
      }
      const next = res.part;
      // Re-parenting: refuse cycles and orphaning the root.
      if (cur.id === p.rootId) next.parent = null;
      else if (!next.parent || !p.parts[next.parent] || next.parent === cur.id || subtreeIds(p, cur.id).includes(next.parent)) next.parent = cur.parent;
      p.parts[cur.id] = next;
      applied.push({ op: "update", id: cur.id, changes });
    } else if (patch.op === "remove") {
      const id = PartId.safeParse(patch.id);
      if (!id.success || !p.parts[id.data]) {
        reject(raw, `no part ${String(patch.id)}`);
        continue;
      }
      if (id.data === p.rootId) {
        reject(raw, "cannot remove the root part");
        continue;
      }
      const gone = new Set(subtreeIds(p, id.data));
      for (const x of Object.values(p.parts)) if (x.csg && gone.has(x.csg.withPartId)) gone.add(x.id);
      for (const g of gone) delete p.parts[g];
      applied.push({ op: "remove", id: id.data });
    } else {
      reject(raw, `unknown op ${String(patch.op)}`);
    }
  }
  return { product: p, applied, rejected };
}

/** Validate a whole product from storage or the client. Bad parts are dropped, never thrown. */
export function parseProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const meta = ProductMetaSchema.safeParse({ title: r.title, description: r.description, category: r.category, searchQuery: r.searchQuery, targetPriceUsd: r.targetPriceUsd });
  const base: Product = {
    id: typeof r.id === "string" ? r.id.slice(0, 40) : "draft",
    title: (meta.success && meta.data.title) || "Untitled wish",
    ...(meta.success ? { description: meta.data.description, category: meta.data.category, searchQuery: meta.data.searchQuery, targetPriceUsd: meta.data.targetPriceUsd } : {}),
    parts: {},
    rootId: "",
  };
  const parts = r.parts && typeof r.parts === "object" ? Object.values(r.parts as Record<string, unknown>) : [];
  const rootId = typeof r.rootId === "string" ? r.rootId : "";
  const list = parts.slice(0, LIMITS.parts).filter((x): x is Record<string, unknown> & { id: string } => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
  const { product } = applyPatches(base, addOrder(list, rootId).map((part) => ({ op: "add", part })));
  const f = r.fashion as Partial<FashionState> | undefined;
  if (f && typeof f.template === "string" && f.controls && typeof f.controls === "object") {
    const controls: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.controls)) if (typeof v === "string") controls[k.slice(0, 30)] = v.slice(0, 30);
    const slots: Record<string, PartMaterial> = {};
    if (f.slots && typeof f.slots === "object") {
      for (const [k, v] of Object.entries(f.slots).slice(0, 16)) {
        const m = MaterialSchema.safeParse(v);
        if (m.success) slots[k.slice(0, 30)] = m.data;
      }
    }
    product.fashion = {
      template: f.template.slice(0, 40),
      controls,
      ...(Array.isArray(f.styles) ? { styles: f.styles.filter((x): x is string => typeof x === "string").slice(0, 4) } : {}),
      ...(Object.keys(slots).length ? { slots } : {}),
    };
  }
  return product;
}

/**
 * The order to add parts in: the root first, then every part after both its parent and the part it
 * cuts (a cutter added before its target would lose its `csg` link and render as a solid).
 */
export function addOrder<T extends { id: string; parent?: unknown; csg?: unknown }>(parts: T[], rootId: string): T[] {
  const byId = new Map(parts.map((x) => [x.id, x]));
  const deps = (x: T) => {
    const out: string[] = [];
    if (typeof x.parent === "string") out.push(x.parent);
    const target = (x.csg as { withPartId?: unknown } | undefined)?.withPartId;
    if (typeof target === "string") out.push(target);
    return out;
  };
  const ordered: T[] = [];
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const visit = (x: T) => {
    if (state.get(x.id)) return; // done, or a cycle: break it here
    state.set(x.id, 1);
    for (const d of deps(x)) {
      const dep = byId.get(d);
      if (dep) visit(dep);
    }
    state.set(x.id, 2);
    ordered.push(x);
  };
  // The root always comes first, whatever it points at (it becomes the root by being added first).
  const root = byId.get(rootId);
  if (root) {
    state.set(root.id, 2);
    ordered.push(root);
  }
  for (const x of parts) visit(x);
  return ordered;
}

export function setMeta(p: Product, meta: ProductMeta): Product {
  const m = ProductMetaSchema.safeParse(meta);
  if (!m.success) return p;
  const next = { ...p };
  for (const [k, v] of Object.entries(m.data)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  return next;
}

// ---------- Colors ----------

export function normalizeHex(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(s)) {
    const h = s.replace("#", "");
    return "#" + h.split("").map((c) => c + c).join("").toUpperCase();
  }
  if (/^#?[0-9a-f]{6}$/.test(s)) return "#" + s.replace("#", "").toUpperCase();
  return COLOR_NAMES[s] ?? null;
}

export const COLOR_NAMES: Record<string, string> = {
  emerald: "#1F8A5B", green: "#2E9E5B", "forest green": "#1E5631", "dark green": "#1E5631", mint: "#98E2C6", sage: "#9CAF88", olive: "#708238",
  teal: "#1E8C8C", turquoise: "#30C5C2", blue: "#3A6FD8", navy: "#1F2A55", "navy blue": "#1F2A55", "sky blue": "#7EC8F2", "light blue": "#9CCBF0", "baby blue": "#A9D3F2", cobalt: "#1D4FBF", "royal blue": "#2A4FC9",
  lavender: "#B9A3F0", purple: "#7B4FC9", lilac: "#C8A2C8", violet: "#7F3FBF", plum: "#7A2E5C",
  pink: "#F28DB2", "hot pink": "#FF3E9A", "pastel pink": "#F7C5D5", blush: "#F4C2C2", rose: "#E8798E", magenta: "#D6249F",
  red: "#D7263D", "bright red": "#E8202F", crimson: "#B0102D", burgundy: "#7A1F2B", maroon: "#6B1E2A", coral: "#FF7F6B",
  orange: "#F28C28", peach: "#FFB38A", rust: "#B7472A", terracotta: "#C9643B",
  yellow: "#F6D44A", mustard: "#D4A017", gold: "#E2B13C", golden: "#E2B13C", cream: "#F4EBD0", ivory: "#F6F1E1", beige: "#D9C6A5", sand: "#D8C3A0",
  tan: "#C8A27A", camel: "#BF8F5B", brown: "#7B4A2D", chocolate: "#4E2A1A", walnut: "#5C3A21", oak: "#B98B57",
  white: "#F4F4F2", "off white": "#F1EEE6", black: "#1A1A1D", "matte black": "#1E1E21", grey: "#8A8D93", gray: "#8A8D93", "light grey": "#C4C7CC", "light gray": "#C4C7CC",
  "dark grey": "#4A4D52", "dark gray": "#4A4D52", charcoal: "#3A3D42", silver: "#C0C4CC", "space grey": "#5B5E63", graphite: "#43464B",
  copper: "#B87333", bronze: "#A97142", chrome: "#D8DCE2", lime: "#A4D65E", "neon green": "#39FF88", "neon pink": "#FF4FB8",
};

/** Closest named color, for spoken replies and descriptions. */
export function colorName(hex: string): string {
  const target = hexToRgb(hex);
  let best = "";
  let bestD = Infinity;
  for (const [name, h] of Object.entries(COLOR_NAMES)) {
    const c = hexToRgb(h);
    const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain-language description of a product, for search queries and campaign pages. */
export function describeProduct(p: Product): string {
  if (p.description) return p.description;
  const root = p.parts[p.rootId];
  const color = root ? colorName(root.material.color) : "";
  const noun = p.category ?? p.title;
  const features = childrenOf(p, p.rootId).map((c) => c.name.toLowerCase()).slice(0, 4);
  return [color, noun].filter(Boolean).join(" ") + (features.length ? ` with ${features.join(", ")}` : "");
}
