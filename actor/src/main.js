import { Actor, log } from "apify";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_SOURCES, fill, normalize, runCostUsd } from "./sources.js";

/**
 * wish-matcher: does this product already exist?
 * 1. Calls one Apify Store actor per marketplace, in parallel, each with its own timeout.
 * 2. Normalizes every listing to { source, title, url, price, image }.
 * 3. Scores all listings against the spec in ONE Claude call: { score 0-100, missing[] }.
 * 4. Pushes the best matches (plus one `_meta` row with searched/total/cost) to the dataset.
 */

async function searchSource(source, cfg, vars, timeoutSecs) {
  const started = Date.now();
  const input = fill(cfg.input, vars);
  // Hard spend cap per store: every default actor is pay-per-event, and without a cap an actor that
  // ignores our item limit (Google Shopping returns up to 40 per page) bills for all of it.
  const maxTotalChargeUsd = cfg.maxChargeUsd ?? Number((0.01 + vars.max * 0.01).toFixed(2));
  // Our own guard on top of the run timeout, so a stuck start can't hold up the other stores.
  const call = Actor.call(cfg.actorId, input, { timeout: timeoutSecs, memory: cfg.memory ?? 1024, maxItems: vars.max, maxTotalChargeUsd });
  let timer;
  const run = await Promise.race([
    call,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`timed out after ${timeoutSecs + 10}s`)), (timeoutSecs + 10) * 1000);
    }),
  ]).finally(() => clearTimeout(timer));
  // A TIMED-OUT run still keeps what it pushed before the cut-off, so read the dataset either way.
  const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems({ limit: vars.max * 3, clean: true });
  const listings = items.map((i) => normalize(source, i, cfg.base)).filter(Boolean).slice(0, vars.max);
  const costUsd = runCostUsd(run);
  log.info(`[${source}] ${listings.length}/${items.length} listings in ${Date.now() - started}ms (run ${run.status}, ~$${costUsd.toFixed(4)})`);
  if (!listings.length && items.length) log.warning(`[${source}] no usable listings; first item keys: ${Object.keys(items[0] ?? {}).join(", ")}`);
  return { listings, costUsd, ok: listings.length > 0 || run.status === "SUCCEEDED" };
}

const Scores = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      score: z.number().int(),
      missing: z.array(z.string()),
    }),
  ),
});

/** One LLM call for every listing. Falls back to keyword overlap if no key or the call fails. */
async function score(query, spec, listings) {
  if (!listings.length) return [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      // 20 s per attempt and one retry keeps the whole run inside the server's sync-call budget.
      const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
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
      });
      if (response.stop_reason === "max_tokens") throw new Error("hit max_tokens");
      if (response.stop_reason === "refusal") throw new Error("refusal");
      const parsed = response.parsed_output;
      if (!parsed) throw new Error("no parsed output");
      return listings.map((l, i) => {
        const r = parsed.results.find((x) => x.index === i);
        return { ...l, score: Math.max(0, Math.min(100, r?.score ?? 0)), missing: (r?.missing ?? []).slice(0, 4) };
      });
    } catch (err) {
      log.warning(`LLM scoring failed, using keyword overlap: ${err.message}`);
    }
  }
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const want = words(`${query} ${(spec?.features ?? []).join(" ").replace(/_/g, " ")}`);
  return listings.map((l) => {
    const have = words(l.title);
    const hit = [...want].filter((w) => have.has(w)).length;
    const missing = (spec?.features ?? []).filter((f) => !f.split("_").some((w) => have.has(w))).map((f) => f.replace(/_/g, " "));
    return { ...l, score: Math.round((hit / Math.max(1, want.size)) * 90), missing };
  });
}

await Actor.main(async () => {
  const input = (await Actor.getInput()) ?? {};
  const query = String(input.query ?? "").trim();
  if (!query) throw new Error("Input `query` is required.");
  // Marketplace search boxes return nothing for long feature sentences, so stores get the short
  // `searchQuery` ("emerald convertible midi dress") while scoring judges against the full `query`.
  const searchQuery = String(input.searchQuery ?? "").trim() || query;
  const max = Math.max(1, Math.min(20, input.maxPerSource ?? 5));
  const timeoutSecs = input.timeoutSecs ?? 40;
  const minScore = input.minScore ?? 50;
  const sources = (input.sources?.length ? input.sources : Object.keys(DEFAULT_SOURCES)).filter((s) => DEFAULT_SOURCES[s] || input.sourceActors?.[s]);
  const vars = { query: searchQuery, queryEncoded: encodeURIComponent(searchQuery).replace(/%20/g, "+"), max };
  log.info(`Searching ${sources.join(", ")} for "${searchQuery}"${searchQuery !== query ? ` (scoring against "${query}")` : ""}`);
  const started = Date.now();

  const settled = await Promise.allSettled(
    sources.map((s) => searchSource(s, { ...DEFAULT_SOURCES[s], ...(input.sourceActors?.[s] ?? {}) }, vars, timeoutSecs)),
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

  const scored = (await score(query, input.spec, listings))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  await Actor.pushData(scored);
  // Run metadata for the caller (Wish it's server reads this row to show "Searched 2 of 3 stores").
  await Actor.pushData({ _meta: { searched, total: sources.length, costUsd: Number(costUsd.toFixed(4)), ms: Date.now() - started, listings: listings.length } });
  log.info(`Done: ${scored.length} matches >= ${minScore} from ${listings.length} listings, searched ${searched}/${sources.length}, ~$${costUsd.toFixed(4)}`);
});
