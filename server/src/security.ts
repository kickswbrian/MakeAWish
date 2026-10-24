import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { db } from "./db.ts";
import { env, isProd } from "./env.ts";
import { AppError, sendError, unauthorized } from "./http.ts";

// ---------- Headers ----------

/**
 * Security headers. The CSP lists every third party the web app talks to:
 * Stripe (card form), Cartesia (voice websocket), Google Fonts, gstatic (drei's Draco decoder,
 * run as wasm in a blob worker) and listing images from any store (https:).
 */
export const securityHeaders: RequestHandler[] = [
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", "https://js.stripe.com", "https://*.js.stripe.com", "https://www.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "data:", "blob:"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "data:", "blob:", "https://api.stripe.com", "https://api.cartesia.ai", "wss://api.cartesia.ai", "https://www.gstatic.com"],
        frameSrc: ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Stripe's iframes and cross-origin listing images don't send CORP headers.
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  }),
  (_req, res, next) => {
    // The genie needs the mic; nothing needs the camera or location. Stripe's iframe needs payment.
    res.setHeader("Permissions-Policy", 'microphone=(self), camera=(), geolocation=(), payment=(self "https://js.stripe.com")');
    next();
  },
];

/** Socket.IO origin check: the deployment's own origin (plus ALLOWED_ORIGINS) in production. */
export const socketOrigins: true | string[] = isProd ? [new URL(env.publicUrl).origin, ...env.allowedOrigins] : true;

// ---------- Rate limits ----------

// Local development gets 10x headroom so testing never trips a limit.
const scale = isProd ? 1 : 10;

function limiter(name: string, windowMs: number, limit: number, message: string, opts: { skipSuccessfulRequests?: boolean } = {}) {
  return rateLimit({
    windowMs,
    limit: limit * scale,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: opts.skipSuccessfulRequests,
    // Separate counters per tier, so a busy poller doesn't eat the turn budget.
    keyGenerator: (req) => `${name}:${req.ip}`,
    handler: (req, res, _next, options) => {
      console.warn(`[limit] ${name} ${req.ip} ${req.method} ${req.path}`);
      res.setHeader("Retry-After", String(Math.ceil(options.windowMs / 1000)));
      sendError(res, req, new AppError(message, 429, "RATE_LIMITED", { tier: name }));
    },
  });
}

const MIN = 60_000;

/**
 * Every route maps to one of these tiers (see index.ts). Per IP. Paid upstreams get the tightest limits;
 * pledge creation is tight to block card testing.
 */
export const limits = {
  /** Blanket cap on every /api request. */
  api: limiter("api", MIN, 240, "Too many requests. Slow down a little."),
  read: limiter("read", MIN, 120, "Too many requests. Slow down a little."),
  createWish: limiter("create-wish", 10 * MIN, 20, "That's a lot of new wishes. Try again in a few minutes."),
  /** Claude call per turn. */
  turn: [
    limiter("turn", MIN, 20, "The genie needs a breath. Try again in a minute."),
    limiter("turn-day", 24 * 60 * MIN, 300, "You've used today's wishes. Come back tomorrow."),
  ],
  editProduct: limiter("edit-product", MIN, 60, "Too many edits. Slow down a little."),
  /** Apify store search. */
  search: limiter("search", 10 * MIN, 6, "Too many store searches. Try again in a few minutes."),
  createCampaign: limiter("create-campaign", 10 * MIN, 5, "Too many wishes launched. Try again in a few minutes."),
  pledge: limiter("pledge", 10 * MIN, 5, "Too many pledge attempts. Try again in a few minutes."),
  confirm: limiter("confirm", 10 * MIN, 10, "Too many card attempts. Try again in a few minutes."),
  voiceToken: limiter("voice-token", 10 * MIN, 20, "Voice is busy. Try again in a few minutes."),
  /** Failed admin attempts only, against token guessing. */
  admin: limiter("admin", 15 * MIN, 10, "Too many admin attempts.", { skipSuccessfulRequests: true }),
} satisfies Record<string, RequestHandler | RequestHandler[]>;

// ---------- Daily spend caps ----------

db.exec("CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind))");
const bump = db.prepare("INSERT INTO usage (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1 RETURNING n");

export type Spend = keyof typeof env.budget;

/**
 * Counts one paid call against today's (UTC) global cap. Returns false once the cap is reached, and the
 * caller falls back to its free path. Stored in SQLite so restarts don't reset it.
 */
export function spend(kind: Spend): boolean {
  const cap = env.budget[kind];
  if (!cap) return true;
  const { n } = bump.get(new Date().toISOString().slice(0, 10), kind) as { n: number };
  if (n === cap + 1) console.warn(`[budget] daily ${kind} cap (${cap}) reached; using fallback until 00:00 UTC`);
  return n <= cap;
}

// ---------- Admin ----------

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Admin routes need x-admin-token. Production refuses to boot without ADMIN_TOKEN (env.assertSafeConfig),
 * so the open branch only exists in local development. ?token= is accepted locally only; in production
 * it would land in access logs.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!env.adminToken) return isProd ? sendError(res, req, unauthorized("Admin disabled")) : next();
  const given = req.get("x-admin-token") ?? (isProd ? undefined : typeof req.query.token === "string" ? req.query.token : undefined);
  if (!given || !sameToken(given, env.adminToken)) return sendError(res, req, unauthorized("Admin token required"));
  next();
}
