import crypto from "node:crypto";
import { EVENTS, type TapCheck, type TapLogEntry } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { getCampaign } from "./campaigns.ts";
import { heldPledge } from "./demo.ts";
import { agentKey, signObject, signRequest, verifyContainer, verifyRequest } from "./tap.ts";
import { newId } from "./util.ts";

/**
 * Agent checkout: the genie backs a wish for the shopper as a Visa Trusted Agent Protocol agent.
 *
 *   shopper: "back it for me, up to $89"  ->  mandate (cap, expiry, this campaign only)
 *   genie (agent): signed POST /api/agent/campaigns/:id/pledges  (RFC 9421, tag agent-payer-auth,
 *                  plus a signed agenticPaymentContainer that names the mandate and amount)
 *   Wish it (merchant): verifies the TAP signature and container, checks the mandate, then places
 *                  the card hold exactly like any other pledge.
 *
 * The mandate is modelled on Visa Intelligent Commerce "payment instructions" (a spend cap and an
 * expiry the agent can't exceed). VIC itself is partner-only, so the mandate lives here.
 */

interface MandateRow { id: string; campaign_id: string; email: string; max_cents: number; expires_at: number; status: string }

export const MERCHANT_PATH = (campaignId: string) => `/api/agent/campaigns/${campaignId}/pledges`;
// The genie calls Wish it over HTTP like any outside agent would, so the merchant sees a real signed request.
const SELF = () => `127.0.0.1:${env.port}`;

export function createMandate(campaignId: string, email: string, maxCents: number): MandateRow {
  const c = getCampaign(campaignId);
  if (!c) throw new Error("Campaign not found");
  const m: MandateRow = { id: newId(), campaign_id: campaignId, email, max_cents: Math.round(maxCents), expires_at: c.deadlineAt, status: "active" };
  db.prepare("INSERT INTO mandates (id, campaign_id, email, max_cents, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)")
    .run(m.id, m.campaign_id, m.email, m.max_cents, m.expires_at, Date.now());
  return m;
}

// ---------- Agent side ----------

export type Attack = Exclude<TapLogEntry["kind"], "pledge">;

interface SendResult { status: number; body: { ok: boolean; checks: TapCheck[]; outcome: string; pledgeId?: string } }

async function send(path: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const res = await fetch(`http://${SELF()}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  return { status: res.status, body: (await res.json()) as SendResult["body"] };
}

function payload(campaignId: string, mandate: MandateRow, amountCents: number, nonce: string) {
  const container = signObject({ nonce, kid: agentKey.kid, alg: "Ed25519", mandateId: mandate.id, campaignId, amountCents });
  return JSON.stringify({ email: mandate.email, amountCents, agenticPaymentContainer: container });
}

/** The genie places the pledge under the shopper's mandate. */
export async function agentPledge(campaignId: string, email: string, maxCents: number): Promise<SendResult> {
  const c = getCampaign(campaignId);
  if (!c) throw new Error("Campaign not found");
  const mandate = createMandate(campaignId, email, maxCents);
  const path = MERCHANT_PATH(campaignId);
  const nonce = crypto.randomBytes(32).toString("base64");
  const body = payload(campaignId, mandate, c.priceCents, nonce);
  const { headers } = signRequest(SELF(), path, body, "agent-payer-auth", { nonce });
  return send(path, body, headers);
}

/** Demo of what the merchant blocks. None of these can place a hold. */
export async function agentAttack(campaignId: string, kind: Attack): Promise<SendResult> {
  const c = getCampaign(campaignId);
  if (!c) throw new Error("Campaign not found");
  const path = MERCHANT_PATH(campaignId);
  const email = "attacker@example.com";
  if (kind === "unsigned") {
    // A plain bot: right shape, no agent signature.
    return send(path, JSON.stringify({ email, amountCents: c.priceCents }), { "x-tap-demo": kind });
  }
  if (kind === "over_limit") {
    // A properly signed genie request, but the shopper's mandate caps it below the price.
    const mandate = createMandate(campaignId, email, Math.max(1, c.priceCents - 100));
    const nonce = crypto.randomBytes(32).toString("base64");
    const body = payload(campaignId, mandate, c.priceCents, nonce);
    return send(path, body, { ...signRequest(SELF(), path, body, "agent-payer-auth", { nonce }).headers, "x-tap-demo": kind });
  }
  // The next three reuse a request that would otherwise be valid, under a capped mandate, so no
  // hold is ever placed even if a check were missing.
  const mandate = createMandate(campaignId, email, Math.max(1, c.priceCents - 100));
  const nonce = crypto.randomBytes(32).toString("base64");
  const body = payload(campaignId, mandate, c.priceCents, nonce);
  if (kind === "expired") {
    return send(path, body, { ...signRequest(SELF(), path, body, "agent-payer-auth", { nonce, expired: true }).headers, "x-tap-demo": kind });
  }
  const { headers } = signRequest(SELF(), path, body, "agent-payer-auth", { nonce });
  if (kind === "tampered") {
    // Signed for one amount, then edited in flight to pay less.
    const edited = body.replace(`"amountCents":${c.priceCents}`, `"amountCents":${Math.max(50, Math.round(c.priceCents / 10))}`);
    return send(path, edited, { ...headers, "x-tap-demo": kind });
  }
  // replay: the same signed request sent twice; the second one is what's shown.
  await send(path, body, { ...headers, "x-tap-demo": "replay-first" });
  return send(path, body, { ...headers, "x-tap-demo": kind });
}

// ---------- Merchant side ----------

/**
 * Handle a request to /api/agent/campaigns/:id/pledges. Every check is logged to the campaign's
 * trust log (socket event tap:log) so the demo shows exactly why a request was accepted or refused.
 */
export async function handleAgentPledge(campaignId: string, req: { host: string; path: string; headers: Record<string, string | string[] | undefined>; rawBody: string }) {
  const demo = req.headers["x-tap-demo"];
  const kind = (typeof demo === "string" && demo !== "replay-first" ? demo : "pledge") as TapLogEntry["kind"];
  const quiet = demo === "replay-first";
  const finish = (ok: boolean, checks: TapCheck[], outcome: string, extra: Record<string, unknown> = {}) => {
    if (!quiet) {
      const entry: TapLogEntry = { at: Date.now(), kind, ok, checks, outcome };
      emit(`campaign:${campaignId}`, EVENTS.tapLog, { campaignId, entry });
      console.log(`[tap] ${campaignId} ${kind} ${ok ? "ACCEPTED" : "BLOCKED"}: ${outcome}`);
    }
    return { status: ok ? 200 : 403, body: { ok, checks, outcome, ...extra } };
  };

  const tap = verifyRequest({ authority: req.host, path: req.path, headers: req.headers, rawBody: req.rawBody });
  const checks = [...tap.checks];
  if (!tap.ok) return finish(false, checks, checks[checks.length - 1].detail);

  let body: { email?: string; amountCents?: number; agenticPaymentContainer?: Record<string, unknown> };
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return finish(false, checks, "Body isn't JSON");
  }
  const container = verifyContainer(body.agenticPaymentContainer, tap.nonce!, tap.keyid!);
  checks.push(container);
  if (!container.ok) return finish(false, checks, container.detail);
  const pc = body.agenticPaymentContainer!;

  // The payment instruction: what the shopper actually authorized the agent to spend.
  const c = getCampaign(campaignId);
  const m = db.prepare("SELECT * FROM mandates WHERE id = ?").get(String(pc.mandateId)) as MandateRow | undefined;
  const amount = Number(pc.amountCents);
  const problem =
    !c ? "Campaign not found"
      : !m ? "No mandate from the shopper"
      : m.status !== "active" ? "Mandate already used"
      : m.campaign_id !== campaignId || pc.campaignId !== campaignId ? "Mandate is for a different wish"
      : m.expires_at < Date.now() ? "Mandate expired"
      : amount !== c.priceCents ? `Amount $${(amount / 100).toFixed(2)} isn't this wish's price`
      : amount > m.max_cents ? `$${(amount / 100).toFixed(2)} is over the shopper's $${(m.max_cents / 100).toFixed(2)} limit`
      : null;
  checks.push({ name: "Within the shopper's mandate", ok: !problem, detail: problem ?? `$${(amount / 100).toFixed(2)} of $${(m!.max_cents / 100).toFixed(2)}, until the deadline` });
  if (problem) return finish(false, checks, problem);

  db.prepare("UPDATE mandates SET status = 'used' WHERE id = ?").run(m!.id);
  let pledgeId: string;
  try {
    pledgeId = await heldPledge(campaignId, amount, m!.email);
  } catch (err) {
    const msg = (err as Error).message;
    checks.push({ name: "Card hold placed", ok: false, detail: msg });
    return finish(false, checks, msg);
  }
  db.prepare("UPDATE pledges SET agent_keyid = ? WHERE id = ?").run(tap.keyid!, pledgeId);
  emit(`campaign:${campaignId}`, EVENTS.campaignUpdated, { campaign: getCampaign(campaignId) });
  checks.push({ name: "Card hold placed", ok: true, detail: `$${(amount / 100).toFixed(2)} held, captured only if the wish is funded` });
  return finish(true, checks, "Pledge placed by the genie", { pledgeId });
}
