import crypto from "node:crypto";
import type { Request } from "express";

/**
 * The genie calls Wish it's merchant endpoint over loopback, like an outside agent would. Those
 * calls carry this per-boot secret so they don't share one rate-limit bucket with everyone else
 * and so only they can use the trust-demo header. Outside requests never know it.
 */
export const INTERNAL_SECRET = crypto.randomBytes(24).toString("hex");
export const INTERNAL_HEADER = "x-wishit-internal";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const SECRET = Buffer.from(INTERNAL_SECRET);

export function isInternal(req: Request): boolean {
  const given = req.get(INTERNAL_HEADER);
  if (!given) return false;
  // Compare bytes, not characters: a non-ASCII header of the right length must not throw.
  const a = Buffer.from(given);
  if (a.length !== SECRET.length) return false;
  return LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.get("x-forwarded-for") && crypto.timingSafeEqual(a, SECRET);
}
