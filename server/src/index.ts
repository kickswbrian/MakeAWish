import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import {
  CreateCampaignBody, EVENTS, PledgeBody,
  type ConfigResponse, type MatchesResponse, type PledgeResponse, type TurnResponse,
} from "@wishit/shared";
import { setIo, emit } from "./bus.ts";
import { brainKind, ruleBrain, starterTurn, think } from "./brain.ts";
import { cachedTurn, storeTurn } from "./brainCache.ts";
import { listVoices, mintToken } from "./cartesia.ts";
import {
  createCampaign, createPledge, expireCampaign, getCampaign, getPledge, listCampaigns,
  PledgeError, reconcilePledge, startCampaignTimers,
} from "./campaigns.ts";
import { assertSafeConfig, env, isProd, logConfig, MODELS_DIR, paymentMode, WEB_DIST } from "./env.ts";
import { findMatches, getMatches } from "./apify.ts";
import { resetDemo } from "./demo.ts";
import { startMeshy } from "./meshy.ts";
import { handleStripeEvent, mockConfirm, stripe } from "./payments.ts";
import { agentAttack, agentPledge, handleAgentPledge, type Attack } from "./agent.ts";
import { lookupKey } from "./tap.ts";
import { appendTranscript, createWish, getWish, patchWish, undoWish, setWishStatus, toWishDTO } from "./wishes.ts";
import { AppError, assertFound, badRequest, errorHandler, notFound, notFoundApi, requestId, unavailable, wrap } from "./http.ts";
import { limits, requireAdmin, securityHeaders, socketOrigins, spend } from "./security.ts";

assertSafeConfig();

const app = express();
// Behind Render's proxy, req.ip (used by the rate limits) must come from X-Forwarded-For.
app.set("trust proxy", isProd ? Number(process.env.TRUST_PROXY ?? 1) : false);
const server = http.createServer(app);
// Clients only send room joins and pings, so frames stay tiny.
// CORS headers alone don't stop cross-site WebSocket connections, so the handshake checks the origin too.
// Browsers always send Origin; non-browser clients without one are allowed.
const io = new Server(server, {
  cors: { origin: socketOrigins },
  maxHttpBufferSize: 10_000,
  allowRequest: (req, cb) => cb(null, socketOrigins === true || !req.headers.origin || socketOrigins.includes(req.headers.origin)),
});
setIo(io);

const MAX_ROOMS = 20;
io.on("connection", (socket) => {
  socket.on(EVENTS.join, (room: unknown) => {
    if (socket.rooms.size > MAX_ROOMS) return;
    if (typeof room === "string" && /^(wish|campaign):[a-z0-9]{1,20}$|^board$/.test(room)) socket.join(room);
  });
  socket.on("ping", (cb: unknown) => typeof cb === "function" && cb({ at: Date.now() }));
});

app.use(requestId, ...securityHeaders);

// Stripe webhooks need the raw body, so this route comes before express.json(). Not rate limited:
// Stripe retries from shared IPs, and the signature check is the guard.
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  if (!stripe) return res.status(400).send("stripe not configured");
  let event;
  try {
    // Unsigned events are accepted locally only; production refuses to boot without the secret.
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

// Health checks (Render polls this) skip the rate limits.
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", limits.api);
// Agent checkout, merchant side (Visa Trusted Agent Protocol). Raw body: the signature covers its digest.
app.post("/api/agent/campaigns/:id/pledges", limits.agent, express.raw({ type: "application/json", limit: "20kb" }), wrap(async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const r = await handleAgentPledge(req.params.id, { host: req.headers.host ?? "", path: req.originalUrl, headers: req.headers, rawBody });
  res.status(r.status).json(r.body);
}));

app.use(express.json({ limit: "200kb" }));

// Every :id is a short lowercase id (util.newId); anything else can't exist.
app.param("id", (_req, _res, next, id: string) => next(/^[a-z0-9]{1,20}$/.test(id) ? undefined : notFound()));


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

app.post("/api/wish", limits.createWish, (_req, res) => res.json(toWishDTO(createWish())));

app.get("/api/wish/:id", limits.read, (req, res) => res.json(toWishDTO(assertFound(getWish(req.params.id), "Wish"))));

const turnLocks = new Map<string, Promise<unknown>>();
app.post("/api/wish/:id/turn", ...limits.turn, wrap(async (req, res) => {
  const id = req.params.id;
  const text = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (!text) throw badRequest("text required");
  assertFound(getWish(id), "Wish");

  // Serialize turns per wish so two quick utterances don't race on the spec.
  const prev = turnLocks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const started = Date.now();
    const w = getWish(id)!;
    // Starter wishes and rehearsed lines answer instantly; past the daily Claude cap, the
    // rule-based genie answers instead.
    const genieTurns = w.transcript.filter((t) => t.role === "genie").length;
    let result = starterTurn(w.spec, w.transcript, text, brainKind) ?? (brainKind === "llm" ? cachedTurn(w.spec, text, genieTurns) : null);
    if (!result) {
      result = brainKind === "llm" && spend("llmTurns") ? await think(w.spec, w.transcript, text) : ruleBrain(w.spec, w.transcript, text);
      storeTurn(w.spec, text, genieTurns, result);
    }
    const { spec, changed, dropped } = result.undo ? { ...undoWish(id), dropped: [] as string[] } : patchWish(id, result.patch);
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
app.patch("/api/wish/:id/spec", limits.editSpec, (req, res) => {
  assertFound(getWish(req.params.id), "Wish");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw badRequest("Expected a spec object");
  const { spec, changed } = patchWish(req.params.id, req.body);
  emit(`wish:${req.params.id}`, EVENTS.specUpdated, { wishId: req.params.id, spec, changed });
  res.json({ spec, changed });
});

app.post("/api/wish/:id/lock", limits.search, (req, res) => {
  const w = assertFound(getWish(req.params.id), "Wish");
  setWishStatus(w.id, "locked");
  void startMeshy(w.id);
  void findMatches(w.id);
  res.json({ ok: true });
});

app.get("/api/wish/:id/matches", limits.read, (req, res) => {
  const body: MatchesResponse = getMatches(req.params.id);
  res.json(body);
});

// ---------- Campaigns ----------

app.get("/api/campaigns", limits.read, (req, res) => {
  const list = listCampaigns();
  if (req.query.sort === "held") list.sort((a, b) => b.held + b.captured - (a.held + a.captured));
  res.json(list);
});

app.post("/api/campaigns", limits.createCampaign, (req, res) => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid campaign");
  const w = assertFound(getWish(parsed.data.wishId), "Wish");
  const { priceCents, targetBackers, deadlineAt } = parsed.data;
  res.json(createCampaign(w.id, priceCents, targetBackers, deadlineAt));
});

app.get("/api/campaigns/:id", limits.read, (req, res) => res.json(assertFound(getCampaign(req.params.id), "Campaign")));

// ---------- Agent checkout (Visa Trusted Agent Protocol) ----------

/** The genie backs this wish for the shopper, within a spending limit they set. */
app.post("/api/campaigns/:id/agent-pledge", limits.agentPledge, wrap(async (req, res) => {
  const c = assertFound(getCampaign(req.params.id), "Campaign");
  const email = String(req.body?.email ?? "").trim();
  if (!PledgeBody.safeParse({ email }).success) throw badRequest("Please enter a valid email.");
  const maxCents = Math.round(Number(req.body?.maxCents ?? c.priceCents));
  if (!Number.isFinite(maxCents) || maxCents < 50 || maxCents > 1_000_000) throw badRequest("Pick a spending limit.");
  const r = await agentPledge(c.id, email, maxCents);
  res.status(r.status).json(r.body);
}));

/** Trust demo: send the merchant a bad agent request and show why it's refused. Never places a hold. */
app.post("/api/campaigns/:id/agent-attack", limits.agent, wrap(async (req, res) => {
  const c = assertFound(getCampaign(req.params.id), "Campaign");
  const kind = String(req.body?.kind ?? "") as Attack;
  if (!["unsigned", "replay", "tampered", "expired", "over_limit"].includes(kind)) throw badRequest("Unknown attack");
  const r = await agentAttack(c.id, kind);
  res.json(r.body);
}));

/** Public key registry for agent signatures (in production: Visa's key directory). */
app.get("/api/tap/keys", limits.read, (req, res) => {
  const jwk = lookupKey(String(req.query.keyID ?? req.query.keyid ?? ""));
  if (!jwk) throw notFound("Unknown key");
  res.json(jwk);
});

app.post("/api/campaigns/:id/pledges", limits.pledge, wrap(async (req, res) => {
  const parsed = PledgeBody.safeParse(req.body);
  if (!parsed.success) throw badRequest("Please enter a valid email.");
  try {
    const p = await createPledge(req.params.id, parsed.data.email);
    const body: PledgeResponse = { pledgeId: p.pledgeId, clientSecret: p.clientSecret, paymentMode };
    res.json(body);
  } catch (err) {
    if (err instanceof PledgeError) throw new AppError(err.message, err.status, err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST");
    throw err;
  }
}));

/** Pledge status. Also the webhook fallback: it reconciles with the provider before answering. */
app.get("/api/pledges/:id", limits.read, wrap(async (req, res) => {
  await reconcilePledge(req.params.id).catch((e) => console.warn("[pay] reconcile:", e.message));
  const p = assertFound(getPledge(req.params.id), "Pledge");
  res.json({ id: p.id, status: p.status, failReason: p.fail_reason, campaignId: p.campaign_id });
}));

/** Simulated card entry (only when Stripe keys are absent). */
app.post("/api/mock/pledges/:id/confirm", limits.confirm, (req, res) => {
  if (paymentMode !== "mock") throw notFound();
  const p = getPledge(req.params.id);
  if (!p?.payment_intent_id) throw notFound("Pledge not found");
  res.json(mockConfirm(p.payment_intent_id, String(req.body?.card ?? "")));
});

app.post("/api/admin/campaigns/:id/expire", limits.admin, requireAdmin, wrap(async (req, res) => {
  const ok = await expireCampaign(req.params.id);
  res.json({ ok });
}));

/** One command puts the demo in its starting state (see scripts/demo-reset.ts). */
app.post("/api/admin/demo/reset", limits.admin, requireAdmin, wrap(async (req, res) => {
  const secs = Math.max(30, Math.min(3600, Number(req.body?.planterDeadlineSecs ?? 120) || 120));
  res.json(await resetDemo(secs));
}));

// ---------- Cartesia ----------

app.get("/api/cartesia/token", limits.voiceToken, wrap(async (_req, res) => {
  // The browser falls back to its own speech when this fails.
  if (!env.cartesiaKey) throw unavailable("Cartesia not configured");
  if (!spend("cartesiaTokens")) throw unavailable("Voice is resting for today");
  const t = await mintToken();
  res.json({ ...t, version: env.cartesiaVersion });
}));

app.get("/api/cartesia/voices", limits.read, wrap(async (_req, res) => res.json(await listVoices())));

app.use("/api", notFoundApi);

// ---------- Static ----------

app.use("/models", express.static(MODELS_DIR, { maxAge: "1h", fallthrough: false }));
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api|socket\.io|models).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.use(errorHandler);

startCampaignTimers();
server.listen(env.port, () => logConfig());
