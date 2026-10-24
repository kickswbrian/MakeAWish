import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
export const WEB_DIST = path.join(ROOT, "web", "dist");

const s = (k: string) => (process.env[k] && process.env[k]!.trim()) || undefined;
const n = (k: string, fallback: number) => {
  const v = Number(s(k));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** Public deployment: stricter limits, locked-down CORS and admin, generic 500s. */
export const isProd = process.env.NODE_ENV === "production";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: s("PUBLIC_URL") ?? `http://localhost:${process.env.PORT ?? 3000}`,
  demoMode: s("DEMO_MODE") === "1" || s("DEMO_MODE") === "true",
  adminToken: s("ADMIN_TOKEN"),
  anthropicKey: s("ANTHROPIC_API_KEY") ?? s("ANTHROPIC_AUTH_TOKEN"),
  /**
   * Edits: small scoped patches, latency first. Sonnet 5 with thinking off measured first patch
   * ~1.9 s vs ~2.4-3.9 s for Opus 5.5 fast (whose thinking can't be disabled) on the same edits.
   */
  editModel: s("EDIT_MODEL") ?? "claude-sonnet-5",
  /** New designs: planner + parallel part builders. */
  designModel: s("DESIGN_MODEL") ?? "claude-opus-5-5",
  /** Fast mode (Opus only): ~2x output speed. Measured ~290 tok/s vs ~140 for Haiku 4.5. */
  fastMode: (s("FAST_MODE") ?? "1") !== "0",
  /** Used when the main model is rate-limited or fails before streaming. */
  fallbackModel: s("FALLBACK_MODEL") ?? "claude-haiku-4-5",
  cartesiaKey: s("CARTESIA_API_KEY"),
  cartesiaVersion: s("CARTESIA_VERSION") ?? "2026-08-14",
  apifyToken: s("APIFY_TOKEN"),
  apifyActor: s("APIFY_ACTOR"), // e.g. "yourname~wish-matcher"
  stripeSecret: s("STRIPE_SECRET_KEY"),
  stripePublishable: s("STRIPE_PUBLISHABLE_KEY"),
  stripeWebhookSecret: s("STRIPE_WEBHOOK_SECRET"),
  /** Extra origins allowed to open Socket.IO connections (comma-separated). PUBLIC_URL is always allowed. */
  allowedOrigins: (s("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  /**
   * Daily caps on paid calls, across all users. Past a cap the app degrades to its free fallback
   * (rule-based genie, sample matches, browser speech) instead of erroring. 0 = off.
   */
  budget: {
    llmTurns: n("DAILY_LLM_TURNS", 1500),
    apifySearches: n("DAILY_APIFY_SEARCHES", 60),
    cartesiaTokens: n("DAILY_CARTESIA_TOKENS", 600),
  },
};

export const paymentMode: "stripe" | "mock" = env.stripeSecret && env.stripePublishable ? "stripe" : "mock";

/** Refuse to boot a public deployment with settings that leave it open. */
export function assertSafeConfig() {
  if (!isProd) return;
  const problems: string[] = [];
  if (!env.adminToken || env.adminToken.length < 24) problems.push("ADMIN_TOKEN must be set (24+ chars); admin routes are otherwise open");
  if (paymentMode === "stripe" && !env.stripeWebhookSecret) problems.push("STRIPE_WEBHOOK_SECRET is required with Stripe keys; unsigned webhooks could fake payments");
  if (paymentMode === "stripe" && env.stripeSecret?.startsWith("sk_live")) console.warn("[wish-it] WARNING: live Stripe key in use");
  if (!env.publicUrl.startsWith("https://")) problems.push("PUBLIC_URL must be the https:// address of the deployment");
  if (problems.length) {
    console.error(`[wish-it] refusing to start in production:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
}

export function logConfig() {
  const on = (b: unknown) => (b ? "on " : "off");
  console.log(
    [
      `[wish-it] ${env.publicUrl}  demoMode=${env.demoMode}  ${isProd ? "PRODUCTION" : "development"}`,
      `  brain    ${on(env.anthropicKey)} ${env.anthropicKey ? `design=${env.designModel} edit=${env.editModel}` : "(rule-based fallback)"}`,
      `  cartesia ${on(env.cartesiaKey)} ${env.cartesiaKey ? "" : "(browser speech fallback)"}`,
      `  apify    ${on(env.apifyToken && env.apifyActor)} ${env.apifyToken && env.apifyActor ? env.apifyActor : "(sample matches)"}`,
      `  stripe   ${paymentMode === "stripe" ? "on  test mode" : "off (simulated payments)"}${paymentMode === "stripe" && !env.stripeWebhookSecret ? "  WARNING: no STRIPE_WEBHOOK_SECRET, relying on polling" : ""}`,
    ].join("\n"),
  );
}
