import crypto from "node:crypto";
import type { TapCheck } from "@wishit/shared";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { agentKey, signObject, signRequest, verifyContainer, verifyRequest } from "./tap.ts";
import { newId } from "./util.ts";
import { INTERNAL_HEADER, INTERNAL_SECRET } from "./internal.ts";

/**
 * Agent purchase of a store listing: "Purchase" on a match card, and the genie buys it without the
 * shopper leaving the app, the same way it backs campaigns (agent.ts):
 *
 *   shopper confirms  ->  mandate (exactly this listing, at most its price, 10 minutes)
 *   genie (agent): signed POST /api/agent/orders  (RFC 9421 agent-payer-auth + signed agenticPaymentContainer)
 *   merchant: verifies the signature, the container and the mandate, then records the order.
 *
 * The listing and price come from the wish's own search results, never from the browser. Wish it isn't
 * Amazon or Google: no real store checkout happens and no card is charged. Orders are test-mode records
 * of what the agent was authorized to buy and that the merchant verified it.
 */

db.exec(`CREATE TABLE IF NOT EXISTS order_mandates (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  max_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_orders (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  keyid TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

export const ORDER_PATH = "/api/agent/orders";
const SELF = () => `127.0.0.1:${env.port}`;
const MANDATE_MS = 10 * 60_000;

interface Listing { title: string; url: string; source: string; price: number | null }
interface MandateRow { id: string; wish_id: string; url: string; max_cents: number; expires_at: number; status: string }
export interface OrderResult { status: number; body: { ok: boolean; checks: TapCheck[]; outcome: string; orderId?: string; amountCents?: number } }

/** One of this wish's search results, by its link. */
function listing(wishId: string, url: string): Listing | null {
  return (db.prepare("SELECT title, url, source, price FROM matches WHERE wish_id = ? AND url = ?").get(wishId, url) as Listing | undefined) ?? null;
}

/** The genie buys this listing for the shopper (they just confirmed it at its price). */
export async function agentBuy(wishId: string, url: string): Promise<OrderResult> {
  const l = listing(wishId, url);
  if (!l) return { status: 404, body: { ok: false, checks: [], outcome: "That listing isn't in this wish's matches" } };
  if (l.price == null || l.price <= 0) return { status: 400, body: { ok: false, checks: [], outcome: "This listing has no price to pay" } };
  const amountCents = Math.round(l.price * 100);
  const mandate: MandateRow = { id: newId(), wish_id: wishId, url, max_cents: amountCents, expires_at: Date.now() + MANDATE_MS, status: "active" };
  db.prepare("INSERT INTO order_mandates (id, wish_id, url, max_cents, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)")
    .run(mandate.id, wishId, url, amountCents, mandate.expires_at, Date.now());
  const nonce = crypto.randomBytes(32).toString("base64");
  const container = signObject({ nonce, kid: agentKey.kid, alg: "Ed25519", mandateId: mandate.id, wishId, url, amountCents });
  const body = JSON.stringify({ wishId, url, amountCents, agenticPaymentContainer: container });
  const { headers } = signRequest(SELF(), ORDER_PATH, body, "agent-payer-auth", { nonce });
  const res = await fetch(`http://${SELF()}${ORDER_PATH}`, { method: "POST", headers: { "content-type": "application/json", [INTERNAL_HEADER]: INTERNAL_SECRET, ...headers }, body });
  return { status: res.status, body: (await res.json()) as OrderResult["body"] };
}

/** Merchant side of POST /api/agent/orders: verify the agent, its container and the shopper's mandate. */
export function handleAgentOrder(req: { host: string; path: string; headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): OrderResult {
  const fail = (checks: TapCheck[], outcome: string): OrderResult => ({ status: 403, body: { ok: false, checks, outcome } });
  const tap = verifyRequest({ authority: req.host, path: req.path, headers: req.headers, rawBody: req.rawBody });
  const checks = [...tap.checks];
  if (!tap.ok) return fail(checks, checks[checks.length - 1]?.detail ?? "Not a verified agent");

  let body: { wishId?: string; url?: string; amountCents?: number; agenticPaymentContainer?: Record<string, unknown> };
  try {
    body = JSON.parse(req.rawBody.toString("utf8"));
  } catch {
    return fail(checks, "Body isn't JSON");
  }
  const container = verifyContainer(body.agenticPaymentContainer, tap.nonce!, tap.keyid!);
  checks.push(container);
  if (!container.ok) return fail(checks, container.detail);
  const pc = body.agenticPaymentContainer!;

  const m = db.prepare("SELECT * FROM order_mandates WHERE id = ?").get(String(pc.mandateId)) as MandateRow | undefined;
  const amount = Number(pc.amountCents);
  const l = m ? listing(m.wish_id, m.url) : null;
  const problem =
    !m ? "No mandate from the shopper"
      : m.status !== "active" ? "Mandate already used"
      : m.expires_at < Date.now() ? "Mandate expired"
      : pc.wishId !== m.wish_id || pc.url !== m.url || body.url !== m.url ? "Mandate is for a different listing"
      : !l ? "Listing no longer in the matches"
      : amount !== Math.round((l.price ?? 0) * 100) ? "Amount isn't the listing's price"
      : amount > m.max_cents ? `$${(amount / 100).toFixed(2)} is over the shopper's $${(m.max_cents / 100).toFixed(2)} limit`
      : null;
  checks.push({ name: "Within the shopper's mandate", ok: !problem, detail: problem ?? `$${(amount / 100).toFixed(2)} for exactly this listing, within 10 minutes` });
  if (problem) return fail(checks, problem);

  db.prepare("UPDATE order_mandates SET status = 'used' WHERE id = ?").run(m!.id);
  const orderId = newId();
  db.prepare("INSERT INTO agent_orders (id, wish_id, url, title, source, amount_cents, keyid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(orderId, m!.wish_id, m!.url, l!.title, l!.source, amount, tap.keyid!, Date.now());
  checks.push({ name: "Order placed", ok: true, detail: `Test order ${orderId.toUpperCase()} for $${(amount / 100).toFixed(2)} (no real store checkout or charge)` });
  console.log(`[tap] order ${orderId} ACCEPTED: ${l!.title} $${(amount / 100).toFixed(2)}`);
  return { status: 200, body: { ok: true, checks, outcome: "Bought by your genie", orderId, amountCents: amount } };
}
