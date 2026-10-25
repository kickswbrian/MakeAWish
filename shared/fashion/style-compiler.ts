import { isEnumParam, kitById, type KitEntry, type ModuleCategory } from "../kit.ts";
import type { MaterialPreset, PartMaterial } from "../product.ts";
import type { Request, WishClassification } from "./classify.ts";
import { fashionById, placeOnZone } from "./compile.ts";
import { CONTROL_SYNONYMS, hardwareMaterial, mergeStyles, type FabricKey, type MergedStyle, type SlotName, type StyleMaterialRef, type StyleModule, type Tone } from "./styles.ts";
import type { ControlSpec, FashionTemplate, ModulePlacement, OutfitSpec, Zone } from "./types.ts";

/**
 * The style compiler: a template plus a classified wish -> a complete, deterministic OutfitSpec.
 * Precedence everywhere: what the shopper said > the merged styles (first style first) > the
 * template's defaults. Only options, zones and modules the template and the kit actually have are
 * used, so the result always compiles; the genie can refine it afterwards.
 */

// ---------- Vocabulary ----------

type Kind = ModuleCategory;
const FABRIC_KIND: Record<Kind, FabricKey[]> = {
  top: ["top"], outerwear: ["outerwear", "top"], bottom: ["bottom"], skirt: ["skirt", "bottom"], dress: ["dress", "top", "skirt"],
  bag: ["bag"], jewelry: ["jewelry"], accessory: ["bag", "top"], any: ["top"],
};
const UPPER = new Set<Kind>(["top", "outerwear", "dress"]);

/** How many detail modules (zone instances, standard ones included) a finished design carries. */
export const DETAIL_RANGE: Record<Kind, [number, number]> = {
  top: [8, 15], outerwear: [8, 15], bottom: [8, 15], skirt: [8, 15], dress: [8, 15], bag: [6, 12], jewelry: [0, 6], accessory: [2, 10], any: [4, 12],
};

/** Natural colors for fabrics that look wrong dyed a palette color (denim), and plain defaults. */
const FABRIC_COLOR: Partial<Record<MaterialPreset, string>> = {
  denim: "#3E5C82", denim_light: "#8FB0D4", horn: "#5C3A21", pearl: "#F3EDE2", cork: "#B98B57", wood: "#9A6B43",
};
const TYPICAL_COLOR: Partial<Record<MaterialPreset, string>> = {
  leather: "#2A211C", leather_pebbled: "#2A211C", patent_leather: "#1A1A1D", suede: "#A47551", sherpa: "#EFE8DC", cable_knit: "#E8DFCC",
  knit: "#D8CBB3", rib_knit: "#E6DCCB", corduroy: "#8B5A2B", velvet: "#5E1A24", tweed: "#A08A6E", wool_suiting: "#3A3D42", fleece: "#A3A6AA",
  linen: "#E8E2D4", satin: "#EAD9C2", lace: "#F6F1E1", gingham: "#F28DB2", quilted: "#1A1A1D", nylon: "#2E2E31", canvas: "#D8CBB3", jersey: "#F4F4F2",
  mesh_fabric: "#1A1A1D", cotton: "#F4F4F2",
};
/** Fabrics that read right on a template's own trim pieces (collars, cuffs); others only on trim modules. */
const BASE_TRIM_OK = new Set<MaterialPreset>(["rib_knit", "knit", "jersey", "sherpa", "fleece", "corduroy", "suede", "leather", "velvet", "wool_suiting", "satin", "cotton", "denim", "nylon"]);
/** Paths whose midpoint is the front center by template convention. */
const FRONT_PATHS = new Set(["waistband", "waist", "placket", "neckline", "fly", "zip_top", "top_edge"]);
const KIT_DEFAULT_SLOT: Record<string, SlotName[]> = {
  closure: ["hardware"], jewelry: ["metal", "hardware"], bag_hardware: ["hardware"], hardware: ["hardware"], construction: ["thread"], trim: ["trim", "shell"], pocket: ["shell"], label: ["label"],
};

// ---------- Requests -> placements ----------

type Group = "upper" | Kind;
type Req = Omit<StyleModule, "kinds">;
type ReqTable = Partial<Record<Group, Req[]>>;
const P = (module: string, zone: string | string[], extra: Partial<Req> = {}): Req => ({ module, zone, ...extra });
const PEARL = { preset: "pearl" as const, color: "#F3EDE2" };
const buttons = (style: string, material?: StyleMaterialRef): ReqTable => ({
  upper: [P("button", "placket", { params: { style, count: 5 }, material, replace: true })],
  bottom: [P("button", "waistband", { params: { style }, material, replace: true })],
  skirt: [P("button", ["front_center", "waistband"], { params: { style }, material })],
  bag: [P("button", ["front_center", "flap_edge"], { params: { style }, material })],
});

/** Where each requested detail goes, per garment kind ("upper" = tops, outerwear and dresses). */
export const REQUEST_TABLE: Record<Request, ReqTable> = {
  pockets: {
    outerwear: [P("patch_pocket", ["hip_*", "chest_*"], { params: { flap: "none", corner: "square" } })],
    top: [P("patch_pocket", ["chest_left", "chest_right"], { params: { flap: "none", corner: "square" } })],
    dress: [P("patch_pocket", ["hip_*", "chest_left"], { params: { flap: "none", corner: "rounded" } })],
    bottom: [P("slash_pocket", "pocket_front_*"), P("jeans_back_pocket", "pocket_back_*")],
    skirt: [P("slash_pocket", ["pocket_front_*", "hip_*"])],
    bag: [P("patch_pocket", ["front_panel", "front_center"], { params: { flap: "none", corner: "square" } })],
  },
  patch_pocket: {
    upper: [P("patch_pocket", ["chest_*", "hip_*"], { params: { flap: "none" } })],
    bottom: [P("patch_pocket", ["pocket_back_*", "thigh_*"])],
    skirt: [P("patch_pocket", ["hip_*", "front_center"])],
    bag: [P("patch_pocket", ["front_panel", "front_center"])],
  },
  flap_pocket: {
    upper: [P("patch_pocket", ["hip_*", "chest_*"], { params: { flap: "flap_button" } })],
    bottom: [P("patch_pocket", ["thigh_*", "pocket_back_*"], { params: { flap: "flap_button" } })],
    bag: [P("patch_pocket", ["front_panel", "front_center"], { params: { flap: "flap" } })],
  },
  welt_pocket: { upper: [P("welt_pocket", ["chest_left", "hip_*"])], bottom: [P("welt_pocket", "pocket_back_*")], skirt: [P("welt_pocket", "hip_*")] },
  slash_pocket: { outerwear: [P("welt_pocket", "hip_*")], bottom: [P("slash_pocket", "pocket_front_*")], skirt: [P("slash_pocket", ["pocket_front_*", "hip_*"])] },
  cargo_pocket: { upper: [P("cargo_pocket", ["hip_*", "chest_*"])], bottom: [P("cargo_pocket", ["thigh_*", "hip_*"])], skirt: [P("cargo_pocket", ["hip_*", "thigh_*"])], bag: [P("cargo_pocket", ["side_left", "front_panel"])] },
  zip: {
    upper: [P("zipper_path", "placket", { material: "hardware", replace: true })],
    bottom: [P("zipper_path", "fly", { material: "hardware", replace: true })],
    skirt: [P("zipper_path", ["side_seam_left", "back_center"], { material: "hardware" })],
    bag: [P("zipper_path", "zip_top", { material: "hardware" }), P("zip_puller", "zip_top", { material: "hardware" })],
  },
  buttons: { ...buttons("flat4"), upper: [P("button", "placket", { params: { count: 5 }, replace: true })] },
  pearl_buttons: buttons("pearl_dome", PEARL),
  horn_buttons: buttons("horn_rim", { preset: "horn", color: "#5C3A21" }),
  metal_buttons: buttons("shank_dome", "hardware"),
  wood_buttons: buttons("flat4", { preset: "wood", color: "#9A6B43" }),
  covered_buttons: buttons("covered", "shell"),
  toggles: { upper: [P("button", "placket", { params: { style: "toggle", count: 4 }, material: { preset: "horn", color: "#6B4A32" }, replace: true })], bag: [P("button", ["flap_edge", "front_center"], { params: { style: "toggle" } })] },
  snaps: {
    upper: [P("snap_button", "placket", { params: { count: 5 }, material: "hardware", replace: true })],
    bottom: [P("snap_button", "waistband", { material: "hardware", replace: true })],
    bag: [P("snap_button", ["flap_edge", "top_edge"], { material: "hardware" })],
  },
  bow: {
    upper: [P("bow", ["neckline", "chest_center", "back_center", "waist"], { material: "accent" })],
    bottom: [P("bow", ["front_center", "waist"], { material: "accent" })],
    skirt: [P("bow", ["front_center", "waist"], { material: "accent" })],
    bag: [P("bow", ["front_center", "strap_anchor_left"], { material: "accent" })],
    jewelry: [P("charm", "drop_point", { params: { shape: "heart" }, material: "metal" })],
  },
  ruffle: {
    top: [P("ruffle", ["neckline", "hem"])], dress: [P("ruffle", ["hem", "neckline"])], outerwear: [P("ruffle", ["hem", "cuff_*"])],
    skirt: [P("ruffle", "hem")], bottom: [P("ruffle", "hem_*")], bag: [P("ruffle", ["top_edge", "flap_edge"])],
  },
  lace_trim: {
    upper: [P("lace_trim", ["hem", "neckline", "cuff_*"], { material: "trim" })], skirt: [P("lace_trim", "hem", { material: "trim" })],
    bottom: [P("lace_trim", "hem_*", { material: "trim" })], bag: [P("lace_trim", ["top_edge", "flap_edge"], { material: "trim" })],
  },
  drawstring: {
    top: [P("drawstring", ["neckline", "hem"])], outerwear: [P("drawstring", ["hem", "waist"])], dress: [P("drawstring", ["waist", "neckline"])],
    bottom: [P("drawstring", "waistband")], skirt: [P("drawstring", "waistband")], bag: [P("drawstring", "top_edge")],
  },
  fringe: {
    outerwear: [P("fringe", ["back_yoke", "hem", "cuff_*"])], top: [P("fringe", "hem")], dress: [P("fringe", "hem")], skirt: [P("fringe", "hem")],
    bottom: [P("fringe", "hem_*")], bag: [P("fringe", ["flap_edge", "edge_front", "top_edge"])],
  },
  tassel: { bag: [P("tassel", ["strap_anchor_left", "zip_top"])], jewelry: [P("drop", "drop_point", { params: { charm: "tassel" }, material: "metal" })] },
  chain: {
    bag: [P("chain_strap", ["handle_right", "handle_left"], { material: "hardware" })], jewelry: [P("chain", "hoop_front", { material: "metal" })],
    upper: [P("chain", "waist", { material: "hardware" })], bottom: [P("chain", "waist", { material: "hardware" })],
  },
  embroidery: {
    upper: [P("embroidery", ["chest_left", "chest_right", "back_center"], { material: "accent" })], bottom: [P("embroidery", ["thigh_left", "back_patch", "knee_left"], { material: "accent" })],
    skirt: [P("embroidery", ["front_center", "hem"], { material: "accent" })], bag: [P("embroidery", ["front_center", "front_panel"], { material: "accent" })],
  },
  logo: {
    upper: [P("brand_patch", ["chest_left", "sleeve_left", "back_center"])], bottom: [P("brand_patch", ["back_patch", "waistband"])],
    skirt: [P("brand_patch", ["waistband", "front_center"])], bag: [P("logo_plate", ["front_center", "front_panel", "back_panel"], { material: "hardware" })],
  },
  print: {
    upper: [P("print_graphic", ["chest_center", "back_center"])], bottom: [P("print_graphic", ["thigh_left", "back_patch"])],
    skirt: [P("print_graphic", "front_center")], bag: [P("print_graphic", ["front_panel", "front_center"])],
  },
  piping: {
    upper: [P("piping", ["collar", "placket", "side_seam_*"], { material: "trim" })], bottom: [P("piping", "outseam_*", { material: "trim" })],
    skirt: [P("piping", ["hem", "side_seam_*"], { material: "trim" })], bag: [P("piping", ["edge_front", "flap_edge"], { material: "trim" })],
  },
  ruching: { upper: [P("ruching", ["side_seam_*", "chest_center"])], bottom: [P("ruching", ["yoke_back", "outseam_*"])], skirt: [P("ruching", "side_seam_*")] },
  puff_band: { upper: [P("puff_band", ["cuff_*", "armhole_*", "shoulder_*"])] },
  pompom: { bag: [P("pompom", ["strap_anchor_left", "strap_anchor_right"])], upper: [P("pompom", ["chest_center", "back_center"])] },
  scallop_edge: {
    upper: [P("scallop_edge", ["hem", "collar", "neckline", "cuff_*"], { material: "trim" })], bottom: [P("scallop_edge", "hem_*", { material: "trim" })],
    skirt: [P("scallop_edge", "hem", { material: "trim" })], bag: [P("scallop_edge", ["flap_edge", "top_edge"], { material: "trim" })],
  },
  rib_band: { upper: [P("rib_band", "cuff_*", { material: "trim" }), P("rib_band", ["hem", "neckline"], { material: "trim" })], bottom: [P("rib_band", ["hem_*", "waistband"], { material: "trim" })], skirt: [P("rib_band", "waistband", { material: "trim" })] },
  sherpa_band: { upper: [P("sherpa_band", ["collar", "cuff_*", "hem"], { material: "trim" })], bottom: [P("sherpa_band", "hem_*", { material: "trim" })], bag: [P("sherpa_band", "top_edge", { material: "trim" })] },
  lacing: {
    upper: [P("lacing", ["back_center", "neckline", "placket", "side_seam_*"], { material: "trim" })], bottom: [P("lacing", ["fly", "outseam_*"], { material: "trim" })],
    skirt: [P("lacing", ["side_seam_*", "front_center"], { material: "trim" })],
  },
  belt: { upper: [P("buckle_belt", ["waist", "hem"], { material: "hardware" })], bottom: [P("buckle_belt", "waistband", { material: "hardware" })], skirt: [P("buckle_belt", "waistband", { material: "hardware" })], bag: [P("buckle_belt", ["handle_left", "flap_edge"], { material: "hardware" })] },
  d_ring: { upper: [P("d_ring", ["waist", "hip_left", "side_seam_left"], { material: "hardware" })], bottom: [P("d_ring", ["waistband", "outseam_left"], { material: "hardware" })], bag: [P("d_ring", ["side_left", "strap_anchor_*"], { material: "hardware" })] },
  hook_eye: { upper: [P("hook_eye", "placket", { material: "hardware", replace: true })], bottom: [P("hook_eye", "waistband", { material: "hardware" })], skirt: [P("hook_eye", "waistband", { material: "hardware" })] },
  pleats: { bottom: [P("pleats", "waistband")], skirt: [P("pleats", ["waistband", "hem"])], upper: [P("pleats", ["back_center", "hem"])] },
  topstitch: {
    upper: [P("topstitch", "hem", { params: { rows: 2, weight: "heavy" } }), P("topstitch", ["placket", "collar"], { params: { rows: 2, weight: "heavy" } })],
    bottom: [P("topstitch", "outseam_*", { params: { rows: 2, weight: "heavy" } }), P("topstitch", "waistband", { params: { rows: 2, weight: "heavy" } })],
    skirt: [P("topstitch", "hem", { params: { rows: 2, weight: "heavy" } })], bag: [P("topstitch", ["top_edge", "handle_*"], { params: { rows: 2, weight: "heavy" } })],
  },
  rivets: { bottom: [P("jeans_rivet", "pocket_front_*", { material: "hardware" })], upper: [P("jeans_rivet", ["hip_*", "chest_*"], { material: "hardware" })], skirt: [P("jeans_rivet", ["pocket_front_*", "hip_*"], { material: "hardware" })] },
  dart: { upper: [P("dart", ["chest_*", "back_center"])], skirt: [P("dart", ["waistband", "back_center"])], bottom: [P("dart", ["yoke_back", "waistband"])] },
  turn_lock: { bag: [P("turn_lock", ["front_center", "front_panel"], { material: "hardware" })] },
  charm: { bag: [P("bag_charm", ["strap_anchor_left", "handle_left"], { material: "hardware" })], jewelry: [P("charm", "drop_point", { material: "metal" })] },
  hang_tag: { upper: [P("hang_tag", ["neck_label", "sleeve_left"])], bottom: [P("hang_tag", ["waistband", "belt_loops"])], skirt: [P("hang_tag", "waistband")], bag: [P("hang_tag", ["handle_left", "strap_anchor_left"])] },
  label: { upper: [P("woven_label", "neck_label", { material: "label" })], bottom: [P("woven_label", ["waistband", "back_patch"], { material: "label" })], skirt: [P("woven_label", "waistband", { material: "label" })], bag: [P("woven_label", ["front_panel", "back_panel"], { material: "label" })] },
  patch: { upper: [P("leather_patch", ["chest_left", "sleeve_left", "back_center"])], bottom: [P("leather_patch", "back_patch")], skirt: [P("leather_patch", ["front_center", "waistband"])], bag: [P("leather_patch", ["front_center", "front_panel"])] },
  pearl: { jewelry: [P("pearl", ["drop_point", "face"], { material: "stone" })], bag: [P("pearl", "front_center", { material: PEARL })], upper: [P("button", "placket", { params: { style: "pearl_dome", count: 5 }, material: PEARL, replace: true })] },
  gem: { jewelry: [P("gem", ["face", "drop_point"], { material: "stone" })], bag: [P("gem", "front_center", { material: "stone" })] },
  "motif:heart": {}, "motif:star": {}, "motif:flower": {}, "motif:cherry": {}, "motif:bow": {}, "motif:smiley": {}, "motif:sparkle": {}, "motif:butterfly": {},
};

/** The closest shape each charm module offers for a motif (charms have fewer shapes than embroidery). */
const CHARM_SHAPE: Record<string, string> = { heart: "heart", star: "star", flower: "flower", sparkle: "star", butterfly: "flower", cherry: "heart", bow: "heart", smiley: "disc" };
const BAG_CHARM: Record<string, string> = { heart: "heart", star: "star", flower: "pompom", sparkle: "star", butterfly: "star", cherry: "heart", bow: "heart", smiley: "bear" };

/** A motif goes on a charm for jewelry and bags, as embroidery on garments. */
function motifReqs(motif: string, kind: Kind): Req[] {
  if (kind === "jewelry") return [P("charm", "drop_point", { params: { shape: CHARM_SHAPE[motif] ?? "heart" }, material: "metal" })];
  if (kind === "bag") return [P("bag_charm", ["strap_anchor_left", "handle_left"], { params: { charm: BAG_CHARM[motif] ?? "heart" }, material: "hardware" }), P("embroidery", ["front_center", "front_panel"], { params: { motif }, material: "accent" })];
  const t = REQUEST_TABLE.embroidery;
  return (UPPER.has(kind) ? t.upper : t[kind]) ?.map((r) => ({ ...r, params: { ...r.params, motif } })) ?? [];
}

/** Generic requests the shopper's style may answer its own way ("with pockets" + officewear = flap pockets). */
const STYLE_ANSWERS: Partial<Record<Request, string[]>> = {
  pockets: ["patch_pocket", "welt_pocket", "flap", "cargo_pocket", "slash_pocket"],
  buttons: ["button", "snap_button"],
  zip: ["zipper_path"],
  bow: ["bow"], ruffle: ["ruffle"], lace_trim: ["lace_trim"], drawstring: ["drawstring"], fringe: ["fringe"], tassel: ["tassel"], chain: ["chain_strap", "chain"],
  embroidery: ["embroidery"], logo: ["brand_patch", "logo_plate"], print: ["print_graphic"], piping: ["piping"], ruching: ["ruching"], puff_band: ["puff_band"],
  pompom: ["pompom"], scallop_edge: ["scallop_edge"], rib_band: ["rib_band"], sherpa_band: ["sherpa_band"], lacing: ["lacing"], belt: ["buckle_belt"],
  d_ring: ["d_ring"], pleats: ["pleats"], topstitch: ["topstitch"], rivets: ["jeans_rivet"], charm: ["bag_charm", "charm"], patch: ["leather_patch"], label: ["woven_label"],
};

/** Every module a refusal covers ("no pockets" removes every pocket, "no logos" every logo). */
const REFUSALS: Partial<Record<Request, string[]>> = {
  pockets: ["patch_pocket", "welt_pocket", "flap", "cargo_pocket", "slash_pocket", "coin_pocket", "jeans_back_pocket"],
  buttons: ["button"], zip: ["zipper_path", "zip_puller"], logo: ["brand_patch", "logo_plate", "print_graphic", "leather_patch"], print: ["print_graphic"],
  label: ["woven_label", "hang_tag"], patch: ["leather_patch", "brand_patch"], chain: ["chain_strap", "chain"], belt: ["buckle_belt"], rivets: ["jeans_rivet"],
  embroidery: ["embroidery"], charm: ["bag_charm", "charm"], snaps: ["snap_button"],
};
const refused = (r: Request): string[] => REFUSALS[r] ?? [...new Set(Object.values(REQUEST_TABLE[r]).flat().map((p) => p.module))];

/** Neutral construction details that make any garment read as real, used to reach the minimum. */
export const FILLERS: Partial<Record<Group, Req[]>> = {
  upper: [
    P("topstitch", "hem", { params: { rows: 1, weight: "regular" } }), P("topstitch", "cuff_*", { params: { rows: 1, weight: "regular" } }),
    P("topstitch", "collar", { params: { rows: 1, weight: "fine" } }), P("topstitch", "placket", { params: { rows: 1, weight: "fine" } }),
    P("woven_label", "neck_label", { material: "label" }), P("bar_tack", "placket@0.97"), P("topstitch", "shoulder_*", { params: { rows: 1, weight: "fine" } }),
    P("topstitch", "armhole_*", { params: { rows: 1, weight: "fine" } }), P("seam_welt", "side_seam_*"), P("topstitch", "neckline", { params: { rows: 1, weight: "fine" } }),
  ],
  bottom: [
    P("topstitch", "outseam_*", { params: { rows: 2, weight: "regular" } }), P("topstitch", "waistband", { params: { rows: 2, weight: "regular" } }),
    P("topstitch", "hem_*", { params: { rows: 1, weight: "regular" } }), P("bar_tack", "fly"), P("topstitch", "inseam_*", { params: { rows: 1, weight: "regular" } }),
    P("topstitch", "yoke_back", { params: { rows: 2, weight: "regular" } }), P("woven_label", ["waistband", "back_patch"], { material: "label" }), P("coin_pocket", "coin_pocket"),
  ],
  skirt: [
    P("topstitch", "hem", { params: { rows: 1, weight: "regular" } }), P("topstitch", "waistband", { params: { rows: 2, weight: "regular" } }),
    P("seam_welt", "side_seam_*"), P("woven_label", "waistband", { material: "label" }), P("topstitch", "side_seam_*", { params: { rows: 1, weight: "fine" } }),
  ],
  bag: [
    P("edge_paint", "edge_front"), P("edge_paint", "edge_back"), P("topstitch", "top_edge", { params: { rows: 1, weight: "regular" } }),
    P("foot_stud", "base_corners", { params: { count: 4 }, material: "hardware" }), P("topstitch", "handle_*", { params: { rows: 1, weight: "regular" } }),
    P("zip_puller", "zip_top", { material: "hardware" }), P("strap_keeper", "handle_left"), P("edge_paint", "top_edge"),
  ],
  jewelry: [P("ear_back", "earlobe", { material: "metal" })],
};

FILLERS.outerwear = [...FILLERS.upper!, P("welt_pocket", ["hip_*", "chest_left"])];

const forKind = <T,>(table: Partial<Record<Group, T[]>>, kind: Kind): T[] => table[kind] ?? (UPPER.has(kind) ? table.upper : undefined) ?? [];

// ---------- Zones ----------

function parseToken(token: string): { name: string; t?: number } {
  const at = token.indexOf("@");
  if (at > 0) return { name: token.slice(0, at), t: Number(token.slice(at + 1)) };
  const off = token.indexOf("~");
  return { name: off > 0 ? token.slice(0, off) : token };
}

/** Concrete zone tokens for a placement zone ("cuff_*" -> cuff_left, cuff_right). Same rules as compile.ts. */
function expandZone(token: string, zones: Record<string, Zone>): string[] {
  const { name } = parseToken(token);
  if (!name.includes("*")) return zones[name] ? [token] : [];
  const re = new RegExp("^" + name.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  const suffix = token.slice(name.length);
  return Object.keys(zones).filter((z) => re.test(z)).map((z) => z + suffix);
}

/**
 * Occupancy keys a module takes on a zone: one point module per zone (two panels on a chest would
 * overlap), one path module per family per zone (a ruffle and a lace trim on one hem clash, a
 * topstitch and a bar tack don't), and one closure per zone whatever its shape.
 */
function keysFor(kit: KitEntry | undefined, zoneName: string): string[] {
  const keys: string[] = [];
  const family = kit?.family ?? "other";
  if (kit?.path) keys.push(`${zoneName}|path|${family === "construction" ? kit.id : family}`);
  // Rivets and bar tacks reinforce whatever sits on the zone (a pocket mouth), so they get their own slot.
  else keys.push(family === "construction" ? `${zoneName}|point|${kit?.id}` : `${zoneName}|point`);
  if (family === "closure") keys.push(`${zoneName}|closure`);
  return keys;
}

// ---------- Colors ----------

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (c: number[]) => "#" + c.map((v) => clampByte(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Tone-on-tone thread: a little darker than a light fabric, a little lighter than a dark one. */
function tonal(hex: string): string {
  const c = rgb(hex);
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return lum > 0.45 ? toHex(c.map((v) => v * 0.8)) : toHex(c.map((v) => v + (255 - v) * 0.18));
}

// ---------- Compiler ----------

interface MaterialChoice {
  /** Slot overrides for the template's own slots. */
  materials: Record<string, PartMaterial>;
  /** Every slot's material as this design sees it, including slots the template doesn't define (for module materials). */
  virtual: Partial<Record<SlotName, PartMaterial>>;
}

function pickOption(prefs: string[] | undefined, spec: ControlSpec, banned: Set<string> = new Set()): string | undefined {
  for (const p of prefs ?? []) {
    for (const o of [p, ...(CONTROL_SYNONYMS[p] ?? [])]) if (spec.options.includes(o) && !banned.has(o)) return o;
  }
  return undefined;
}

function chooseControls(t: FashionTemplate, c: WishClassification, s: MergedStyle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, spec] of Object.entries(t.controls)) {
    const banned = new Set(s.avoid.controls[k] ?? []);
    out[k] =
      pickOption(c.attributes.controls[k], spec) ??
      pickOption(s.controls[`${t.kind}.${k}`], spec, banned) ??
      pickOption(s.controls[k], spec, banned) ??
      (banned.has(spec.default) ? spec.options.find((o) => !banned.has(o)) : undefined) ??
      spec.default;
  }
  return out;
}

const FABRIC_ONLY = new Set<MaterialPreset>(["pearl", "gem", "horn", "metal_polished", "metal_brushed", "glass"]);

function chooseMaterials(t: FashionTemplate, c: WishClassification, s: MergedStyle): MaterialChoice {
  const a = c.attributes;
  const styled = s.ids.length > 0;
  const def = (slot: string): PartMaterial | undefined => t.slots[slot]?.default;
  const styleFabric = (keys: FabricKey[]) => keys.map((k) => s.fabrics[k]).find((l) => l?.length);

  // Colors: explicit first, then the merged palette.
  const pal = s.palette;
  const main = a.colors[0] ?? pal.main[0]?.hex;
  const second = a.colors[1];
  const tone = (tn: Tone | undefined, fallback: Tone): string | undefined => {
    switch (tn ?? fallback) {
      case "main": return main;
      case "secondary": return second ?? pal.secondary[0]?.hex ?? pal.neutrals[0]?.hex ?? main;
      case "accent": return second ?? pal.accent[0]?.hex ?? pal.secondary[0]?.hex ?? main;
      case "neutral": return pal.neutrals[0]?.hex ?? pal.secondary[0]?.hex ?? main;
      default: return main;
    }
  };

  // Shell fabric: what the shopper said > the style's fabric for this kind (within what the noun implies) > template.
  const shellDef = def("shell");
  const said = a.materials.find((m) => !FABRIC_ONLY.has(m));
  const styleList = styleFabric(FABRIC_KIND[t.kind]) ?? [];
  const hint = a.fabricHint;
  let shellPreset: MaterialPreset | undefined = said;
  if (!shellPreset && hint) shellPreset = styleList.find((f) => hint.includes(f)) ?? (shellDef && hint.includes(shellDef.preset) ? shellDef.preset : hint[0]);
  if (!shellPreset && styleList.length) shellPreset = styleList.find((f) => !s.avoid.fabrics.includes(f)) ?? styleList[0];
  shellPreset ??= shellDef?.preset ?? "cotton";
  const keepDefault = shellDef && shellPreset === shellDef.preset;
  const shellColor =
    a.colors[0] ??
    s.fabricColors[shellPreset] ??
    FABRIC_COLOR[shellPreset] ??
    (styled ? main : undefined) ??
    (keepDefault ? shellDef.color : TYPICAL_COLOR[shellPreset]) ??
    shellDef?.color ??
    "#C9CCD2";
  const mat = (preset: MaterialPreset, color: string, slot?: string): PartMaterial => {
    const d = slot ? def(slot) : undefined;
    // A different fabric must not inherit the default's finish overrides (leather is not as rough as fleece).
    return d && d.preset === preset ? { ...d, color } : { preset, color, roughness: undefined, metalness: undefined };
  };
  const shell = mat(shellPreset, shellColor, "shell");

  const finish = a.hardware ?? s.hardware;
  const hw = finish ? hardwareMaterial(finish) : def("hardware") ?? hardwareMaterial("silver");
  const jewelryMetal = s.fabrics.jewelry?.[0];
  const metal: PartMaterial = finish
    ? { ...hw, ...(jewelryMetal && hw.preset.startsWith("metal_") && jewelryMetal.startsWith("metal_") ? { preset: jewelryMetal } : {}) }
    : def("metal") ?? hw;

  const trimDef = def("trim");
  const trimFabric = a.slotMaterials.trim ?? s.fabrics.trim?.[0];
  const trimColor = (t.kind === "jewelry" ? undefined : tone(s.tones.trim, "main")) ?? trimDef?.color ?? shell.color;
  const trimModule = mat(trimFabric ?? trimDef?.preset ?? shell.preset, a.colors[1] ?? (styled || a.colors[0] ? trimColor : trimDef?.color ?? shell.color), "trim");
  const trimBaseOk = !!trimFabric && (!t.slots.trim?.parts.length || BASE_TRIM_OK.has(trimFabric));
  const trim = trimBaseOk ? trimModule : mat(trimDef?.preset ?? shell.preset, trimModule.color, "trim");

  const liningPreset = a.slotMaterials.lining ?? s.fabrics.lining?.[0] ?? def("lining")?.preset ?? "satin";
  const lining = mat(liningPreset, (styled ? tone(s.tones.lining, "secondary") : undefined) ?? def("lining")?.color ?? shell.color, "lining");

  const threadTone = s.tones.thread ?? "tonal";
  const threadDef = def("thread");
  const threadColor = !styled && !a.colors[0] ? threadDef?.color ?? tonal(shell.color) : threadTone === "contrast" ? s.thread ?? "#C8892E" : tonal(shell.color);
  const thread = mat(threadDef?.preset ?? "cotton", threadColor, "thread");

  // Woven labels take the palette's neutral; a leather patch keeps its natural tan unless the style names a tone.
  const labelDef = def("label");
  const leatherLabel = labelDef && ["leather", "suede", "leather_pebbled"].includes(labelDef.preset) && !s.tones.label;
  const label = mat(labelDef?.preset ?? "cotton", (styled && !leatherLabel ? tone(s.tones.label, "neutral") : undefined) ?? labelDef?.color ?? "#F1EEE6", "label");

  const stonePreset = a.slotMaterials.stone ?? s.fabrics.stone?.[0] ?? def("stone")?.preset ?? "gem";
  const stoneColor = stonePreset === "pearl" ? FABRIC_COLOR.pearl! : a.colors[0] ?? pal.accent[0]?.hex ?? def("stone")?.color ?? "#E8F4FF";
  const stone = mat(stonePreset, stoneColor, "stone");

  const strapPreset = a.slotMaterials.strap ?? s.fabrics.strap?.[0] ?? def("strap")?.preset ?? shell.preset;
  const strapColor = a.colors[0] && !a.slotMaterials.strap ? shell.color : (styled ? tone(s.tones.strap, "main") : undefined) ?? def("strap")?.color ?? shell.color;
  const strap = mat(strapPreset, strapPreset === shell.preset ? shell.color : strapColor, "strap");
  const handlePreset = a.slotMaterials.handle ?? a.slotMaterials.strap ?? s.fabrics.strap?.[0] ?? def("handle")?.preset ?? shell.preset;
  const handle = mat(handlePreset, handlePreset === shell.preset ? shell.color : strapColor, "handle");

  // Accent details (bows, ribbons, handle scarves) read as satin ribbon unless the template says otherwise.
  const accent = mat(def("accent")?.preset ?? "satin", tone(s.tones.accent, "accent") ?? def("accent")?.color ?? shell.color, "accent");

  const garment = t.kind !== "bag" && t.kind !== "jewelry" && t.kind !== "accessory";
  const virtual: Partial<Record<SlotName, PartMaterial>> = { shell, lining, hardware: hw, thread, label, metal, stone, strap, handle, accent };
  // A style's trim fabric (rib knit, lace) is a garment idea; bag trims (edge paint, piping) keep their own.
  if (garment || t.slots.trim || a.slotMaterials.trim) virtual.trim = garment ? trimModule : { ...(trimDef ?? trimModule), color: trimModule.color };
  const slotValue: Partial<Record<SlotName, PartMaterial>> = { ...virtual, trim };
  // Only slots the design has an opinion on: an unstyled, attribute-free wish keeps the template look.
  const opinion = styled || a.colors.length > 0 || a.materials.length > 0 || !!a.hardware || Object.keys(a.slotMaterials).length > 0;
  const materials: Record<string, PartMaterial> = {};
  if (opinion) {
    for (const slot of Object.keys(t.slots)) {
      const v = slotValue[slot as SlotName];
      if (!v) continue;
      if ((slot === "hardware" || slot === "metal") && !finish) continue;
      if (slot === "stone" && !styled && !a.slotMaterials.stone && !a.colors[0]) continue;
      materials[slot] = v;
    }
  }
  return { materials, virtual };
}

function sanitizeParams(kit: KitEntry, params: Record<string, number | string> | undefined): Record<string, number | string> | undefined {
  if (!params) return undefined;
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "count" || k === "inset") {
      if (!kit.path && typeof v === "number") out[k] = v;
      continue;
    }
    const spec = kit.params?.[k];
    if (!spec) continue;
    if (isEnumParam(spec)) {
      if (typeof v === "string" && spec.options.includes(v)) out[k] = v;
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(spec.min, Math.min(spec.max, n));
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const sameMaterial = (a: PartMaterial | undefined, b: PartMaterial | undefined) => !!a && !!b && a.preset === b.preset && a.color.toUpperCase() === b.color.toUpperCase();

interface Candidate extends Req {
  explicit: boolean;
  source: string;
}

/**
 * A complete design for a template from a classified wish: controls, slot materials and 8-15 detail
 * modules (garments; fewer for bags and jewelry) placed on zones the template has for those controls.
 */
export function styleOutfit(templateId: string, c: WishClassification): OutfitSpec {
  const t = fashionById(templateId);
  const styles = c.styles.filter((s, i, all) => all.indexOf(s) === i);
  if (!t) return { template: templateId, ...(styles.length ? { styles } : {}) };
  const kind = t.kind;
  const s = mergeStyles(styles);
  const a = c.attributes;
  const controls = chooseControls(t, c, s);
  const zones = t.zones(controls);
  const { materials, virtual } = chooseMaterials(t, c, s);
  const finalSlots: Record<string, PartMaterial> = {};
  for (const [k, slot] of Object.entries(t.slots)) finalSlots[k] = materials[k] ?? slot.default;

  // Refusals ("no pockets") beat everything, styles' avoid lists beat style and filler details.
  const refusedModules = new Set(a.without.flatMap(refused));
  const avoid = new Set(s.avoid.modules);
  const without: string[] = [];
  const occupied = new Map<string, string>();
  const placements: ModulePlacement[] = [];
  let count = 0;

  const placementId = (m: ModulePlacement) => m.id ?? `${m.module}_${m.zone}`;
  /** Standard details; `locked` once the shopper asked for that very detail, `restyled` once re-emitted with style params. */
  const standard: { pl: ModulePlacement; id: string; tokens: string[]; kit?: KitEntry; locked?: boolean; restyled?: boolean }[] = [];
  for (const pl of t.modules) {
    const id = placementId(pl);
    const kit = kitById(pl.module);
    const decorative = kit?.family !== "closure" && kit?.family !== "construction";
    if (refusedModules.has(pl.module) || (decorative && avoid.has(pl.module) && !a.modules.some((r) => refused(r).includes(pl.module)))) {
      without.push(id);
      continue;
    }
    const tokens = expandZone(pl.zone, zones);
    for (const tok of tokens) for (const k of keysFor(kit, parseToken(tok).name)) occupied.set(k, id);
    standard.push({ pl, id, tokens, kit });
    count += tokens.length;
  }
  const [, max] = DETAIL_RANGE[kind];
  const min = DETAIL_RANGE[kind][0];

  const resolveMaterial = (ref: StyleMaterialRef | undefined, kit: KitEntry): ModulePlacement["material"] => {
    if (ref && typeof ref === "object") return { ...ref };
    const slot = (ref ?? kit.slot ?? KIT_DEFAULT_SLOT[kit.family ?? ""]?.find((x) => virtual[x as SlotName])) as SlotName | undefined;
    if (!slot) return undefined;
    const want = virtual[slot];
    if (t.slots[slot] && (!want || sameMaterial(finalSlots[slot], want))) return ref ? slot : undefined;
    return want ? { ...want } : undefined;
  };

  const tryPlace = (cand: Candidate): boolean => {
    const kit = kitById(cand.module);
    if (!kit) return false;
    const cats = kit.categories;
    if (cats?.length && !cats.includes(kind) && !cats.includes("any") && !(kind === "dress" && (cats.includes("top") || cats.includes("skirt")))) return false;
    if (refusedModules.has(cand.module)) return false;
    if (!cand.explicit && avoid.has(cand.module)) return false;
    for (const alt of Array.isArray(cand.zone) ? cand.zone : [cand.zone]) {
      const tokens = expandZone(alt, zones);
      if (!tokens.length || !tokens.every((tok) => placeOnZone(kit, zones[parseToken(tok).name], tok))) continue;
      const names = tokens.map((tok) => parseToken(tok).name);
      // A point detail on a path zone lands at the path's midpoint, which only makes sense where the
      // module's author said it goes (a bow at mid-neckline yes, at mid-collar = the back of the neck no).
      // Modules without a zone list may sit mid-path only on front-center paths (a belt buckle on the waistband).
      const listed = kit.zones?.length ? names.every((n) => kit.zones!.includes(n)) : names.every((n) => FRONT_PATHS.has(n));
      const spread = alt.includes("@") || Number(cand.params?.count ?? 1) > 1;
      if (!kit.path && !spread && names.some((n) => zones[n].path) && !listed) continue;
      // The same module already on this zone: restyle the standard one instead of doubling it.
      const twin = standard.find((st) => st.pl.module === cand.module && st.tokens.some((tok) => names.includes(parseToken(tok).name)));
      if (twin) {
        // Replaced by another closure already: don't bring it back, try the next zone.
        if (without.includes(twin.id) && !twin.restyled) continue;
        // A style restyles the look, not the construction: the template's own count stays (a trucker
        // keeps four front buttons) unless the shopper asked for that detail.
        const keep: Record<string, number | string> = !cand.explicit && twin.pl.params?.count !== undefined ? { count: twin.pl.params.count } : {};
        const params = sanitizeParams(kit, { ...twin.pl.params, ...cand.params, ...keep }) ?? twin.pl.params;
        const material = cand.material ? resolveMaterial(cand.material, kit) : twin.pl.material;
        const changed = JSON.stringify(params ?? {}) !== JSON.stringify(twin.pl.params ?? {}) || JSON.stringify(material ?? null) !== JSON.stringify(twin.pl.material ?? null);
        if (cand.explicit) twin.locked = true;
        // Fillers never restyle: the template's own version already is the neutral one.
        if (changed && !twin.restyled && cand.source !== "filler") {
          twin.restyled = true;
          without.push(twin.id);
          placements.push({ ...twin.pl, id: twin.id, ...(params ? { params } : {}), ...(material ? { material } : {}) });
        }
        return true;
      }
      if (placements.some((p) => p.module === cand.module && expandZone(p.zone, zones).some((tok) => names.includes(parseToken(tok).name)))) return true;
      if (!cand.explicit && count + tokens.length > max) return false;
      // A closure that replaces the template's (buttons instead of its zipper).
      const keys = names.flatMap((n) => keysFor(kit, n));
      const blockers = new Set(keys.map((k) => occupied.get(k)).filter((x): x is string => !!x));
      if (blockers.size) {
        const std = [...blockers].map((id) => standard.find((st) => st.id === id));
        const replaceable = (cand.replace || cand.explicit) && kit.family === "closure" && std.every((st) => st && !st.locked && st.kit?.family === "closure");
        if (!replaceable) continue;
        for (const st of std) {
          if (!st) continue;
          const restyled = placements.findIndex((p) => p.id === st.id);
          if (restyled >= 0) placements.splice(restyled, 1);
          st.restyled = false;
          without.push(st.id);
          count -= st.tokens.length;
          for (const [k, v] of [...occupied]) if (v === st.id) occupied.delete(k);
        }
      }
      const pl: ModulePlacement = { module: cand.module, zone: alt };
      const params = sanitizeParams(kit, cand.params);
      if (params) pl.params = params;
      const material = resolveMaterial(cand.material, kit);
      if (material) pl.material = material;
      const id = `${cand.module}_${alt.replace(/\*/g, "all")}`;
      for (const k of keys) occupied.set(k, id);
      placements.push(pl);
      count += tokens.length;
      return true;
    }
    return false;
  };

  // 1. What the shopper asked for.
  const motifs = a.modules.filter((r) => r.startsWith("motif:")).map((r) => r.slice(6));
  const fits = (m: StyleModule) => !m.kinds || m.kinds.includes(kind) || (kind === "dress" && (m.kinds.includes("top") || m.kinds.includes("skirt")));
  const styleMods = s.modules.filter(fits);
  const usedStyle = new Set<StyleModule>();
  for (const r of a.modules) {
    let reqs: Req[];
    if (r.startsWith("motif:")) {
      if (a.modules.includes("embroidery") && kind !== "jewelry" && kind !== "bag") continue;
      reqs = motifReqs(r.slice(6), kind);
    } else {
      const answers = STYLE_ANSWERS[r];
      const fromStyle = answers ? styleMods.filter((m) => answers.includes(m.module)) : [];
      fromStyle.forEach((m) => usedStyle.add(m));
      reqs = fromStyle.length ? fromStyle : forKind(REQUEST_TABLE[r], kind);
      if (r === "embroidery" && motifs[0]) reqs = reqs.map((q) => ({ ...q, params: { ...q.params, motif: motifs[0] } }));
    }
    for (const q of reqs) tryPlace({ ...q, explicit: true, source: r });
  }
  // 2. The styles' signature details, first style first.
  for (const m of styleMods) if (!usedStyle.has(m)) tryPlace({ ...m, explicit: false, source: (m as { style?: string }).style ?? "style" });
  // 3. Neutral construction until the design reads as a real product.
  for (const f of forKind(FILLERS, kind)) {
    if (count >= min) break;
    tryPlace({ ...f, explicit: false, source: "filler" });
  }

  return {
    template: t.id,
    controls,
    ...(Object.keys(materials).length ? { materials } : {}),
    ...(placements.length ? { modules: placements } : {}),
    ...(without.length ? { without: [...new Set(without)] } : {}),
    ...(styles.length ? { styles } : {}),
  };
}

/** Detail modules a spec ends up with (standard minus `without`, plus its own), counted per zone instance. */
export function detailCount(spec: OutfitSpec): number {
  const t = fashionById(spec.template);
  if (!t) return 0;
  const zones = t.zones({ ...Object.fromEntries(Object.entries(t.controls).map(([k, v]) => [k, v.default])), ...spec.controls });
  const without = new Set(spec.without ?? []);
  const std = t.modules.filter((m) => !without.has(m.id ?? `${m.module}_${m.zone}`) && !without.has(m.module));
  return [...std, ...(spec.modules ?? [])].reduce((n, m) => n + expandZone(m.zone, zones).length, 0);
}
