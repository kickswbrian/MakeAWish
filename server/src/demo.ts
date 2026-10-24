import type { ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { env, paymentMode } from "./env.ts";
import { findMatches, readCache } from "./apify.ts";
import { startMeshy } from "./meshy.ts";
import { mockConfirm, provider, stripe } from "./payments.ts";
import { _internal, createCampaign, createPledge } from "./campaigns.ts";
import { newId, sleep } from "./util.ts";
import { createWish, setWishStatus } from "./wishes.ts";

export const DEMO_WISH: ProductSpec = {
  category: "dress",
  name: "Convertible Pocket Midi",
  length: "midi",
  silhouette: "a_line",
  sleeves: "cap",
  neckline: "v",
  color: "#1F8A5B",
  fabric: "satin",
  features: ["converts_to_skirt", "phone_pockets"],
  target_price_usd: 89,
};

const PLANTER: ProductSpec = {
  category: "generic",
  name: "Self-watering desk planter",
  color: "#9CAF88",
  features: ["self_watering"],
  target_price_usd: 35,
  notes: "ceramic planter with a hidden water reservoir and a fill gauge",
};

/** Place a real (test-mode) held pledge without a browser: server-side confirm with a test card. */
export async function heldPledge(campaignId: string, priceCents: number, email: string): Promise<string> {
  if (paymentMode === "stripe") {
    const pledgeId = newId();
    db.prepare("INSERT INTO pledges (id, campaign_id, email, status, created_at) VALUES (?, ?, ?, 'created', ?)").run(pledgeId, campaignId, email, Date.now());
    const pi = await stripe!.paymentIntents.create({
      amount: priceCents,
      currency: "usd",
      capture_method: "manual",
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { campaignId, pledgeId },
      description: `Wish it pledge ${campaignId} (demo seed)`,
    });
    db.prepare("UPDATE pledges SET payment_intent_id = ? WHERE id = ?").run(pi.id, pledgeId);
    if (pi.status === "requires_capture") _internal.onHeld(pi.id);
    return pledgeId;
  }
  const p = await createPledge(campaignId, email);
  mockConfirm(p.paymentIntentId, "4242424242424242");
  await sleep(400); // the simulated provider reports the hold asynchronously, like a webhook
  return p.pledgeId;
}

/**
 * Put the demo in its starting state. Keeps the Apify cache and downloaded models; wipes wishes,
 * campaigns and pledges (releasing any open holds first). Safe to run twice.
 */
export async function resetDemo(planterDeadlineSecs = 120) {
  const open = db.prepare("SELECT id, payment_intent_id FROM pledges WHERE status IN ('held', 'created') AND payment_intent_id IS NOT NULL").all() as { id: string; payment_intent_id: string }[];
  await Promise.all(open.map((p) => provider.cancel(p.payment_intent_id, `reset-${p.id}`).catch(() => {})));
  db.transaction(() => {
    db.prepare("DELETE FROM pledges").run();
    db.prepare("DELETE FROM campaigns").run();
    db.prepare("DELETE FROM matches").run();
    db.prepare("DELETE FROM match_runs").run();
    db.prepare("DELETE FROM wishes").run();
  })();

  // Demo wish: pre-warm its Apify results and its Meshy model (both cached by spec).
  const demo = createWish(DEMO_WISH);
  setWishStatus(demo.id, "locked");
  const hadCache = !!readCache(DEMO_WISH);
  await findMatches(demo.id);
  void startMeshy(demo.id);

  // The planter: 2 of 4 real held pledges, deadline N seconds out, for the "nobody paid" beat.
  const planter = createWish(PLANTER);
  setWishStatus(planter.id, "locked");
  void startMeshy(planter.id);
  const priceCents = 3500;
  const campaign = createCampaign(planter.id, priceCents, 4, Date.now() + planterDeadlineSecs * 1000);
  await heldPledge(campaign.id, priceCents, "maya@example.com");
  await heldPledge(campaign.id, priceCents, "jordan@example.com");

  const base = env.publicUrl.replace(/\/$/, "");
  return {
    paymentMode,
    demoMode: env.demoMode,
    apifyCache: hadCache ? "hit" : env.apifyToken && env.apifyActor && !env.demoMode ? "warmed live" : "sample matches (no live Apify)",
    demoWishId: demo.id,
    planterCampaignId: campaign.id,
    planterDeadlineAt: campaign.deadlineAt,
    urls: {
      studio: `${base}/`,
      demoWish: `${base}/?wish=${demo.id}`,
      planterLaptop: `${base}/campaign/${campaign.id}?admin`,
      planterPhone: `${base}/c/${campaign.id}`,
      wishlist: `${base}/wishlist`,
    },
  };
}
