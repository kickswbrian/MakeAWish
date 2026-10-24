import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
export const MODELS_DIR = path.join(DATA_DIR, "models");
export const WEB_DIST = path.join(ROOT, "web", "dist");

const s = (k: string) => (process.env[k] && process.env[k]!.trim()) || undefined;

export const env = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: s("PUBLIC_URL") ?? `http://localhost:${process.env.PORT ?? 3000}`,
  demoMode: s("DEMO_MODE") === "1" || s("DEMO_MODE") === "true",
  adminToken: s("ADMIN_TOKEN"),
  anthropicKey: s("ANTHROPIC_API_KEY") ?? s("ANTHROPIC_AUTH_TOKEN"),
  brainModel: s("BRAIN_MODEL") ?? "claude-opus-5-5",
  cartesiaKey: s("CARTESIA_API_KEY"),
  cartesiaVersion: s("CARTESIA_VERSION") ?? "2026-08-14",
  apifyToken: s("APIFY_TOKEN"),
  apifyActor: s("APIFY_ACTOR"), // e.g. "yourname~wish-matcher"
  meshyKey: s("MESHY_API_KEY"),
  stripeSecret: s("STRIPE_SECRET_KEY"),
  stripePublishable: s("STRIPE_PUBLISHABLE_KEY"),
  stripeWebhookSecret: s("STRIPE_WEBHOOK_SECRET"),
};

export const paymentMode: "stripe" | "mock" = env.stripeSecret && env.stripePublishable ? "stripe" : "mock";

export function logConfig() {
  const on = (b: unknown) => (b ? "on " : "off");
  console.log(
    [
      `[wish-it] ${env.publicUrl}  demoMode=${env.demoMode}`,
      `  brain    ${on(env.anthropicKey)} ${env.anthropicKey ? env.brainModel : "(rule-based fallback)"}`,
      `  cartesia ${on(env.cartesiaKey)} ${env.cartesiaKey ? "" : "(browser speech fallback)"}`,
      `  apify    ${on(env.apifyToken && env.apifyActor)} ${env.apifyToken && env.apifyActor ? env.apifyActor : "(sample matches)"}`,
      `  meshy    ${on(env.meshyKey)} ${env.meshyKey ? "" : "(parametric only)"}`,
      `  stripe   ${paymentMode === "stripe" ? "on  test mode" : "off (simulated payments)"}${paymentMode === "stripe" && !env.stripeWebhookSecret ? "  WARNING: no STRIPE_WEBHOOK_SECRET, relying on polling" : ""}`,
    ].join("\n"),
  );
}
