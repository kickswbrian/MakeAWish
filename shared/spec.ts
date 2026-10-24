import { z } from "zod";

// ---------- ProductSpec: the single source of truth ----------

export const CATEGORIES = ["dress", "top", "skirt", "backpack", "helmet", "generic"] as const;
export const LENGTHS = ["mini", "knee", "midi", "maxi"] as const;
export const SILHOUETTES = ["fitted", "a_line", "wrap", "flowy"] as const;
export const SLEEVES = ["none", "cap", "short", "long"] as const;
export const NECKLINES = ["crew", "v", "square", "halter"] as const;
export const FABRICS = ["cotton", "satin", "linen", "knit"] as const;
export const PATTERNS = ["solid", "floral", "stripe"] as const;

/** Features the parametric 3D models know how to draw. Unknown features are still kept. */
export const KNOWN_FEATURES = ["phone_pockets", "converts_to_skirt", "laptop_stand", "headphones"] as const;

export const CLOTHING: readonly Category[] = ["dress", "top", "skirt"];

const fields = {
  category: z.enum(CATEGORIES),
  name: z.string().trim().min(1).max(60),
  length: z.enum(LENGTHS),
  silhouette: z.enum(SILHOUETTES),
  sleeves: z.enum(SLEEVES),
  neckline: z.enum(NECKLINES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fabric: z.enum(FABRICS),
  pattern: z.enum(PATTERNS),
  size: z.string().trim().min(1).max(20),
  features: z.array(z.string().trim().min(1).max(40)).max(12),
  target_price_usd: z.number().positive().max(10000),
  notes: z.string().max(300),
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
  size: fields.size.optional(),
  features: fields.features.optional(),
  target_price_usd: fields.target_price_usd.optional(),
  notes: fields.notes.optional(),
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
}

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
  join: "join", // client -> server: { room }
} as const;

export interface SpecUpdatedPayload { wishId: string; spec: ProductSpec; changed: SpecField[] }
export interface MeshyReadyPayload { wishId: string; modelUrl: string }
export interface MatchesReadyPayload extends MatchesResponse { wishId: string }
export interface CampaignUpdatedPayload { campaign: Campaign }
