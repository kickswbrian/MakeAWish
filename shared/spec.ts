import { z } from "zod";

// ---------- ProductSpec: the single source of truth ----------

export const CATEGORIES = ["dress", "top", "skirt", "backpack", "helmet", "generic"] as const;
export const LENGTHS = ["mini", "knee", "midi", "maxi"] as const;
export const SILHOUETTES = ["fitted", "a_line", "wrap", "flowy"] as const;
/** Ordered shortest to longest (puff sits with short), so "longer sleeves" can step along it. */
export const SLEEVES = ["none", "cap", "short", "puff", "three_quarter", "long"] as const;
export const NECKLINES = ["crew", "v", "square", "halter", "scoop", "sweetheart", "turtleneck", "off_shoulder"] as const;
export const FABRICS = ["cotton", "satin", "linen", "knit", "denim", "leather", "velvet", "sequin"] as const;
export const PATTERNS = ["solid", "floral", "stripe", "polka_dot", "plaid", "checkered", "camo", "leopard", "chevron"] as const;
/** Surface treatment on top of the fabric: glow makes the whole product emissive. */
export const FINISHES = ["matte", "glossy", "metallic", "glow"] as const;

/** Features the parametric 3D models know how to draw. Unknown features are still kept. */
export const KNOWN_FEATURES = ["phone_pockets", "converts_to_skirt", "laptop_stand", "headphones"] as const;

export const CLOTHING: readonly Category[] = ["dress", "top", "skirt"];

// ---------- Edits a judge can ask for: parts, decals, add-ons ----------

/** Where a decal or add-on sits. Every renderer resolves every placement for every category. */
export const PLACEMENTS = ["front", "back", "left", "right", "top", "bottom", "waist"] as const;
export type Placement = (typeof PLACEMENTS)[number];
/** Icons drawn as vector shapes. Anything else is an emoji (pictures) or text (words, names, numbers). */
export const DECAL_SHAPES = [
  "star", "heart", "circle", "square", "triangle", "diamond", "lightning", "moon", "sun", "x", "check",
  "arrow", "flower", "smiley", "peace", "paw", "music_note", "cloud", "crown", "spiral",
] as const;
export const DECAL_KINDS = ["text", "emoji", "shape"] as const;
/** Primitives an add-on is built from. bow, spike, fin and dome are small composites. */
export const ADDON_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "capsule", "bow", "spike", "fin", "dome"] as const;
/** Shapes for a generic product's body, so any wish can render instantly before the AI mesh lands. */
export const BODY_SHAPES = ["box", "cylinder", "sphere", "cone", "capsule", "torus"] as const;

/**
 * Named parts of each parametric model. A part can be resized, recolored or hidden through spec.parts.
 * Renderers must draw every name listed here (checked by the render-coverage test).
 */
export const PARTS = {
  dress: ["skirt", "bodice", "sleeves", "pockets", "seam"],
  top: ["bodice", "sleeves"],
  skirt: ["skirt", "pockets"],
  backpack: ["body", "front_pocket", "straps", "handle", "side_pocket", "stand", "zipper"],
  helmet: ["shell", "vents", "visor", "rim", "headphones"],
  generic: ["body"],
} as const satisfies Record<Category, readonly string[]>;
export type PartName = (typeof PARTS)[keyof typeof PARTS][number];
export const ALL_PARTS = [...new Set(Object.values(PARTS).flat())] as PartName[];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const factor = z.number().min(0.3).max(3);

export const PartStyle = z.object({
  scale: factor.optional(),
  color: hex.optional(),
  hidden: z.boolean().optional(),
});
export type PartStyle = z.infer<typeof PartStyle>;

export const Decal = z.object({
  kind: z.enum(DECAL_KINDS),
  /** text: the words; emoji: one emoji; shape: a DECAL_SHAPES name. */
  content: z.string().trim().min(1).max(24),
  placement: z.enum(PLACEMENTS).default("front"),
  color: hex.optional(),
  size: factor.optional(),
});
export type Decal = z.infer<typeof Decal>;

export const Addon = z.object({
  name: z.string().trim().min(1).max(30),
  shape: z.enum(ADDON_SHAPES),
  placement: z.enum(PLACEMENTS).default("front"),
  size: factor.optional(),
  color: hex.optional(),
  glow: z.boolean().optional(),
  count: z.number().int().min(1).max(6).optional(),
});
export type Addon = z.infer<typeof Addon>;

export const Body = z.object({
  shape: z.enum(BODY_SHAPES),
  /** Scene units; the pedestal is ~1.1 wide and the camera frames ~1.5 tall. */
  width: z.number().min(0.02).max(1.2).default(0.5),
  height: z.number().min(0.02).max(1.4).default(0.6),
  depth: z.number().min(0.02).max(1.2).optional(),
});
export type Body = z.infer<typeof Body>;

const fields = {
  category: z.enum(CATEGORIES),
  name: z.string().trim().min(1).max(60),
  length: z.enum(LENGTHS),
  silhouette: z.enum(SILHOUETTES),
  sleeves: z.enum(SLEEVES),
  neckline: z.enum(NECKLINES),
  color: hex,
  fabric: z.enum(FABRICS),
  pattern: z.enum(PATTERNS),
  finish: z.enum(FINISHES),
  size: z.string().trim().min(1).max(20),
  features: z.array(z.string().trim().min(1).max(40)).max(12),
  target_price_usd: z.number().positive().max(10000),
  notes: z.string().max(300),
  /** Overall model size, 1 = default. */
  scale: z.number().min(0.5).max(1.8),
  parts: z.record(z.string(), PartStyle),
  decals: z.array(Decal).max(8),
  addons: z.array(Addon).max(10),
  body: Body,
};

export const ProductSpec = z.object({
  category: fields.category.default("generic"),
  name: fields.name.optional(),
  length: fields.length.optional(),
  silhouette: fields.silhouette.optional(),
  sleeves: fields.sleeves.optional(),
  neckline: fields.neckline.optional(),
  color: fields.color.optional(),
  fabric: fields.fabric.optional(),
  pattern: fields.pattern.optional(),
  finish: fields.finish.optional(),
  size: fields.size.optional(),
  features: fields.features.optional(),
  target_price_usd: fields.target_price_usd.optional(),
  notes: fields.notes.optional(),
  scale: fields.scale.optional(),
  parts: fields.parts.optional(),
  decals: fields.decals.optional(),
  addons: fields.addons.optional(),
  body: fields.body.optional(),
});
export type ProductSpec = z.infer<typeof ProductSpec>;
export type Category = (typeof CATEGORIES)[number];
export type SpecField = keyof typeof fields;
export const SPEC_FIELDS = Object.keys(fields) as SpecField[];

export const SpecPatch = ProductSpec.partial();
export type SpecPatch = Partial<ProductSpec>;

export const defaultSpec: ProductSpec = { category: "generic" };

/**
 * Apply a patch field by field. Invalid fields are dropped, never thrown.
 * Unknown keys are ignored. Returns the new spec and the list of fields that changed.
 */
export function applyPatch(spec: ProductSpec, patch: unknown): { spec: ProductSpec; changed: SpecField[]; dropped: string[] } {
  const next: ProductSpec = { ...spec };
  const changed: SpecField[] = [];
  const dropped: string[] = [];
  if (!patch || typeof patch !== "object") return { spec: next, changed, dropped };

  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in fields)) {
      dropped.push(key);
      continue;
    }
    const field = key as SpecField;
    let value = raw;
    if (field === "color" && typeof value === "string") value = normalizeHex(value);
    if (field === "target_price_usd" && typeof value === "string") value = Number(value.replace(/[^0-9.]/g, ""));
    if (field === "features" && Array.isArray(value)) value = [...new Set(value.map((f) => String(f).trim().toLowerCase().replace(/\s+/g, "_")))];
    if (field === "scale" && typeof value === "number") value = Math.min(1.8, Math.max(0.5, value));
    // A body slightly out of range (a 6 mm phone case, a 2 m lamp) is clamped, not dropped.
    if (field === "body" && value && typeof value === "object" && !Array.isArray(value)) {
      const b = { ...(value as Record<string, unknown>) };
      for (const [k, max] of [["width", 1.2], ["height", 1.4], ["depth", 1.2]] as const) if (typeof b[k] === "number") b[k] = Math.min(max, Math.max(0.02, b[k] as number));
      if (typeof b.shape === "string") b.shape = b.shape.trim().toLowerCase();
      value = b;
    }
    // Lists of edits: keep the valid items, drop the rest (an empty list clears them all).
    if ((field === "decals" || field === "addons") && Array.isArray(value)) {
      const schema = field === "decals" ? Decal : Addon;
      const max = field === "decals" ? 8 : 10;
      const items = value.map((v) => schema.safeParse(normalizeItem(v))).filter((r) => r.success).map((r) => r.data!);
      if (items.length < value.length) dropped.push(`${key}[${value.length - items.length}]`);
      value = items.slice(-max);
    }
    // Parts merge one part at a time; null clears that part's overrides.
    if (field === "parts" && value && typeof value === "object" && !Array.isArray(value)) {
      const merged: Record<string, PartStyle> = { ...(next.parts ?? {}) };
      for (const [rawName, style] of Object.entries(value as Record<string, unknown>)) {
        const name = normalizePartName(rawName);
        if (style === null) {
          delete merged[name];
          continue;
        }
        const p = PartStyle.safeParse(normalizeItem(style));
        if (!p.success) {
          dropped.push(`parts.${rawName}`);
          continue;
        }
        const style2 = { ...merged[name], ...p.data };
        if (Object.keys(style2).length) merged[name] = style2;
      }
      value = merged;
    }
    if (value === null || value === undefined) {
      dropped.push(key);
      continue;
    }
    const parsed = fields[field].safeParse(value);
    if (!parsed.success) {
      dropped.push(key);
      continue;
    }
    if (JSON.stringify((next as Record<string, unknown>)[field]) !== JSON.stringify(parsed.data)) {
      (next as Record<string, unknown>)[field] = parsed.data;
      changed.push(field);
    }
  }
  return { spec: next, changed, dropped };
}

/** Same color normalization inside nested decal / add-on / part objects; factors clamped into range. */
function normalizeItem(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  if (typeof o.color === "string") o.color = normalizeHex(o.color);
  if (o.color === null) delete o.color;
  for (const k of ["scale", "size"]) if (typeof o[k] === "number") o[k] = Math.min(3, Math.max(0.3, o[k] as number));
  if (typeof o.shape === "string") o.shape = o.shape.trim().toLowerCase();
  if (typeof o.placement === "string") o.placement = PLACEMENT_ALIASES[o.placement.trim().toLowerCase()] ?? o.placement.trim().toLowerCase();
  if (typeof o.count === "number") o.count = Math.min(6, Math.max(1, Math.round(o.count)));
  return o;
}

const PLACEMENT_ALIASES: Record<string, (typeof PLACEMENTS)[number]> = {
  rear: "back", behind: "back", chest: "front", center: "front", centre: "front", side: "right",
  "left side": "left", "right side": "right", shoulder: "top", shoulders: "top", hem: "bottom", base: "bottom",
  belt: "waist", middle: "waist",
};

/** "pocket" -> "pockets", "laptop stand" -> "stand"; unknown names pass through snake_cased. */
export function normalizePartName(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return PART_NAME_ALIASES[s] ?? s;
}
const PART_NAME_ALIASES: Record<string, string> = {
  pocket: "pockets", sleeve: "sleeves", strap: "straps", shoulder_straps: "straps", vent: "vents",
  laptop_stand: "stand", zip: "zipper", zippers: "zipper", side_pockets: "side_pocket", front_pockets: "front_pocket",
  pouch: "front_pocket", ear_cups: "headphones", earcups: "headphones", headphone: "headphones", brim: "visor",
  top_handle: "handle", waist_seam: "seam",
};

function normalizeHex(v: string): string {
  const s = v.trim();
  if (/^#?[0-9a-fA-F]{3}$/.test(s)) {
    const h = s.replace("#", "");
    return "#" + h.split("").map((c) => c + c).join("").toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toUpperCase();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  return COLOR_NAMES[s.toLowerCase()] ?? s;
}

export const COLOR_NAMES: Record<string, string> = {
  emerald: "#1F8A5B", green: "#2E9E5B", "forest green": "#1E5631", mint: "#98E2C6", sage: "#9CAF88", olive: "#708238",
  teal: "#1E8C8C", turquoise: "#30C5C2", blue: "#3A6FD8", navy: "#1F2A55", "sky blue": "#7EC8F2", cobalt: "#1D4FBF",
  lavender: "#B9A3F0", purple: "#7B4FC9", lilac: "#C8A2C8", violet: "#7F3FBF", plum: "#7A2E5C",
  pink: "#F28DB2", "hot pink": "#FF3E9A", blush: "#F4C2C2", rose: "#E8798E", magenta: "#D6249F",
  red: "#D7263D", crimson: "#B0102D", burgundy: "#7A1F2B", maroon: "#6B1E2A", coral: "#FF7F6B",
  orange: "#F28C28", peach: "#FFB38A", rust: "#B7472A", terracotta: "#C9643B",
  yellow: "#F6D44A", mustard: "#D4A017", gold: "#E2B13C", cream: "#F4EBD0", ivory: "#F6F1E1", beige: "#D9C6A5",
  tan: "#C8A27A", camel: "#BF8F5B", brown: "#7B4A2D", chocolate: "#4E2A1A",
  white: "#F4F4F2", black: "#1A1A1D", grey: "#8A8D93", gray: "#8A8D93", charcoal: "#3A3D42", silver: "#C0C4CC",
};

// ---------- Matches, campaigns, pledges ----------

export const EXISTS_SCORE = 80;
export const CLOSE_SCORE = 50;

export interface Match {
  source: string;
  title: string;
  url: string;
  price: number | null;
  image: string | null;
  score: number;
  missing: string[];
}

export const CAMPAIGN_MAX_MS = 6 * 24 * 60 * 60 * 1000;
export type CampaignStatus = "funding" | "capturing" | "funded" | "releasing" | "expired";
export type PledgeStatus = "created" | "held" | "failed" | "captured" | "released" | "capture_failed";
export type WishStatus = "drafting" | "locked";

export interface Maker {
  name: string;
  location: string;
  specialty: string;
  url: string;
  simulated: true;
}

export interface PublicPledge {
  id: string;
  email: string; // masked
  status: PledgeStatus;
  failReason: string | null;
  createdAt: number;
  /** Placed by the genie as a Visa Trusted Agent Protocol agent, verified by Wish it. */
  agent?: { keyid: string } | null;
}

/** One verification step of a Trusted Agent Protocol request, for the live trust log. */
export interface TapCheck { name: string; ok: boolean; detail: string }
export interface TapLogEntry {
  at: number;
  /** "pledge" for the genie backing it; otherwise which bad request was tried. */
  kind: "pledge" | "unsigned" | "replay" | "tampered" | "expired" | "over_limit";
  ok: boolean;
  checks: TapCheck[];
  outcome: string;
}
export interface TapLogPayload { campaignId: string; entry: TapLogEntry }

export interface Campaign {
  id: string;
  wishId: string;
  name: string;
  spec: ProductSpec;
  modelUrl: string | null;
  priceCents: number;
  targetBackers: number;
  held: number;
  captured: number;
  deadlineAt: number;
  createdAt: number;
  status: CampaignStatus;
  maker: Maker | null;
  pledges: PublicPledge[];
  paymentMode: "stripe" | "mock";
}

export const CreateCampaignBody = z.object({
  wishId: z.string().min(1),
  priceCents: z.number().int().min(50).max(1_000_000),
  targetBackers: z.number().int().min(1).max(10_000),
  deadlineAt: z.number().int(),
});
export type CreateCampaignBody = z.infer<typeof CreateCampaignBody>;

export const PledgeBody = z.object({ email: z.string().email().max(200) });

// ---------- API ----------

export interface WishDTO {
  id: string;
  spec: ProductSpec;
  status: WishStatus;
  modelUrl: string | null;
  campaignId: string | null;
}
export interface TurnRequest { text: string }
export interface TurnResponse { say: string; spec: ProductSpec; changed: SpecField[]; lock: boolean; ms: number; brain: "llm" | "rules" }
export interface MatchesResponse { matches: Match[]; searched: number; total: number; pending: boolean; sample: boolean }
export interface PledgeResponse { pledgeId: string; clientSecret: string | null; paymentMode: "stripe" | "mock" }
export interface CartesiaTokenResponse { token: string; expiresAt: number; version: string }
export interface ConfigResponse {
  stripePublishableKey: string | null;
  paymentMode: "stripe" | "mock";
  cartesia: boolean;
  brain: "llm" | "rules";
  demoMode: boolean;
  publicUrl: string;
}

// ---------- Socket events ----------

export const EVENTS = {
  specUpdated: "spec:updated",
  meshyReady: "meshy:ready",
  matchesReady: "matches:ready",
  campaignUpdated: "campaign:updated",
  tapLog: "tap:log",
  join: "join", // client -> server: { room }
} as const;

export interface SpecUpdatedPayload { wishId: string; spec: ProductSpec; changed: SpecField[] }
export interface MeshyReadyPayload { wishId: string; modelUrl: string }
export interface MatchesReadyPayload extends MatchesResponse { wishId: string }
export interface CampaignUpdatedPayload { campaign: Campaign }
