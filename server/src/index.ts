import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import {
  CreateCampaignBody, EVENTS, PledgeBody,
  type ConfigResponse, type MatchesResponse, type PledgeResponse, type TurnResponse,
} from "@wishit/shared";
import { setIo, emit } from "./bus.ts";
import { brainKind, think } from "./brain.ts";
import { listVoices, mintToken } from "./cartesia.ts";
import {
  createCampaign, createPledge, expireCampaign, getCampaign, getPledge, listCampaigns,
  PledgeError, reconcilePledge, startCampaignTimers,
} from "./campaigns.ts";
import { env, logConfig, MODELS_DIR, paymentMode, WEB_DIST } from "./env.ts";
import { findMatches, getMatches, resumePendingMatches } from "./apify.ts";
import { resetDemo } from "./demo.ts";
import { startMeshy } from "./meshy.ts";
import { handleStripeEvent, mockConfirm, stripe } from "./payments.ts";
import { appendTranscript, createWish, getWish, patchWish, setWishStatus, toWishDTO } from "./wishes.ts";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
setIo(io);

io.on("connection", (socket) => {
  socket.on(EVENTS.join, (room: unknown) => {
    if (typeof room === "string" && /^(wish|campaign):[a-z0-9]{1,20}$|^board$/.test(room)) socket.join(room);
  });
  socket.on("ping", (cb: unknown) => typeof cb === "function" && cb({ at: Date.now() }));
});

// Stripe webhooks need the raw body, so this route comes before express.json().
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe) return res.status(400).send("stripe not configured");
  let event;
  try {
    event = env.stripeWebhookSecret
      ? stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] as string, env.stripeWebhookSecret)
      : JSON.parse(req.body.toString());
  } catch (err) {
    console.warn("[stripe] bad webhook:", (err as Error).message);
    return res.status(400).send("bad signature");
  }
  handleStripeEvent(event);
  res.json({ received: true });
});

app.use(express.json({ limit: "200kb" }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/config", (_req, res) => {
  const body: ConfigResponse = {
    stripePublishableKey: paymentMode === "stripe" ? env.stripePublishable! : null,
    paymentMode,
    cartesia: !!env.cartesiaKey,
    brain: brainKind,
    demoMode: env.demoMode,
    publicUrl: env.publicUrl,
  };
  res.json(body);
});

// ---------- Wishes ----------

app.post("/api/wish", (_req, res) => res.json(toWishDTO(createWish())));

app.get("/api/wish/:id", (req, res) => {
  const w = getWish(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  res.json(toWishDTO(w));
});

const turnLocks = new Map<string, Promise<unknown>>();
app.post("/api/wish/:id/turn", wrap(async (req, res) => {
  const id = req.params.id;
  const text = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "text required" });
  if (!getWish(id)) return res.status(404).json({ error: "not found" });

  // Serialize turns per wish so two quick utterances don't race on the spec.
  const prev = turnLocks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const started = Date.now();
    const w = getWish(id)!;
    const result = await think(w.spec, w.transcript, text);
    const { spec, changed, dropped } = patchWish(id, result.patch);
    if (dropped.length) console.log(`[brain] dropped invalid fields: ${dropped.join(", ")}`);
    // 3D updates now, before the client starts speaking the reply.
    emit(`wish:${id}`, EVENTS.specUpdated, { wishId: id, spec, changed });
    const ms = Date.now() - started;
    console.log(`[turn] ${id} ${result.brain} ${ms}ms changed=[${changed.join(",")}] "${text}" -> "${result.say}"`);
    appendTranscript(id, [{ role: "user", text, at: started }, { role: "genie", text: result.say, at: Date.now() }]);
    const body: TurnResponse = { say: result.say, spec, changed, lock: result.lock, ms, brain: result.brain };
    return body;
  });
  turnLocks.set(id, run);
  res.json(await run);
}));

/** Direct spec edits (debug panel, instant-guess confirmations). */
app.patch("/api/wish/:id/spec", (req, res) => {
  if (!getWish(req.params.id)) return res.status(404).json({ error: "not found" });
  const { spec, changed } = patchWish(req.params.id, req.body);
  emit(`wish:${req.params.id}`, EVENTS.specUpdated, { wishId: req.params.id, spec, changed });
  res.json({ spec, changed });
});

app.post("/api/wish/:id/lock", (req, res) => {
  const w = getWish(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  setWishStatus(w.id, "locked");
  void startMeshy(w.id);
  void findMatches(w.id);
  res.json({ ok: true });
});

app.get("/api/wish/:id/matches", (req, res) => {
  const body: MatchesResponse = getMatches(req.params.id);
  res.json(body);
});

// ---------- Campaigns ----------

app.get("/api/campaigns", (req, res) => {
  const list = listCampaigns();
  if (req.query.sort === "held") list.sort((a, b) => b.held + b.captured - (a.held + a.captured));
  res.json(list);
});

app.post("/api/campaigns", (req, res) => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid" });
  const w = getWish(parsed.data.wishId);
  if (!w) return res.status(404).json({ error: "wish not found" });
  const { priceCents, targetBackers, deadlineAt } = parsed.data;
  res.json(createCampaign(w.id, priceCents, targetBackers, deadlineAt));
});

app.get("/api/campaigns/:id", (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(c);
});

app.post("/api/campaigns/:id/pledges", wrap(async (req, res) => {
  const parsed = PledgeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please enter a valid email." });
  try {
    const p = await createPledge(req.params.id, parsed.data.email);
    const body: PledgeResponse = { pledgeId: p.pledgeId, clientSecret: p.clientSecret, paymentMode };
    res.json(body);
  } catch (err) {
    if (err instanceof PledgeError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/** Pledge status. Also the webhook fallback: it reconciles with the provider before answering. */
app.get("/api/pledges/:id", wrap(async (req, res) => {
  await reconcilePledge(req.params.id).catch((e) => console.warn("[pay] reconcile:", e.message));
  const p = getPledge(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json({ id: p.id, status: p.status, failReason: p.fail_reason, campaignId: p.campaign_id });
}));

/** Simulated card entry (only when Stripe keys are absent). */
app.post("/api/mock/pledges/:id/confirm", (req, res) => {
  if (paymentMode !== "mock") return res.status(404).json({ error: "not in mock mode" });
  const p = getPledge(req.params.id);
  if (!p?.payment_intent_id) return res.status(404).json({ error: "not found" });
  res.json(mockConfirm(p.payment_intent_id, String(req.body?.card ?? "")));
});

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (env.adminToken && req.get("x-admin-token") !== env.adminToken && req.query.token !== env.adminToken) return res.status(401).json({ error: "admin token required" });
  next();
};

app.post("/api/admin/campaigns/:id/expire", requireAdmin, wrap(async (req, res) => {
  const ok = await expireCampaign(req.params.id);
  res.json({ ok });
}));

/** One command puts the demo in its starting state (see scripts/demo-reset.ts). */
app.post("/api/admin/demo/reset", requireAdmin, wrap(async (req, res) => {
  const secs = Math.max(30, Math.min(3600, Number(req.body?.planterDeadlineSecs ?? 120) || 120));
  res.json(await resetDemo(secs));
}));

// ---------- Cartesia ----------

app.get("/api/cartesia/token", wrap(async (_req, res) => {
  if (!env.cartesiaKey) return res.status(503).json({ error: "cartesia not configured" });
  const t = await mintToken();
  res.json({ ...t, version: env.cartesiaVersion });
}));

app.get("/api/cartesia/voices", wrap(async (_req, res) => res.json(await listVoices())));

// ---------- Static ----------

app.use("/models", express.static(MODELS_DIR, { maxAge: "1h", fallthrough: false }));
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api|socket\.io|models).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: err.message || "server error" });
});

startCampaignTimers();
resumePendingMatches();
server.listen(env.port, () => logConfig());
