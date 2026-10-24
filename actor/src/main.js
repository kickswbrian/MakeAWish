import { Actor, log } from "apify";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DEFAULT_SOURCES, fill, normalize, runCostUsd, Scores } from "./sources.js";

/**
 * wish-matcher: does this product already exist?
 * 1. Calls one Apify Store actor per marketplace, in parallel, each with its own timeout.
 * 2. Normalizes every listing to { source, title, url, price, image }.
 * 3. Scores all listings against the spec in ONE Claude call: { score 0-100, missing[] }.
 * 4. Pushes the best matches (plus one `_meta` row with searched/total/cost) to the dataset.
 */

const RUN_STARTED = Date.now();
// Short-fused client for start/abort/read: the default one retries 8 times with backoff and allows
// 360 s per request, which can outlast the run's budget. waitForFinish keeps the default client
// because it long-polls.
let quick;
const quickClient = () => (quick ??= Actor.newClient({ maxRetries: 1, timeoutSecs: 10 }));
// Seconds a store gets past its wait limit to abort, settle and hand back its dataset.
const STORE_SLACK_SECS = 8;

/**
 * Seconds left before this run must have pushed its results. On the platform that's the run's own
 * timeout (the server sets it) minus a margin for pushData; locally there's no timeout, so use 110 s.
 */
function secondsLeft() {
  const timeoutAt = Actor.getEnv().timeoutAt;
  const end = timeoutAt ? timeoutAt.getTime() - 8_000 : RUN_STARTED + 110_000;
  return Math.max(0, (end - Date.now()) / 1000);
}

/**
 * Hard bound per store: whatever the Apify API does (retries, slow responses), a store that hasn't
 * handed back its listings by timeoutSecs + STORE_SLACK_SECS is skipped, and its run aborted.
 */
async function searchSourceBounded(source, cfg, vars, timeoutSecs) {
  const state = { runId: null };
  let timer;
  const deadline = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`no answer within ${timeoutSecs + STORE_SLACK_SECS}s`)), (timeoutSecs + STORE_SLACK_SECS) * 1000);
  });
  try {
    return await Promise.race([searchSource(source, cfg, vars, timeoutSecs, state), deadline]);
  } catch (err) {
    if (state.runId) void quickClient().run(state.runId).abort().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function searchSource(source, cfg, vars, timeoutSecs, state) {
  const started = Date.now();
  const input = fill(cfg.input, vars);
  // Hard spend cap per store: every default actor is pay-per-event, and without a cap an actor that
  // ignores our item limit (Google Shopping returns up to 40 per page) bills for all of it.
  const maxTotalChargeUsd = cfg.maxChargeUsd ?? Number((0.01 + vars.max * 0.01).toFixed(2));
  // Start, then wait ourselves, so we keep the run id: if the store is still going at our limit we
  // abort it and still read whatever it already pushed. The run's own timeout is only a backstop.
  const startedRun = await quickClient().actor(cfg.actorId).start(input, { timeout: timeoutSecs + 15, memory: cfg.memory ?? 1024, maxItems: vars.max, maxTotalChargeUsd });
  state.runId = startedRun.id;
  const waitSecs = Math.max(1, Math.round(timeoutSecs - (Date.now() - started) / 1000));
  let run = await Actor.apifyClient.run(startedRun.id).waitForFinish({ waitSecs });
  if (!run || run.status === "READY" || run.status === "RUNNING") {
    log.warning(`[${source}] still running after ${timeoutSecs}s, aborting and keeping what it found`);
    const runClient = quickClient().run(startedRun.id);
    run = (await runClient.abort().catch(() => null)) ?? run ?? startedRun;
    // Give the abort a moment to settle so the charged-event counts used for the cost are final.
    run = (await Actor.apifyClient.run(startedRun.id).waitForFinish({ waitSecs: 2 }).catch(() => null)) ?? run;
  }
  const { items } = await quickClient().dataset(run.defaultDatasetId).listItems({ limit: vars.max * 3, clean: true });
  const listings = items.map((i) => normalize(source, i, cfg.base)).filter(Boolean).slice(0, vars.max);
  const costUsd = runCostUsd(run);
  log.info(`[${source}] ${listings.length}/${items.length} listings in ${Date.now() - started}ms (run ${run.status}, ~$${costUsd.toFixed(4)})`);
  if (!listings.length && items.length) log.warning(`[${source}] no usable listings; first item keys: ${Object.keys(items[0] ?? {}).join(", ")}`);
  return { listings, costUsd, ok: listings.length > 0 || run.status === "SUCCEEDED" };
}

/**
 * One LLM call for every listing, bounded by `budgetSecs`. Falls back to keyword overlap if there's no
 * key, no time, or the call fails. Returns which scorer ran so the caller can tell a real "nothing
 * matches" from a degraded one.
 */
async function score(query, spec, listings, budgetSecs) {
  if (!listings.length) return { scored: [], scoredBy: "none" };
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && budgetSecs >= 5) {
    try {
      // One attempt may use the whole budget (a healthy Opus call can take a while); the retry is for fast
      // failures like 429/529. The signal caps the total, including the SDK's retry sleep (it honours
      // any retry-after).
      const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: budgetSecs * 1000 });
      const lines = listings.map((l, i) => `${i}. [${l.source}] ${l.title}${l.price != null ? ` ($${l.price})` : ""}`).join("\n");
      const response = await client.messages.parse({
        model: process.env.SCORING_MODEL || "claude-opus-5-5",
        max_tokens: 8000, // Opus 5.5 always thinks; leave room so the JSON is not cut off
        output_config: { effort: "low", format: zodOutputFormat(Scores) },
        messages: [
          {
            role: "user",
            content:
              `A shopper wishes this product existed:\n"${query}"\nStructured spec: ${JSON.stringify(spec ?? {})}\n\n` +
              `Score each marketplace listing below from 0 to 100 for how well it IS that product (80+ = this exists, 50-79 = close but missing something, under 50 = not it). ` +
              `For each, list the wished-for things it lacks as short noun phrases, e.g. "phone-sized pockets", "laptop stand". Judge only from the title.\n\n${lines}`,
          },
        ],
      }, { signal: AbortSignal.timeout(budgetSecs * 1000) });
      if (response.stop_reason === "max_tokens") throw new Error("hit max_tokens");
      if (response.stop_reason === "refusal") throw new Error("refusal");
      const parsed = response.parsed_output;
      if (!parsed) throw new Error("no parsed output");
      const scored = listings.map((l, i) => {
        const r = parsed.results.find((x) => x.index === i);
        return { ...l, score: Math.max(0, Math.min(100, r?.score ?? 0)), missing: (r?.missing ?? []).slice(0, 4) };
      });
      return { scored, scoredBy: "llm" };
    } catch (err) {
      log.warning(`LLM scoring failed, using keyword overlap: ${err.message}`);
    }
  } else if (key) log.warning(`Only ${budgetSecs.toFixed(0)}s left, using keyword overlap`);
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const want = words(`${query} ${(spec?.features ?? []).join(" ").replace(/_/g, " ")}`);
  const scored = listings.map((l) => {
    const have = words(l.title);
    const hit = [...want].filter((w) => have.has(w)).length;
    const missing = (spec?.features ?? []).filter((f) => !f.split("_").some((w) => have.has(w))).map((f) => f.replace(/_/g, " "));
    return { ...l, score: Math.round((hit / Math.max(1, want.size)) * 90), missing };
  });
  return { scored, scoredBy: "keywords" };
}

await Actor.main(async () => {
  const input = (await Actor.getInput()) ?? {};
  const query = String(input.query ?? "").trim();
  if (!query) throw new Error("Input `query` is required.");
  // Marketplace search boxes return nothing for long feature sentences, so stores get the short
  // `searchQuery` ("emerald convertible midi dress") while scoring judges against the full `query`.
  const searchQuery = String(input.searchQuery ?? "").trim() || query;
  const max = Math.max(1, Math.min(20, input.maxPerSource ?? 5));
  // Stores (wait + slack) get what's left after reserving ~25 s for scoring, so the run finishes inside its own timeout.
  const timeoutSecs = Math.max(10, Math.min(input.timeoutSecs ?? 35, secondsLeft() - 25 - STORE_SLACK_SECS));
  const minScore = input.minScore ?? 50;
  const sources = (input.sources?.length ? input.sources : Object.keys(DEFAULT_SOURCES)).filter((s) => DEFAULT_SOURCES[s] || input.sourceActors?.[s]);
  const vars = { query: searchQuery, queryEncoded: encodeURIComponent(searchQuery).replace(/%20/g, "+"), max };
  log.info(`Searching ${sources.join(", ")} for "${searchQuery}"${searchQuery !== query ? ` (scoring against "${query}")` : ""}`);
  const started = Date.now();

  const settled = await Promise.allSettled(
    sources.map((s) => searchSourceBounded(s, { ...DEFAULT_SOURCES[s], ...(input.sourceActors?.[s] ?? {}) }, vars, timeoutSecs)),
  );
  const listings = [];
  let searched = 0;
  let costUsd = 0;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      listings.push(...r.value.listings);
      costUsd += r.value.costUsd;
      if (r.value.ok) searched++;
    } else log.warning(`[${sources[i]}] skipped: ${r.reason?.message ?? r.reason}`);
  });

  const { scored: all, scoredBy } = await score(query, input.spec, listings, Math.min(35, secondsLeft()));
  const scored = all
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  await Actor.pushData(scored);
  // Run metadata for the caller (Wish it's server reads this row to show "Searched 2 of 3 stores", and
  // only caches an empty result when listings existed and Claude, not keyword overlap, rejected them).
  await Actor.pushData({ _meta: { searched, total: sources.length, costUsd: Number(costUsd.toFixed(4)), ms: Date.now() - started, listings: listings.length, scoredBy } });
  log.info(`Done: ${scored.length} matches >= ${minScore} from ${listings.length} listings (scored by ${scoredBy}), searched ${searched}/${sources.length}, ~$${costUsd.toFixed(4)}`);
});
