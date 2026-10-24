import { z } from "zod";
import type { Patch, Product, ProductMeta } from "./product.ts";

export type Vec3 = [number, number, number];

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
  /** How much the listing's photo looks like the shopper's render (0-100), once Claude has compared them. */
  visual?: number | null;
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
  product: Product;
  /** PNG/WebP data URL snapshot of the product, for lists and link previews. */
  thumb: string | null;
  priceCents: number;
  targetBackers: number;
  held: number;
  captured: number;
  deadlineAt: number;
  createdAt: number;
  status: CampaignStatus;
  maker: Maker | null;
  pledges: PublicPledge[];
  /** Community upvotes: one per browser, anyone can add theirs. */
  votes: number;
  paymentMode: "stripe" | "mock";
}

export const CreateCampaignBody = z.object({
  wishId: z.string().min(1),
  priceCents: z.number().int().min(50).max(1_000_000),
  targetBackers: z.number().int().min(1).max(10_000),
  deadlineAt: z.number().int(),
});
export type CreateCampaignBody = z.infer<typeof CreateCampaignBody>;

/** An upvote (or taking it back). `voter` is a random id the browser keeps. */
export const VoteBody = z.object({ voter: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), up: z.boolean() });

export const PledgeBody = z.object({ email: z.string().email().max(200) });

// ---------- API ----------

export interface WishDTO {
  id: string;
  product: Product;
  status: WishStatus;
  thumb: string | null;
  campaignId: string | null;
}

/** The tapped part, with the tap point and surface normal in that part's local frame. */
export interface TurnSelection {
  partId: string;
  point?: Vec3;
  normal?: Vec3;
  /** Euler XYZ degrees that turn a kit part's +Z onto the normal (flush mounting). */
  rotation?: Vec3;
}

/** Where each part ended up, in the root's frame (meters). Computed by the renderer. */
export interface OutlineEntry { id: string; center: Vec3; size: Vec3 }

export interface TurnRequest {
  text: string;
  product: Product;
  selection?: TurnSelection | null;
  outline?: OutlineEntry[];
  /** Started on an early end-of-turn guess; the client may still abort it. */
  speculative?: boolean;
  /** A fresh wish: the client already shows this template (as `product`); the genie customizes it. */
  template?: string | null;
}

export interface TurnTiming {
  /** ms from request received to: Claude request sent, first token, first patch, last patch, done. */
  sent?: number;
  firstToken?: number;
  firstPatch?: number;
  lastPatch?: number;
  done?: number;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  calls?: number;
}

/** Newline-delimited JSON events streamed back from POST /api/wish/:id/turn. */
export type TurnEvent =
  | { t: "start"; mode: "create" | "edit"; model: string }
  /** The genie is starting a different product: clear the stage before the next patches. */
  | { t: "reset" }
  | { t: "patches"; patches: Patch[]; at: number }
  | { t: "meta"; meta: ProductMeta }
  | { t: "say"; text: string }
  | { t: "lock" }
  | { t: "done"; ms: number; brain: "llm" | "rules"; timing: TurnTiming; rejected: number }
  | { t: "error"; message: string };
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
  productUpdated: "product:updated",
  matchesReady: "matches:ready",
  campaignUpdated: "campaign:updated",
  tapLog: "tap:log",
  join: "join", // client -> server: { room }
} as const;

export interface ProductUpdatedPayload { wishId: string; product: Product }
export interface MatchesReadyPayload extends MatchesResponse { wishId: string }
export interface CampaignUpdatedPayload { campaign: Campaign }
