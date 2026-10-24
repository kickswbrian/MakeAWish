import { applyPatches, setMeta, templateById, templateProduct, type Product } from "@wishit/shared";
import { db } from "./db.ts";
import { env, paymentMode } from "./env.ts";
import { findMatches, readCache } from "./apify.ts";
import { mockConfirm, provider, stripe } from "./payments.ts";
import { _internal, createCampaign, createPledge } from "./campaigns.ts";
import { newId, sleep } from "./util.ts";
import { createWish, setWishStatus } from "./wishes.ts";

/** The rehearsed wish: the convertible dress template, already customized to the demo colors. */
export function demoWish(): Product {
  const tpl = templateById("convertible_dress") ?? templateById("backpack");
  if (!tpl) return { id: "demo", title: "Convertible Pocket Midi", parts: {}, rootId: "" };
  return setMeta(templateProduct(tpl), { title: "Convertible Pocket Midi", targetPriceUsd: 89 });
}

/** The planter: a campaign that misses its goal on stage, so every hold is released. */
function planter(): Product {
  const tpl = templateById("planter");
  const base = tpl ? templateProduct(tpl) : { id: "planter", title: "Self-watering desk planter", parts: {}, rootId: "" };
  const root = base.parts[base.rootId];
  const tinted = root ? applyPatches(base, [{ op: "update", id: root.id, changes: { material: { color: "#9CAF88" } } }]).product : base;
  return setMeta(tinted, {
    title: "Self-watering desk planter",
    description: "ceramic desk planter with a hidden water reservoir and a fill gauge",
    category: "planter",
    targetPriceUsd: 35,
  });
}

/** Place a real (test-mode) held pledge without a browser: server-side confirm with a test card. */
export async function heldPledge(campaignId: string, priceCents: number, email: string, description = `Wish it pledge ${campaignId} (demo seed)`): Promise<string> {
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
      description,
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

  // Demo wish: pre-warm its Apify results (cached by query).
  const demoProduct = demoWish();
  const demo = createWish(demoProduct);
  setWishStatus(demo.id, "locked");
  const hadCache = !!readCache(demoProduct);
  await findMatches(demo.id);

  // The planter: 2 of 4 real held pledges, deadline N seconds out, for the "nobody paid" beat.
  const planterWish = createWish(planter());
  setWishStatus(planterWish.id, "locked");
  const priceCents = 3500;
  const campaign = createCampaign(planterWish.id, priceCents, 4, Date.now() + planterDeadlineSecs * 1000);
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
