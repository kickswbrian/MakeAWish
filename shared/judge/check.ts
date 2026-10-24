import type { Addon, Decal, ProductSpec } from "../spec.ts";

/**
 * A judge request and what the spec must look like afterwards. Checks are about outcomes
 * ("the pockets got bigger", "there is a dragon on the back"), not exact patches, so either
 * brain (Claude or the offline rules) can pass them.
 */
export interface JudgeCase {
  id: string;
  /** Spec before the request. Default: a blank wish. */
  start?: ProductSpec;
  /** Earlier utterances, run through the same brain first (multi-turn and undo cases). */
  before?: string[];
  say: string;
  expect: Expect[];
  tags?: string[];
}

export type Expect =
  /** Dot path into the spec, e.g. "length", "parts.straps.color", "features". */
  | { path: string; equals: unknown }
  | { path: string; oneOf: unknown[] }
  /** Numeric factor that defaults to 1 when unset (scale, parts.x.scale). */
  | { path: string; grew: true }
  | { path: string; shrank: true }
  | { path: string; includes: string }
  | { path: string; excludes: string }
  | { path: string; absent: true }
  /** Hex color at path falls in a named hue family (see colorFamily). */
  | { path: string; family: ColorFamily }
  /** Top-level fields that must not change (catches collateral edits). */
  | { unchanged: string[] }
  | { decal: DecalMatch }
  | { noDecal: DecalMatch }
  | { addon: AddonMatch }
  | { noAddon: AddonMatch }
  /** The part is hidden, or (for feature-backed parts like pockets) its feature is gone. */
  | { partGone: string }
  | { partShown: string };

export interface DecalMatch {
  kind?: Decal["kind"] | Decal["kind"][];
  /** Case-insensitive; any one may match. Emoji and shape names compare exactly. */
  content?: string[];
  placement?: Decal["placement"] | Decal["placement"][];
  family?: ColorFamily;
  sizeGt?: number;
  sizeLt?: number;
}
export interface AddonMatch {
  /** Any one of these substrings appears in the add-on name (case-insensitive). */
  name?: string[];
  shape?: Addon["shape"][];
  placement?: Addon["placement"] | Addon["placement"][];
  family?: ColorFamily;
  glow?: boolean;
  sizeGt?: number;
  sizeLt?: number;
}

export type ColorFamily = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "brown" | "black" | "white" | "gray";

/** Coarse hue family, so "make it red" accepts any red the brain picks. */
export function colorFamily(hex: string): ColorFamily {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.16) return "black";
  if (s < 0.15) return l > 0.85 ? "white" : l < 0.3 ? "black" : "gray";
  if (l > 0.9) return "white";
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l > 0.7 ? "pink" : "red";
  // Golds (hue ~40-46) read as yellow: "make it gold" and "yellow letters" both accept them.
  if (h < 38) return l < 0.45 && s < 0.85 ? "brown" : "orange";
  if (h < 70) return l < 0.4 ? "brown" : "yellow";
  if (h < 170) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return l > 0.6 || h > 315 ? "pink" : "purple";
}

/** Feature that backs a part: pockets come and go with the phone_pockets feature, and so on. */
export const PART_FEATURE: Record<string, string> = {
  pockets: "phone_pockets", side_pocket: "phone_pockets", stand: "laptop_stand", headphones: "headphones", seam: "converts_to_skirt",
};

export function get(spec: unknown, path: string): unknown {
  let cur: unknown = spec;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const lc = (s: string) => s.toLowerCase();
const asList = <T,>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

function decalMatches(d: Decal, m: DecalMatch): boolean {
  if (m.kind && !asList(m.kind)!.includes(d.kind)) return false;
  if (m.content && !m.content.some((c) => lc(d.content).includes(lc(c)))) return false;
  if (m.placement && !asList(m.placement)!.includes(d.placement)) return false;
  if (m.family && (!d.color || colorFamily(d.color) !== m.family)) return false;
  if (m.sizeGt !== undefined && !((d.size ?? 1) > m.sizeGt)) return false;
  if (m.sizeLt !== undefined && !((d.size ?? 1) < m.sizeLt)) return false;
  return true;
}

function addonMatches(a: Addon, m: AddonMatch): boolean {
  if (m.name && !m.name.some((n) => lc(a.name).includes(lc(n)))) return false;
  if (m.shape && !m.shape.includes(a.shape)) return false;
  if (m.placement && !asList(m.placement)!.includes(a.placement)) return false;
  if (m.family && (!a.color || colorFamily(a.color) !== m.family)) return false;
  if (m.glow !== undefined && !!a.glow !== m.glow) return false;
  if (m.sizeGt !== undefined && !((a.size ?? 1) > m.sizeGt)) return false;
  if (m.sizeLt !== undefined && !((a.size ?? 1) < m.sizeLt)) return false;
  return true;
}

/** Returns the failed expectations (empty = pass). `start` is the spec before the judged utterance. */
export function check(spec: ProductSpec, start: ProductSpec, expects: Expect[]): string[] {
  const fails: string[] = [];
  const show = (v: unknown) => JSON.stringify(v);
  for (const e of expects) {
    let ok = true;
    let got: unknown;
    if ("unchanged" in e) {
      const moved = e.unchanged.filter((f) => show(get(spec, f)) !== show(get(start, f)));
      ok = moved.length === 0;
      got = moved.map((f) => `${f}: ${show(get(start, f))} -> ${show(get(spec, f))}`).join("; ");
    } else if ("decal" in e || "noDecal" in e) {
      const m = "decal" in e ? e.decal : e.noDecal;
      const hit = (spec.decals ?? []).some((d) => decalMatches(d, m));
      ok = "decal" in e ? hit : !hit;
      got = spec.decals ?? [];
    } else if ("addon" in e || "noAddon" in e) {
      const m = "addon" in e ? e.addon : e.noAddon;
      const hit = (spec.addons ?? []).some((a) => addonMatches(a, m));
      ok = "addon" in e ? hit : !hit;
      got = spec.addons ?? [];
    } else if ("partGone" in e || "partShown" in e) {
      const name = "partGone" in e ? e.partGone : e.partShown;
      const feature = PART_FEATURE[name];
      const hidden = !!spec.parts?.[name]?.hidden || (feature !== undefined && !(spec.features ?? []).includes(feature));
      ok = "partGone" in e ? hidden : !hidden;
      got = { part: spec.parts?.[name], features: spec.features };
    } else {
      got = get(spec, e.path);
      if ("equals" in e) ok = show(got) === show(e.equals);
      else if ("oneOf" in e) ok = e.oneOf.some((v) => show(v) === show(got));
      else if ("grew" in e) ok = ((got as number | undefined) ?? 1) > ((get(start, e.path) as number | undefined) ?? 1);
      else if ("shrank" in e) ok = ((got as number | undefined) ?? 1) < ((get(start, e.path) as number | undefined) ?? 1);
      else if ("includes" in e) ok = Array.isArray(got) && got.includes(e.includes);
      else if ("excludes" in e) ok = !Array.isArray(got) || !got.includes(e.excludes);
      else if ("absent" in e) ok = got === undefined;
      else if ("family" in e) ok = typeof got === "string" && /^#[0-9a-f]{6}$/i.test(got) && colorFamily(got) === e.family;
    }
    if (!ok) fails.push(`${show(e)}  got ${show(got)}`);
  }
  return fails;
}
