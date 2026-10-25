import { z } from "zod";
import { MODULE_CATEGORIES, type ModuleCategory } from "../kit.ts";
import { MATERIAL_PRESETS, normalizeHex, type MaterialPreset, type PartMaterial } from "../product.ts";
import raw from "./styles.json";

/**
 * The aesthetic dictionary: what "cute", "cozy", "downtown girl" or "officewear" mean as concrete
 * design choices (fabric presets per garment kind, a named palette, control preferences, a hardware
 * finish, signature detail modules on zones, and things to avoid). Shared by the local style
 * compiler (instant first build) and Claude's cached system prompt (stylePromptBlock).
 *
 * The data lives in styles.json so it can be tuned without touching code; it is validated here.
 */

// ---------- Vocabulary ----------

/** Detail module ids the dictionary may reference (the fashion kit families). */
export const STYLE_MODULE_IDS = [
  // closures
  "zipper_path", "button", "drawstring", "hook_eye", "lacing", "snap_button", "buckle_belt", "d_ring",
  // construction
  "topstitch", "bar_tack", "jeans_rivet", "dart", "pleats", "seam_welt",
  // trims
  "rib_band", "ruffle", "lace_trim", "bow", "piping", "ruching", "fringe", "scallop_edge", "pompom", "sherpa_band", "puff_band",
  // pockets
  "patch_pocket", "welt_pocket", "cargo_pocket", "coin_pocket", "slash_pocket", "jeans_back_pocket", "flap",
  // labels
  "woven_label", "leather_patch", "embroidery", "print_graphic", "hang_tag", "brand_patch",
  // jewelry
  "hoop", "huggie", "stud", "gem", "pearl", "chain", "ear_wire", "drop", "charm", "clasp", "ear_back",
  // bag hardware
  "turn_lock", "foot_stud", "chain_strap", "handle_wrap", "edge_paint", "swivel_hook", "o_ring", "magnetic_snap", "logo_plate", "tassel",
  "bag_charm", "strap_keeper", "zip_puller",
] as const;
const MODULE_SET = new Set<string>(STYLE_MODULE_IDS);

/** Template zone names (see the fashion brief); placements may use "name_*", "name@0.3", "name~dx,dy". */
export const ZONE_NAMES = [
  "chest_left", "chest_right", "chest_center", "hip_left", "hip_right", "back_center", "back_yoke", "collar", "neckline", "placket", "hem",
  "cuff_left", "cuff_right", "sleeve_left", "sleeve_right", "shoulder_left", "shoulder_right", "side_seam_left", "side_seam_right",
  "armhole_left", "armhole_right", "neck_label", "waist",
  "waistband", "waistband_top", "fly", "belt_loops", "pocket_front_left", "pocket_front_right", "coin_pocket", "pocket_back_left",
  "pocket_back_right", "outseam_left", "outseam_right", "inseam_left", "inseam_right", "hem_left", "hem_right", "thigh_left", "thigh_right",
  "knee_left", "knee_right", "back_patch", "yoke_back",
  "front_center",
  "front_panel", "back_panel", "flap_edge", "top_edge", "handle_left", "handle_right", "strap_anchor_left", "strap_anchor_right",
  "base_corners", "side_left", "side_right", "zip_top", "edge_front", "edge_back",
  "earlobe", "drop_point", "face", "hoop_front",
] as const;
const ZONE_SET = new Set<string>(ZONE_NAMES);

/** Template material slots. */
export const SLOT_NAMES = ["shell", "lining", "trim", "hardware", "thread", "label", "metal", "stone", "strap", "handle", "accent"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * Control option names the dictionary uses; templates adopt the same names. A template that spells
 * one differently is matched through CONTROL_SYNONYMS ("thin" earrings = "fine").
 */
export const CONTROL_VOCAB: Record<string, string[]> = {
  fit: ["fitted", "regular", "oversized"],
  length: ["cropped", "regular", "long", "mini", "midi", "maxi"],
  leg: ["skinny", "straight", "wide", "baggy", "flare"],
  rise: ["low", "mid", "high"],
  flare: ["straight", "a_line", "full"],
  size: ["mini", "small", "medium", "large"],
  shape: ["structured", "slouchy"],
  style: ["hoop", "huggie", "stud", "drop", "statement"],
  thickness: ["thin", "regular", "chunky"],
};

/** Interchangeable option names, tried in order when a template lacks the preferred spelling. */
export const CONTROL_SYNONYMS: Record<string, string[]> = {
  thin: ["fine", "delicate", "slim"],
  fine: ["thin", "delicate"],
  chunky: ["thick", "bold"],
  oversized: ["relaxed", "loose", "boxy"],
  fitted: ["slim", "tailored"],
  baggy: ["relaxed", "wide", "loose"],
  wide: ["wide_leg", "palazzo"],
  flare: ["flared", "bootcut"],
  a_line: ["aline", "a-line"],
  full: ["circle", "flared"],
  cropped: ["crop", "short"],
  long: ["longline", "maxi"],
  maxi: ["long", "ankle"],
  mini: ["short", "small"],
  midi: ["knee", "regular"],
  regular: ["midi", "medium", "straight"],
  large: ["big", "oversized", "statement"],
  small: ["mini", "petite"],
  statement: ["drop", "large"],
  structured: ["boxy"],
  slouchy: ["soft", "hobo"],
};

/** Hardware finishes and the concrete material each one means. */
export const HARDWARE_FINISHES = ["gold", "silver", "rose_gold", "gunmetal", "black", "tortoise", "brass"] as const;
export type HardwareFinish = (typeof HARDWARE_FINISHES)[number];
export const HARDWARE: Record<HardwareFinish, PartMaterial> = {
  gold: { preset: "metal_polished", color: "#D4AF5A", roughness: 0.22 },
  silver: { preset: "metal_polished", color: "#CDD1D6", roughness: 0.2 },
  rose_gold: { preset: "metal_polished", color: "#D8A28C", roughness: 0.22 },
  gunmetal: { preset: "metal_brushed", color: "#55575C", roughness: 0.35 },
  black: { preset: "metal_brushed", color: "#26262A", roughness: 0.5 },
  tortoise: { preset: "horn", color: "#6A3D1E" },
  brass: { preset: "metal_brushed", color: "#B08D57", roughness: 0.32 },
};

/** Fabric lists: garment kinds plus the secondary slots a style has an opinion on. */
export const FABRIC_KEYS = ["top", "outerwear", "bottom", "skirt", "dress", "bag", "jewelry", "lining", "trim", "strap", "stone"] as const;
export type FabricKey = (typeof FABRIC_KEYS)[number];

/** Which palette role a slot takes its color from ("tonal"/"contrast" are for thread). */
export const TONES = ["main", "secondary", "accent", "neutral", "tonal", "contrast"] as const;
export type Tone = (typeof TONES)[number];

// ---------- Schema ----------

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "hex like #A1B2C3");
const Preset = z.enum(MATERIAL_PRESETS);
const Colors = z.record(z.string(), Hex);

const zoneOk = (token: string) => {
  const name = token.split(/[@~]/)[0];
  if (name.includes("*")) {
    const re = new RegExp("^" + name.replace(/\*/g, ".*") + "$");
    return ZONE_NAMES.some((z) => re.test(z));
  }
  return ZONE_SET.has(name);
};
const ZoneToken = z.string().refine(zoneOk, (s) => ({ message: `unknown zone ${s}` }));

const SlotMaterial = z.union([
  z.enum(SLOT_NAMES),
  z.object({ preset: Preset, color: Hex, roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional() }),
]);

const StyleModuleSchema = z.object({
  module: z.string().refine((m) => MODULE_SET.has(m), (m) => ({ message: `unknown module ${m}` })),
  /** One zone, or alternatives in order of preference (the first the template has wins). */
  zone: z.union([ZoneToken, z.array(ZoneToken).min(1)]),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  material: SlotMaterial.optional(),
  /** Garment kinds this detail belongs on (default: any kind the module's zones exist on). */
  kinds: z.array(z.enum(MODULE_CATEGORIES)).optional(),
  /** A closure that replaces the template's standard closure on the same zone (buttons for a zip). */
  replace: z.boolean().optional(),
});

const ColorRef = z.string().refine((c) => normalizeHex(c) !== null, (c) => ({ message: `unknown color ${c}` }));

const StyleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  aliases: z.array(z.string().min(2)).min(1),
  vibe: z.string().min(10).max(220),
  palette: z.object({ main: Colors, secondary: Colors.default({}), accent: Colors.default({}), neutrals: Colors.default({}) }),
  fabrics: z.record(z.enum(FABRIC_KEYS), z.array(Preset).min(1)),
  /** Colors for fabrics with a natural color of their own (black denim, light wash). */
  fabricColors: z.record(Preset, Hex).optional(),
  /** Control name -> options in order of preference; "kind.control" overrides for one kind ("jewelry.size"). */
  controls: z.record(z.string(), z.array(z.string()).min(1)),
  hardware: z.enum(HARDWARE_FINISHES),
  /** Contrast thread color (used when tones.thread is "contrast"). */
  thread: Hex.optional(),
  tones: z.record(z.enum(SLOT_NAMES), z.enum(TONES)).default({}),
  modules: z.array(StyleModuleSchema),
  accessories: z.array(z.string()).default([]),
  avoid: z
    .object({
      modules: z.array(z.string().refine((m) => MODULE_SET.has(m), (m) => ({ message: `unknown module ${m}` }))).default([]),
      fabrics: z.array(Preset).default([]),
      colors: z.array(ColorRef).default([]),
      controls: z.record(z.string(), z.array(z.string())).default({}),
    })
    .default({}),
});

export type StyleModule = z.infer<typeof StyleModuleSchema>;
export type StyleEntry = z.infer<typeof StyleSchema>;
export type StyleMaterialRef = NonNullable<StyleModule["material"]>;
export interface NamedColor {
  name: string;
  hex: string;
}

/**
 * Validates the raw dictionary. Tests assert `errors` is empty; at runtime bad entries are dropped
 * (with a warning) so one typo never takes the style system down.
 */
export function validateStyles(data: unknown): { styles: StyleEntry[]; errors: string[] } {
  const errors: string[] = [];
  const list = (data as { styles?: unknown })?.styles;
  if (!Array.isArray(list)) return { styles: [], errors: ["styles.json: missing styles array"] };
  const styles: StyleEntry[] = [];
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const [i, entry] of list.entries()) {
    const r = StyleSchema.safeParse(entry);
    const label = (entry as { id?: string })?.id ?? `#${i}`;
    if (!r.success) {
      errors.push(...r.error.issues.map((e) => `${label}.${e.path.join(".")}: ${e.message}`));
      continue;
    }
    if (ids.has(r.data.id)) {
      errors.push(`${label}: duplicate id`);
      continue;
    }
    for (const a of r.data.aliases) {
      const key = normPhrase(a);
      const owner = aliasOwner.get(key);
      if (owner && owner !== r.data.id) errors.push(`${label}: alias "${a}" also belongs to ${owner}`);
      aliasOwner.set(key, r.data.id);
    }
    ids.add(r.data.id);
    styles.push(r.data);
  }
  return { styles, errors };
}

const loaded = validateStyles(raw);
if (loaded.errors.length) console.warn(`[styles] dropped invalid style data:\n  ${loaded.errors.join("\n  ")}`);

export const STYLES: StyleEntry[] = loaded.styles;
export const STYLE_ERRORS: string[] = loaded.errors;
const BY_ID = new Map(STYLES.map((s) => [s.id, s]));
export const styleById = (id: string): StyleEntry | undefined => BY_ID.get(id);

// ---------- Detection ----------

/** Lowercase words separated by single spaces ("Clean-Girl!" -> "clean girl"). */
export function normPhrase(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

let aliasIndex: { re: RegExp; owner: Map<string, string> } | null = null;
function aliases() {
  if (aliasIndex) return aliasIndex;
  const owner = new Map<string, string>();
  for (const s of STYLES) for (const a of s.aliases) if (!owner.has(normPhrase(a))) owner.set(normPhrase(a), s.id);
  // Longest phrase first so "coastal cowgirl" beats "coastal" and "business casual" beats "business".
  const phrases = [...owner.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![a-z0-9])(?:${phrases.join("|")})(?![a-z0-9])`, "g");
  aliasIndex = { re, owner };
  return aliasIndex;
}

/** Style ids a wish mentions, in the order they're first said ("cozy officewear" -> cozy, officewear). */
export function findStyles(text: string): string[] {
  const { re, owner } = aliases();
  const t = normPhrase(text);
  const out: string[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const id = owner.get(m[0]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// ---------- Merging ----------

export interface MergedStyle {
  ids: string[];
  vibe: string;
  palette: { main: NamedColor[]; secondary: NamedColor[]; accent: NamedColor[]; neutrals: NamedColor[] };
  fabrics: Partial<Record<FabricKey, MaterialPreset[]>>;
  fabricColors: Partial<Record<MaterialPreset, string>>;
  controls: Record<string, string[]>;
  hardware?: HardwareFinish;
  thread?: string;
  tones: Partial<Record<SlotName, Tone>>;
  /** Signature modules, highest priority first, tagged with the style they came from. */
  modules: (StyleModule & { style: string })[];
  accessories: string[];
  avoid: { modules: string[]; fabrics: MaterialPreset[]; colors: string[]; controls: Record<string, string[]> };
}

const ROLES = ["main", "secondary", "accent", "neutrals"] as const;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Close enough to count as the same color for an avoid rule (avoid "black" also bans #1C1C1F). */
export function nearColor(a: string, b: string): boolean {
  const x = rgb(a), y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 40;
}
const vetoed = (set: Set<string>, hex: string) => [...set].some((c) => nearColor(c, hex));

/**
 * Combines styles in priority order. The FIRST style wins every conflict; later styles only add
 * what doesn't clash:
 *  - palette roles, fabric lists, control preference lists: concatenated in order (first style's
 *    entries first, duplicates dropped), so the first style's choice is used whenever the template
 *    supports it and later styles are fallbacks;
 *  - hardware, contrast thread, each slot tone and each fabricColor: the first style that sets it;
 *  - signature modules: all of the first style's, then later styles' in order (zone clashes are
 *    settled by the compiler in this order, so the earlier style keeps the zone);
 *  - avoid: an earlier style vetoes later styles' modules, fabrics, colors and control options
 *    (they are dropped from the merge), but a later style can't veto an earlier style's choices:
 *    the merged avoid is the union minus anything an earlier style explicitly uses.
 * So "cozy officewear" is cozy (cable knit, oversized, rib cuffs, horn buttons) with officewear's
 * non-conflicting extras (welt/flap pockets, woven label, structure where cozy has no opinion), and
 * "officewear cozy" is a tailored wool look that borrows cozy's knit only where officewear has none.
 */
export function mergeStyles(ids: string[]): MergedStyle {
  const styles = ids.map(styleById).filter((s): s is StyleEntry => !!s);
  const out: MergedStyle = {
    ids: styles.map((s) => s.id),
    vibe: styles.map((s) => s.vibe).join(" "),
    palette: { main: [], secondary: [], accent: [], neutrals: [] },
    fabrics: {},
    fabricColors: {},
    controls: {},
    tones: {},
    modules: [],
    accessories: [],
    avoid: { modules: [], fabrics: [], colors: [], controls: {} },
  };
  const veto = { modules: new Set<string>(), fabrics: new Set<string>(), colors: new Set<string>(), controls: new Map<string, Set<string>>() };
  for (const s of styles) {
    for (const role of ROLES) {
      for (const [name, hex] of Object.entries(s.palette[role])) {
        const h = hex.toUpperCase();
        if (vetoed(veto.colors, h) || out.palette[role].some((c) => c.hex === h)) continue;
        out.palette[role].push({ name, hex: h });
      }
    }
    for (const k of FABRIC_KEYS) {
      const list = s.fabrics[k];
      if (!list) continue;
      const cur = (out.fabrics[k] ??= []);
      for (const f of list) if (!veto.fabrics.has(f) && !cur.includes(f)) cur.push(f);
    }
    for (const [f, hex] of Object.entries(s.fabricColors ?? {}) as [MaterialPreset, string][]) out.fabricColors[f] ??= hex.toUpperCase();
    for (const [k, list] of Object.entries(s.controls)) {
      const banned = veto.controls.get(k.split(".").pop() ?? k);
      const cur = (out.controls[k] ??= []);
      for (const o of list) if (!banned?.has(o) && !cur.includes(o)) cur.push(o);
    }
    out.hardware ??= s.hardware;
    out.thread ??= s.thread?.toUpperCase();
    for (const [slot, tone] of Object.entries(s.tones) as [SlotName, Tone | undefined][]) if (tone) out.tones[slot] ??= tone;
    for (const m of s.modules) if (!veto.modules.has(m.module)) out.modules.push({ ...m, style: s.id });
    for (const a of s.accessories) if (!out.accessories.includes(a)) out.accessories.push(a);
    // This style's vetoes bind every later style.
    for (const m of s.avoid.modules) veto.modules.add(m);
    for (const f of s.avoid.fabrics) veto.fabrics.add(f);
    for (const c of s.avoid.colors) veto.colors.add(normalizeHex(c) as string);
    for (const [k, opts] of Object.entries(s.avoid.controls)) {
      const set = veto.controls.get(k) ?? new Set<string>();
      for (const o of opts) set.add(o);
      veto.controls.set(k, set);
    }
  }
  const usedModules = new Set(out.modules.map((m) => m.module));
  const usedFabrics = new Set(Object.values(out.fabrics).flat());
  const usedColors = new Set(ROLES.flatMap((r) => out.palette[r].map((c) => c.hex)));
  out.avoid.modules = [...veto.modules].filter((m) => !usedModules.has(m));
  out.avoid.fabrics = [...veto.fabrics].filter((f) => !usedFabrics.has(f as MaterialPreset)) as MaterialPreset[];
  out.avoid.colors = [...veto.colors].filter((c) => ![...usedColors].some((u) => nearColor(u, c)));
  for (const [k, set] of veto.controls) {
    const chosen = new Set(Object.entries(out.controls).filter(([ck]) => (ck.split(".").pop() ?? ck) === k).flatMap(([, v]) => v));
    const left = [...set].filter((o) => !chosen.has(o));
    if (left.length) out.avoid.controls[k] = left;
  }
  return out;
}

/** Concrete material of a hardware finish. */
export const hardwareMaterial = (f: HardwareFinish): PartMaterial => ({ ...HARDWARE[f] });

// ---------- Prompt ----------

let promptCache: string | null = null;

/**
 * The dictionary as compact text for Claude's cached system prompt: one line per style with its
 * trigger phrases, palette (hex for the lead colors), fabric presets, control preferences, hardware,
 * signature details (module@zone) and avoid list. Roughly 2k tokens.
 */
export function stylePromptBlock(): string {
  if (promptCache) return promptCache;
  const lines = [
    "STYLE DICTIONARY: aesthetic words are design instructions, not just colors. Per style: id (phrases): vibe | palette | material presets | controls | hardware finish | signature details module(style)@zone | avoid. Apply all of it; with several styles the first said wins conflicts and later ones only add non-clashing details; the shopper's explicit color, fabric, cut or detail beats any style.",
  ];
  for (const s of STYLES) {
    const colors = [...Object.entries(s.palette.main).slice(0, 2), ...Object.entries(s.palette.accent).slice(0, 1)].map(([n, h]) => `${n} ${h}`).join(", ");
    // The vibe's lead words carry the mood; the rest of it is spelled out by the structured fields.
    const mood = s.vibe.split(":")[0];
    const fabrics = [...new Set((["outerwear", "top", "bottom", "skirt", "bag", "trim"] as const).flatMap((k) => s.fabrics[k]?.slice(0, 2) ?? []))].slice(0, 5).join(" ");
    const ctl = (["fit", "length", "leg"] as const).filter((k) => s.controls[k]).map((k) => `${k} ${s.controls[k][0]}`).join(", ");
    const details: string[] = [];
    for (const m of s.modules) {
      if (details.some((x) => x.startsWith(m.module))) continue;
      const z = (Array.isArray(m.zone) ? m.zone[0] : m.zone).split(/[@~]/)[0];
      const p = m.params?.style ?? m.params?.motif;
      details.push(`${m.module}${typeof p === "string" ? `(${p})` : ""}@${z}`);
      if (details.length >= 5) break;
    }
    const avoid = [...s.avoid.modules.slice(0, 3), ...s.avoid.fabrics.slice(0, 1)].join(" ");
    const said = s.aliases.slice(0, 2).join("/");
    lines.push(`- ${s.id} (${said}): ${mood} | ${colors} | ${fabrics} | ${ctl} | ${s.hardware} | ${details.join(" ")} | avoid ${avoid}`);
  }
  promptCache = lines.join("\n");
  return promptCache;
}
