import { kitById, type KitEntry } from "../kit.ts";
import { addOrder, applyPatches, emptyProduct, type FashionState, type Part, type PartChanges, type PartMaterial, type Patch, type Product } from "../product.ts";
import type { FashionTemplate, ModulePlacement, OutfitSpec, V3, Zone } from "./types.ts";

/**
 * Turns an outfit spec (template + controls + slot materials + detail modules on zones) into parts,
 * and moves zone-attached details when a garment's controls change. Pure data, shared by the
 * client (instant first build), the server (the genie's outfit tool) and tests.
 */

const FASHION = new Map<string, FashionTemplate>();

export function registerFashion(list: FashionTemplate[]): void {
  for (const t of list) FASHION.set(t.id, t);
}
export const fashionById = (id: string | undefined | null) => (id ? FASHION.get(id) : undefined);
export const fashionTemplates = () => [...FASHION.values()];

// ---------- Small vector math ----------

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v4 = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 1];
};

/** Surface frame at a point: outward normal (+Z), up along the surface (+Y), right (+X). */
function surfaceFrame(normal: V3, upHint: V3 = [0, 1, 0]): { right: V3; up: V3; normal: V3 } {
  const n = norm(normal);
  let up = sub(upHint, mul(n, dot(upHint, n)));
  if (len(up) < 1e-4) up = sub([0, 0, -1], mul(n, -n[2])); // looking straight up/down: "up" is the back
  up = norm(up);
  return { right: norm(cross(up, n)), up, normal: n };
}

/** Euler XYZ (degrees) of the rotation whose columns are right, up, normal (renderer: R = Rx Ry Rz). */
function eulerXYZ(right: V3, up: V3, normal: V3): V3 {
  const m13 = normal[0], m23 = normal[1], m33 = normal[2], m12 = up[0], m11 = right[0], m32 = up[2], m22 = up[1];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number, z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  const d = 180 / Math.PI;
  return [Math.round(x * d * 100) / 100, Math.round(y * d * 100) / 100, Math.round(z * d * 100) / 100];
}

/** Point and normal at fraction t (0..1, by arc length) along a path. */
function alongPath(path: V3[], normals: V3[] | undefined, t: number): { p: V3; n: V3 } {
  const seg: number[] = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + len(sub(path[i], path[i - 1])));
  const total = seg[seg.length - 1] || 1;
  const want = Math.max(0, Math.min(1, t)) * total;
  let i = 1;
  while (i < path.length - 1 && seg[i] < want) i++;
  const k = (want - seg[i - 1]) / Math.max(1e-9, seg[i] - seg[i - 1]);
  const p = add(path[i - 1], mul(sub(path[i], path[i - 1]), k));
  const n = normals?.length === path.length ? norm(add(mul(normals[i - 1], 1 - k), mul(normals[i], k))) : [0, 0, 1] as V3;
  return { p, n };
}

// ---------- Zone tokens ----------

interface ZoneRef {
  name: string;
  /** Fraction along a path zone. */
  t?: number;
  /** Offset in a point zone's surface plane [right, up], meters. */
  offset?: [number, number];
}

function parseZoneToken(token: string): ZoneRef {
  const at = token.indexOf("@");
  if (at > 0) return { name: token.slice(0, at), t: Number(token.slice(at + 1)) };
  const off = token.indexOf("~");
  if (off > 0) {
    const [dx, dy] = token.slice(off + 1).split(",").map(Number);
    return { name: token.slice(0, off), offset: [Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0] };
  }
  return { name: token };
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Zone names a placement's zone matches ("pocket_*" -> both pockets). */
function expandZone(token: string, zones: Record<string, Zone>): string[] {
  const ref = parseZoneToken(token);
  if (!ref.name.includes("*")) return zones[ref.name] ? [token] : [];
  const re = new RegExp("^" + ref.name.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  const suffix = token.slice(ref.name.length);
  return Object.keys(zones).filter((z) => re.test(z)).map((z) => z + suffix);
}

// ---------- Placement ----------

/** Most points a part's kitPath may carry (PartSchema); denser zone paths are resampled. */
const MAX_PATH = 96;

/** Keep at most `max` points of a path (evenly by index, ends kept, a closed path stays closed). */
function thinPath(path: V3[], normals: V3[] | undefined, max: number): { path: V3[]; normals?: V3[] } {
  const ok = normals?.length === path.length ? normals : undefined;
  if (path.length <= max) return { path, normals: ok };
  const pick = Array.from({ length: max }, (_, i) => Math.round((i * (path.length - 1)) / (max - 1)));
  return { path: pick.map((i) => path[i]), normals: ok && pick.map((i) => ok[i]) };
}

/** Where a kit part goes for a zone token: transform and (path kits) the path. */
export function placeOnZone(kit: KitEntry, zone: Zone, token: string): Pick<Part, "transform" | "kitPath" | "kitNormals"> | null {
  const ref = parseZoneToken(token);
  if (kit.path) {
    if (!zone.path || zone.path.length < 2) return null;
    const { path, normals } = thinPath(zone.path, zone.normals, MAX_PATH);
    return {
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      kitPath: path.map(v4),
      ...(normals ? { kitNormals: normals.map((n) => v4(norm(n))) } : {}),
    };
  }
  let p: V3, n: V3;
  if (zone.path && zone.path.length >= 2) {
    ({ p, n } = alongPath(zone.path, zone.normals, ref.t ?? 0.5));
  } else if (zone.at) {
    p = zone.at;
    n = zone.normal ?? [0, 0, 1];
  } else return null;
  const f = surfaceFrame(n, zone.up);
  if (ref.offset) p = add(p, add(mul(f.right, ref.offset[0]), mul(f.up, ref.offset[1])));
  return { transform: { position: v4(p), rotation: eulerXYZ(f.right, f.up, f.normal), scale: [1, 1, 1] } };
}

const DEFAULT_SLOT: Record<string, string[]> = {
  closure: ["hardware"],
  jewelry: ["metal", "hardware"],
  bag_hardware: ["hardware"],
  hardware: ["hardware"],
  construction: ["thread"],
  trim: ["trim", "shell"],
  pocket: ["shell"],
  label: ["label"],
};

/** A slot a template may not define, and the slots that stand in for it (a strap is like a handle). */
const SLOT_STAND_IN: Record<string, string[]> = {
  strap: ["strap", "handle", "shell"],
  handle: ["handle", "strap", "shell"],
  accent: ["accent", "trim", "shell"],
  trim: ["trim", "shell"],
  lining: ["lining", "shell"],
};

function moduleMaterial(kit: KitEntry, placement: ModulePlacement, slots: Record<string, PartMaterial>): PartMaterial {
  const m = placement.material;
  if (m && typeof m === "object") return { ...m };
  if (typeof m === "string" && slots[m]) return { ...slots[m] };
  // A kit that names its slot never falls to its family's default (a leather tassel isn't hardware).
  const order = kit.slot ? SLOT_STAND_IN[kit.slot] ?? [kit.slot] : DEFAULT_SLOT[kit.family ?? ""] ?? [];
  for (const s of order) if (slots[s]) return { ...slots[s] };
  return { preset: (kit.material as PartMaterial["preset"]) ?? "plastic_matte", color: slots.shell?.color ?? "#C9CCD2" };
}

const sanitizeId = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Kit params for a placement: the zone's room caps width/height, its curvature feeds "bend". */
function moduleParams(kit: KitEntry, zone: Zone, params: Record<string, number | string> | undefined): Record<string, number | string> {
  const out: Record<string, number | string> = { ...(params ?? {}) };
  delete out.count;
  delete out.inset;
  const spec = kit.params ?? {};
  if (zone.room) {
    if (spec.width && "max" in spec.width && out.width === undefined && spec.width.default > zone.room[0]) out.width = r4(zone.room[0]);
    if (spec.height && "max" in spec.height && out.height === undefined && spec.height.default > zone.room[1]) out.height = r4(zone.room[1]);
  }
  if (spec.bend && zone.bend && out.bend === undefined) out.bend = r4(zone.bend);
  return out;
}

const zoneBase = (token: string) => token.split(/[@~]/)[0];

/**
 * Whether a new placement of a module (at `tok`, spread along the zone or not) takes the place of a
 * detail of the same module already at `zone`: a spread set replaces every copy on that zone (five
 * buttons down the placket replace the four that were there); a single one replaces the copy at the
 * same spot (the same token, or within 4% along the same path).
 */
function supersedes(spread: boolean, tok: string, zone: string): boolean {
  const a = parseZoneToken(tok), b = parseZoneToken(zone);
  if (a.name !== b.name) return false;
  if (spread || zone === tok) return true;
  return a.t !== undefined && b.t !== undefined && Math.abs(a.t - b.t) < 0.04;
}

/**
 * Detail parts for a list of placements on a template's zones. Unknown modules, zones that don't
 * exist, and path modules on point zones are skipped (returned in `skipped`). A placement replaces
 * the same module already on its zone, earlier in the list or among `existing` parts (their ids are
 * returned in `replaced`), so details never double up.
 */
export function placeModules(
  t: FashionTemplate,
  zones: Record<string, Zone>,
  placements: ModulePlacement[],
  slots: Record<string, PartMaterial>,
  taken: Set<string> = new Set(),
  existing: Part[] = [],
): { parts: Part[]; skipped: { placement: ModulePlacement; reason: string }[]; replaced: string[] } {
  let parts: Part[] = [];
  const skipped: { placement: ModulePlacement; reason: string }[] = [];
  const replaced: string[] = [];
  const old = existing.filter((p) => p.kind === "kit" && p.zone);
  for (const pl of placements) {
    const kit = kitById(pl.module);
    if (!kit) {
      skipped.push({ placement: pl, reason: `unknown module ${pl.module}` });
      continue;
    }
    const tokens = expandZone(pl.zone, zones);
    if (!tokens.length) {
      skipped.push({ placement: pl, reason: `no zone ${pl.zone} on ${t.id}` });
      continue;
    }
    for (const token of tokens) {
      const ref = parseZoneToken(token);
      const zone = zones[ref.name];
      // A point module on a path zone with a count: spread copies along the path (buttons on a placket).
      const count = !kit.path && zone.path && ref.t === undefined ? Math.max(1, Math.min(12, Math.round(Number(pl.params?.count ?? 1)))) : 1;
      const inset = Math.max(0, Math.min(0.45, Number(pl.params?.inset ?? 0.08)));
      const spread = count > 1 || (!!kit.path && !!zone.path);
      const gone = (p: Part) => p.kitAsset === kit.id && !!p.zone && supersedes(spread, token, p.zone);
      parts = parts.filter((p) => !gone(p));
      for (const p of old) if (gone(p) && !replaced.includes(p.id)) replaced.push(p.id);
      for (let i = 0; i < count; i++) {
        const tok = count > 1 ? `${ref.name}@${fmt(inset + ((1 - 2 * inset) * i) / (count - 1))}` : token;
        const place = placeOnZone(kit, zone, tok);
        if (!place) {
          skipped.push({ placement: pl, reason: `${pl.module} can't go on ${ref.name}` });
          continue;
        }
        const base = sanitizeId(pl.id ?? `${pl.module}_${ref.name}`) || pl.module;
        let id = tokens.length > 1 && pl.id ? sanitizeId(`${pl.id}_${ref.name}`) : base;
        if (count > 1) id = `${base.slice(0, 36)}_${i + 1}`;
        for (let k = 2; taken.has(id); k++) id = `${base.slice(0, 36)}_${k}`;
        taken.add(id);
        const name = (pl.name ?? `${capital(zone.label)} ${kit.name.toLowerCase()}`) + (count > 1 ? ` ${i + 1}` : "");
        const kitParams = moduleParams(kit, zone, pl.params);
        parts.push({
          id,
          name: name.slice(0, 60),
          kind: "kit",
          kitAsset: kit.id,
          ...(Object.keys(kitParams).length ? { kitParams } : {}),
          parent: zone.part,
          ...place,
          material: moduleMaterial(kit, pl, slots),
          zone: tok.slice(0, 40),
        });
      }
    }
  }
  return { parts, skipped, replaced };
}

// ---------- Whole outfits ----------

export function resolveControls(t: FashionTemplate, controls?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, spec] of Object.entries(t.controls)) {
    const want = controls?.[k]?.toLowerCase().trim();
    out[k] = want && spec.options.includes(want) ? want : spec.default;
  }
  return out;
}

/** Slot materials: template defaults overridden by the spec. */
/** The material a following slot takes from the outfit's explicit slot materials, if any. */
function followed(follows: string[] | undefined, materials: Record<string, PartMaterial> | undefined): PartMaterial | undefined {
  for (const f of follows ?? []) {
    const [slot, presets] = f.split(":");
    const m = materials?.[slot];
    if (m && (!presets || presets.split(",").includes(m.preset))) return m;
  }
  return undefined;
}

export function resolveSlots(t: FashionTemplate, materials?: Record<string, PartMaterial>): Record<string, PartMaterial> {
  const out: Record<string, PartMaterial> = {};
  for (const [k, s] of Object.entries(t.slots)) {
    const m = materials?.[k] ?? followed(s.follows, materials);
    // A different fabric starts from its own preset tuning, not the default's (leather isn't fleece).
    const base = m?.preset && m.preset !== s.default.preset ? { preset: s.default.preset, color: s.default.color } : s.default;
    out[k] = { ...base, ...(m ?? {}) };
  }
  return out;
}

export interface CompiledOutfit {
  parts: Part[];
  fashion: FashionState;
  template: FashionTemplate;
  skipped: { placement: ModulePlacement; reason: string }[];
}

export function compileOutfit(spec: OutfitSpec): CompiledOutfit | null {
  const t = fashionById(spec.template);
  if (!t) return null;
  const controls = resolveControls(t, spec.controls);
  const slots = resolveSlots(t, spec.materials);
  const base = t.build(controls).map((p) => ({ ...p, material: { ...p.material } }));
  for (const [slot, def] of Object.entries(t.slots)) {
    for (const id of def.parts) {
      const part = base.find((p) => p.id === id);
      if (part) part.material = { ...slots[slot] };
    }
  }
  const zones = t.zones(controls);
  const without = new Set(spec.without ?? []);
  const standard = t.modules.filter((m) => !without.has(m.id ?? `${m.module}_${m.zone}`) && !without.has(m.module));
  const taken = new Set(base.map((p) => p.id));
  const { parts, skipped } = placeModules(t, zones, [...standard, ...(spec.modules ?? [])], slots, taken);
  return {
    parts: [...base, ...parts],
    fashion: { template: t.id, controls, slots, ...(spec.styles?.length ? { styles: spec.styles } : {}) },
    template: t,
    skipped,
  };
}

/** A whole product for an outfit spec (validated through the normal patch path). */
export function outfitProduct(spec: OutfitSpec, id = "draft"): Product | null {
  const c = compileOutfit(spec);
  if (!c) return null;
  const root = c.parts.find((p) => p.parent === null);
  const base = { ...emptyProduct(id), title: c.template.name, category: c.template.category, description: c.template.description, targetPriceUsd: c.template.targetPriceUsd };
  const product = applyPatches(base, addOrder(c.parts, root?.id ?? "").map((part) => ({ op: "add", part }))).product;
  product.fashion = c.fashion;
  return product;
}

/**
 * Patches that re-cut a fashion product for new control values ("make it cropped"): base pieces
 * change shape, and every detail placed on a zone moves with it. Materials and the shopper's own
 * additions are untouched.
 */
export function refitPatches(product: Product, controls: Record<string, string>): { patches: Patch[]; fashion: FashionState } | null {
  const t = fashionById(product.fashion?.template);
  if (!t || !product.fashion) return null;
  const next = resolveControls(t, { ...product.fashion.controls, ...controls });
  const oldBase = new Map(t.build(product.fashion.controls).map((p) => [p.id, p]));
  const newBase = t.build(next);
  const zones = t.zones(next);
  const patches: Patch[] = [];
  for (const p of newBase) {
    const cur = product.parts[p.id];
    if (!cur) {
      patches.push({ op: "add", part: p });
      continue;
    }
    const changes: Record<string, unknown> = {};
    if (JSON.stringify(cur.geometry) !== JSON.stringify(p.geometry) && p.geometry) changes.geometry = p.geometry;
    if (JSON.stringify(cur.transform) !== JSON.stringify(p.transform)) changes.transform = p.transform;
    if (p.kitParams && JSON.stringify(cur.kitParams ?? {}) !== JSON.stringify(p.kitParams)) changes.kitParams = p.kitParams;
    if (p.meshAsset && cur.meshAsset !== p.meshAsset) changes.meshAsset = p.meshAsset;
    if (p.kitPath && JSON.stringify(cur.kitPath) !== JSON.stringify(p.kitPath)) changes.kitPath = p.kitPath;
    if (Object.keys(changes).length) patches.push({ op: "update", id: p.id, changes: changes as PartChanges });
  }
  const keep = new Set(newBase.map((p) => p.id));
  for (const id of oldBase.keys()) if (!keep.has(id) && product.parts[id]) patches.push({ op: "remove", id });
  for (const part of Object.values(product.parts)) {
    if (!part.zone || part.kind !== "kit" || !part.kitAsset) continue;
    const kit = kitById(part.kitAsset);
    const zone = zones[parseZoneToken(part.zone).name];
    if (!kit || !zone) continue;
    const place = placeOnZone(kit, zone, part.zone);
    if (!place) continue;
    const changes: Record<string, unknown> = {};
    if (JSON.stringify(place.transform) !== JSON.stringify(part.transform)) changes.transform = place.transform;
    if (place.kitPath && JSON.stringify(place.kitPath) !== JSON.stringify(part.kitPath)) {
      changes.kitPath = place.kitPath;
      if (place.kitNormals) changes.kitNormals = place.kitNormals;
    }
    if (Object.keys(changes).length) patches.push({ op: "update", id: part.id, changes: changes as PartChanges });
  }
  return { patches, fashion: { ...product.fashion, controls: next } };
}

/**
 * Patches that change one material slot ("make the hardware gold"): the slot's base parts, plus
 * every part still wearing the slot's current material (so a part the shopper restyled keeps its
 * own look).
 */
export function slotPatches(product: Product, slot: string, material: Partial<PartMaterial>): { patches: Patch[]; fashion: FashionState } | null {
  const t = fashionById(product.fashion?.template);
  if (!t || !product.fashion || !t.slots[slot]) return null;
  const cur = product.fashion.slots?.[slot] ?? t.slots[slot].default;
  const next: PartMaterial = { ...cur, ...material };
  const same = (a: PartMaterial, b: PartMaterial) => a.preset === b.preset && a.color.toUpperCase() === b.color.toUpperCase();
  const base = new Set(t.slots[slot].parts);
  const patches: Patch[] = [];
  for (const part of Object.values(product.parts)) {
    if (part.csg) continue;
    if (base.has(part.id) || same(part.material, cur)) patches.push({ op: "update", id: part.id, changes: { material: { ...material } } });
  }
  return { patches, fashion: { ...product.fashion, slots: { ...(product.fashion.slots ?? {}), [slot]: next } } };
}

/** The zones of a product's fashion template, for tap-to-edit ("add a bow here") and the prompt. */
export function productZones(product: Product): Record<string, Zone> | null {
  const t = fashionById(product.fashion?.template);
  return t && product.fashion ? t.zones(product.fashion.controls) : null;
}
