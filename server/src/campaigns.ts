import {
  CAMPAIGN_MAX_MS, emptyProduct, EVENTS,
  type Campaign, type CampaignStatus, type Maker, type PledgeStatus, type Product,
} from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { paymentMode } from "./env.ts";
import { bindPaymentEvents, provider } from "./payments.ts";
import { maskEmail, newId } from "./util.ts";
import { getWish } from "./wishes.ts";

interface CampaignRow {
  id: string; wish_id: string; price_cents: number; target_backers: number; deadline_at: number;
  status: CampaignStatus; maker_json: string | null; created_at: number;
}
interface PledgeRow {
  id: string; campaign_id: string; email: string; payment_intent_id: string | null;
  status: PledgeStatus; fail_reason: string | null; created_at: number;
}

const getRow = (id: string) => db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
const pledgesOf = (id: string) => db.prepare("SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at").all(id) as PledgeRow[];
const pledgeByPi = (pi: string) => db.prepare("SELECT * FROM pledges WHERE payment_intent_id = ?").get(pi) as PledgeRow | undefined;
export const getPledge = (id: string) => db.prepare("SELECT * FROM pledges WHERE id = ?").get(id) as PledgeRow | undefined;
const countStatus = (id: string, status: PledgeStatus) =>
  (db.prepare("SELECT COUNT(*) AS n FROM pledges WHERE campaign_id = ? AND status = ?").get(id, status) as { n: number }).n;

export function getCampaign(id: string): Campaign | null {
  const r = getRow(id);
  if (!r) return null;
  const wish = getWish(r.wish_id);
  const product: Product = wish?.product ?? emptyProduct();
  const pledges = pledgesOf(id);
  return {
    id: r.id,
    wishId: r.wish_id,
    name: product.title,
    product,
    thumb: wish?.thumb ?? null,
    priceCents: r.price_cents,
    targetBackers: r.target_backers,
    held: pledges.filter((p) => p.status === "held").length,
    captured: pledges.filter((p) => p.status === "captured").length,
    deadlineAt: r.deadline_at,
    createdAt: r.created_at,
    status: r.status,
    maker: r.maker_json ? JSON.parse(r.maker_json) : null,
    pledges: pledges.map((p) => ({ id: p.id, email: maskEmail(p.email), status: p.status, failReason: p.fail_reason, createdAt: p.created_at })),
    paymentMode,
  };
}

/** Rank by commitment: held pledges while funding, captured once funded. */
export function listCampaigns(): Campaign[] {
  const ids = db.prepare("SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 100").all() as { id: string }[];
  return ids.map((r) => getCampaign(r.id)!).filter(Boolean);
}

function broadcast(id: string) {
  const c = getCampaign(id);
  if (!c) return;
  emit([`campaign:${id}`, `wish:${c.wishId}`, "board"], EVENTS.campaignUpdated, { campaign: c });
}

export function createCampaign(wishId: string, priceCents: number, targetBackers: number, deadlineAt: number): Campaign {
  const now = Date.now();
  const deadline = Math.min(Math.max(deadlineAt, now + 30_000), now + CAMPAIGN_MAX_MS);
  const id = newId();
  db.prepare("INSERT INTO campaigns (id, wish_id, price_cents, target_backers, deadline_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'funding', ?)")
    .run(id, wishId, priceCents, targetBackers, deadline, now);
  broadcast(id);
  return getCampaign(id)!;
}

export class PledgeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function createPledge(campaignId: string, email: string) {
  const c = getRow(campaignId);
  if (!c) throw new PledgeError("Campaign not found", 404);
  if (c.status !== "funding") throw new PledgeError(c.status === "expired" || c.status === "releasing" ? "This wish's deadline has passed." : "This wish is already fully funded!", 409);
  if (c.deadline_at <= Date.now()) throw new PledgeError("This wish's deadline has passed.", 409);
  const pledgeId = newId();
  db.prepare("INSERT INTO pledges (id, campaign_id, email, status, created_at) VALUES (?, ?, ?, 'created', ?)").run(pledgeId, campaignId, email, Date.now());
  const pi = await provider.createHold(c.price_cents, { campaignId, pledgeId }, email);
  db.prepare("UPDATE pledges SET payment_intent_id = ? WHERE id = ?").run(pi.id, pledgeId);
  return { pledgeId, clientSecret: pi.clientSecret, paymentIntentId: pi.id };
}

// ---------- State transitions. All idempotent by payment_intent_id + status. ----------

function onHeld(piId: string) {
  const p = pledgeByPi(piId);
  if (!p) return;
  const c = getRow(p.campaign_id)!;
  if (c.status !== "funding") {
    // Authorized after the window closed (race with goal or deadline): release it.
    if (p.status === "created" || p.status === "held") {
      db.prepare("UPDATE pledges SET status = 'held' WHERE id = ?").run(p.id);
      void releaseOne(p.id, piId);
    }
    return;
  }
  const changed = db.prepare("UPDATE pledges SET status = 'held', fail_reason = NULL WHERE id = ? AND status IN ('created', 'failed')").run(p.id).changes;
  if (!changed) return;
  console.log(`[pay] held ${p.id} on ${c.id}`);
  broadcast(c.id);
  void maybeCapture(c.id);
}

function onFailed(piId: string, reason: string) {
  const p = pledgeByPi(piId);
  if (!p) return;
  const changed = db.prepare("UPDATE pledges SET status = 'failed', fail_reason = ? WHERE id = ? AND status = 'created'").run(reason, p.id).changes;
  if (changed) {
    console.log(`[pay] failed ${p.id}: ${reason}`);
    broadcast(p.campaign_id);
  }
}

function onCaptured(piId: string) {
  const p = pledgeByPi(piId);
  if (!p) return;
  const changed = db.prepare("UPDATE pledges SET status = 'captured' WHERE id = ? AND status IN ('held', 'capture_failed')").run(p.id).changes;
  if (changed) {
    broadcast(p.campaign_id);
    settleCapture(p.campaign_id);
  }
}

function onCanceled(piId: string) {
  const p = pledgeByPi(piId);
  if (!p) return;
  const changed = db.prepare("UPDATE pledges SET status = CASE WHEN status = 'held' THEN 'released' ELSE 'failed' END, fail_reason = COALESCE(fail_reason, CASE WHEN status = 'created' THEN 'Pledge window closed' END) WHERE id = ? AND status IN ('held', 'created')").run(p.id).changes;
  if (changed) {
    broadcast(p.campaign_id);
    settleRelease(p.campaign_id);
  }
}

bindPaymentEvents({ onHeld, onFailed, onCaptured, onCanceled });

/**
 * The exactly-once moment: Funding -> Capturing. Only the caller whose UPDATE flips the row runs
 * capture. Idempotency keys make retried captures safe.
 */
export async function maybeCapture(campaignId: string) {
  const won = db.transaction(() => {
    const c = getRow(campaignId);
    if (!c || c.status !== "funding") return false;
    if (countStatus(campaignId, "held") < c.target_backers) return false;
    return db.prepare("UPDATE campaigns SET status = 'capturing' WHERE id = ? AND status = 'funding'").run(campaignId).changes === 1;
  }).immediate();
  if (!won) return;

  console.log(`[pay] goal hit on ${campaignId}, capturing`);
  broadcast(campaignId);
  const held = pledgesOf(campaignId).filter((p) => p.status === "held");
  await Promise.all(
    held.map(async (p) => {
      try {
        const res = await provider.capture(p.payment_intent_id!, `capture-${p.id}`);
        if (res === "captured") onCaptured(p.payment_intent_id!);
      } catch (err) {
        console.warn(`[pay] capture failed ${p.id}:`, (err as Error).message);
        db.prepare("UPDATE pledges SET status = 'capture_failed', fail_reason = ? WHERE id = ? AND status = 'held'").run((err as Error).message.slice(0, 200), p.id);
        broadcast(campaignId);
      }
    }),
  );
  settleCapture(campaignId);
}

function settleCapture(campaignId: string) {
  const c = getRow(campaignId);
  if (!c || c.status !== "capturing") return;
  if (countStatus(campaignId, "held") > 0) return;
  const maker = pickMaker(getWish(c.wish_id)?.product);
  const changed = db.prepare("UPDATE campaigns SET status = 'funded', maker_json = ? WHERE id = ? AND status = 'capturing'").run(JSON.stringify(maker), campaignId).changes;
  if (changed) {
    console.log(`[pay] ${campaignId} funded, PO to ${maker.name}`);
    broadcast(campaignId);
  }
}

async function releaseOne(pledgeId: string, piId: string) {
  try {
    await provider.cancel(piId, `cancel-${pledgeId}`);
    if (provider.mode === "stripe") {
      const s = await provider.retrieve(piId);
      if (s.state === "canceled") onCanceled(piId);
    }
  } catch (err) {
    console.warn(`[pay] cancel failed ${pledgeId}:`, (err as Error).message);
  }
}

export async function expireCampaign(campaignId: string) {
  const won = db.prepare("UPDATE campaigns SET status = 'releasing' WHERE id = ? AND status = 'funding'").run(campaignId).changes === 1;
  if (!won) return false;
  console.log(`[pay] deadline passed on ${campaignId}, releasing holds`);
  broadcast(campaignId);
  const open = pledgesOf(campaignId).filter((p) => (p.status === "held" || p.status === "created") && p.payment_intent_id);
  await Promise.all(open.map((p) => releaseOne(p.id, p.payment_intent_id!)));
  settleRelease(campaignId);
  return true;
}

function settleRelease(campaignId: string) {
  const c = getRow(campaignId);
  if (!c || c.status !== "releasing") return;
  if (countStatus(campaignId, "held") > 0) return;
  if (db.prepare("UPDATE campaigns SET status = 'expired' WHERE id = ? AND status = 'releasing'").run(campaignId).changes) broadcast(campaignId);
}

/** Webhook fallback: reconcile one pledge with the provider's real state. */
export async function reconcilePledge(pledgeId: string) {
  const p = getPledge(pledgeId);
  if (!p?.payment_intent_id || !["created", "held"].includes(p.status)) return;
  const s = await provider.retrieve(p.payment_intent_id);
  if (s.state === "held") onHeld(p.payment_intent_id);
  else if (s.state === "failed") onFailed(p.payment_intent_id, s.reason ?? "Card declined");
  else if (s.state === "captured") onCaptured(p.payment_intent_id);
  else if (s.state === "canceled") onCanceled(p.payment_intent_id);
}

/** Deadline timer plus recovery for any campaign stuck mid-transition (e.g. after a restart). */
export function startCampaignTimers() {
  const tick = async () => {
    const due = db.prepare("SELECT id FROM campaigns WHERE status = 'funding' AND deadline_at <= ?").all(Date.now()) as { id: string }[];
    for (const { id } of due) await expireCampaign(id);
    const stuck = db.prepare("SELECT id, status FROM campaigns WHERE status IN ('capturing', 'releasing')").all() as { id: string; status: CampaignStatus }[];
    for (const c of stuck) {
      for (const p of pledgesOf(c.id).filter((p) => p.status === "held" || p.status === "created")) {
        await reconcilePledge(p.id).catch(() => {});
        const cur = getPledge(p.id)!;
        if (c.status === "capturing" && cur.status === "held") {
          await provider.capture(cur.payment_intent_id!, `capture-${cur.id}`).then((r) => r === "captured" && onCaptured(cur.payment_intent_id!)).catch(() => {});
        }
        if (c.status === "releasing" && (cur.status === "held" || cur.status === "created")) await releaseOne(cur.id, cur.payment_intent_id!);
      }
      settleCapture(c.id);
      settleRelease(c.id);
    }
  };
  void tick().catch((e) => console.warn("[timer]", e));
  setInterval(() => void tick().catch((e) => console.warn("[timer]", e)), 5000);
}

/** Simulated maker. The payments are real (test mode); manufacturing is not. */
function pickMaker(product?: Product): Maker {
  const text = `${product?.category ?? ""} ${product?.title ?? ""}`.toLowerCase();
  const makers: [RegExp, Omit<Maker, "simulated">][] = [
    [/dress|skirt|top|shirt|jacket|hoodie|coat|garment|pants|scarf/, { name: "Atelier Verde", location: "Los Angeles, CA", specialty: "Small-batch apparel, cut-and-sew", url: "https://example.com/atelier-verde" }],
    [/bag|backpack|pack|tote|wallet|pouch|luggage|suitcase/, { name: "Mission Pack Works", location: "Oakland, CA", specialty: "Technical bags and soft goods", url: "https://example.com/mission-pack-works" }],
    [/helmet|headphone|speaker|audio|earbud/, { name: "Velo Shell Co.", location: "Portland, OR", specialty: "Helmets, shells and audio integration", url: "https://example.com/velo-shell" }],
    [/lamp|light|planter|mug|cup|bottle|vase|bowl|chair|table|desk|shelf/, { name: "Hearth & Kiln Studio", location: "Berkeley, CA", specialty: "Ceramics, lighting and home goods", url: "https://example.com/hearth-kiln" }],
  ];
  const hit = makers.find(([re]) => re.test(text));
  return { ...(hit?.[1] ?? { name: "Bay Prototype Lab", location: "San Francisco, CA", specialty: "Short-run consumer products", url: "https://example.com/bay-prototype-lab" }), simulated: true };
}

/** Test helper / demo seeding: drive a pledge to held directly (used with real Stripe server-side confirms too). */
export const _internal = { onHeld, onFailed, onCaptured, onCanceled };
