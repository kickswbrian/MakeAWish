import { Actor, log } from "apify";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * wish-matcher: does this product already exist?
 * 1. Calls one Apify Store actor per marketplace, in parallel, each with its own timeout.
 * 2. Normalizes every listing to { source, title, url, price, image }.
 * 3. Scores all listings against the spec in ONE Claude call: { score 0-100, missing[] }.
 * 4. Pushes the best matches (plus one `_meta` row with searched/total/cost) to the dataset.
 */

// Default Store actors. Swap any of them via the `sourceActors` input without redeploying.
const DEFAULT_SOURCES = {
  amazon: {
    actorId: "junglee/amazon-crawler",
    input: { categoryOrProductUrls: [{ url: "https://www.amazon.com/s?k={{queryEncoded}}" }], maxItemsPerStartUrl: "{{max}}", proxyCountry: "US" },
  },
  etsy: {
    actorId: "epctex/etsy-scraper",
    input: { search: "{{query}}", maxItems: "{{max}}", proxy: { useApifyProxy: true } },
  },
  google_shopping: {
    actorId: "emastra/google-shopping-scraper",
    input: { queries: ["{{query}}"], maxPagesPerQuery: 1, resultsPerPage: "{{max}}", countryCode: "us" },
  },
};

/** Replace {{query}}, {{queryEncoded}}, {{max}} anywhere in an input template. A bare "{{max}}" becomes a number. */
function fill(template, vars) {
  if (typeof template === "string") {
    if (template === "{{max}}") return vars.max;
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
  }
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  if (template && typeof template === "object") return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, vars)]));
  return template;
}

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "");

function toPrice(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") return toPrice(first(v.value, v.amount, v.current, v.price));
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Store actors all name things differently; take whatever looks like a title, link, price and image. */
function normalize(source, item) {
  const title = first(item.title, item.name, item.productTitle, item.product_title);
  let url = first(item.url, item.link, item.productUrl, item.product_url, item.productLink);
  if (url && url.startsWith("/")) url = `https://www.${source === "etsy" ? "etsy" : "amazon"}.com${url}`;
  const image = first(item.thumbnailImage, item.image, item.imageUrl, item.thumbnail, item.mainImage, Array.isArray(item.images) ? item.images[0] : undefined, Array.isArray(item.imageUrls) ? item.imageUrls[0] : undefined);
  if (!title || !url) return null;
  return {
    source,
    title: String(title).slice(0, 200),
    url: String(url),
    price: toPrice(first(item.price, item.priceValue, item.currentPrice, item.extracted_price)),
    image: typeof image === "string" ? image : image?.url ?? null,
  };
}

async function searchSource(source, cfg, vars, timeoutSecs) {
  const started = Date.now();
  const input = fill(cfg.input, vars);
  // Our own guard on top of the run timeout, so a stuck start can't hold up the other stores.
  const call = Actor.call(cfg.actorId, input, { timeout: timeoutSecs, memory: 1024 });
  const run = await Promise.race([
    call,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeoutSecs + 10}s`)), (timeoutSecs + 10) * 1000)),
  ]);
  const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems({ limit: vars.max * 3 });
  const listings = items.map((i) => normalize(source, i)).filter(Boolean).slice(0, vars.max);
  log.info(`[${source}] ${listings.length} listings in ${Date.now() - started}ms (run ${run.status}, $${(run.usageTotalUsd ?? 0).toFixed(4)})`);
  return { listings, costUsd: run.usageTotalUsd ?? 0, ok: listings.length > 0 || run.status === "SUCCEEDED" };
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
      const client = new Anthropic({ apiKey: key, maxRetries: 1 });
      const lines = listings.map((l, i) => `${i}. [${l.source}] ${l.title}${l.price != null ? ` ($${l.price})` : ""}`).join("\n");
      const response = await client.messages.parse(
        {
          model: process.env.SCORING_MODEL || "claude-opus-5-5",
          max_tokens: 4000,
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
        },
        { timeout: 30_000 },
      );
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
  const max = Math.max(1, Math.min(20, input.maxPerSource ?? 5));
  const timeoutSecs = input.timeoutSecs ?? 25;
  const minScore = input.minScore ?? 50;
  const sources = (input.sources?.length ? input.sources : Object.keys(DEFAULT_SOURCES)).filter((s) => DEFAULT_SOURCES[s] || input.sourceActors?.[s]);
  const vars = { query, queryEncoded: encodeURIComponent(query).replace(/%20/g, "+"), max };
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
