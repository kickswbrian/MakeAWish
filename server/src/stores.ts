import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Match } from "@wishit/shared";
import { env } from "./env.ts";
import { withTimeout } from "./util.ts";

/**
 * Store search without a deployed Actor: the server calls Apify Store scrapers directly (in
 * parallel, each with its own timeout), normalizes the listings, and scores them with Claude.
 * Google Shopping has a backup scraper because Google changes its pages often.
 */
type Store = { actorId: string; input: (q: string, max: number) => object };

const STORES: Record<string, Store[]> = {
  google_shopping: [
    { actorId: "emastra/google-shopping-scraper", input: (q, max) => ({ queries: [q], maxItems: max, maxItemsPerQuery: max, countryCode: "us" }) },
    { actorId: "automation-lab/google-shopping-scraper", input: (q, max) => ({ queries: [q], maxResults: max, country: "us", language: "en" }) },
  ],
  amazon: [
    {
      actorId: "junglee/amazon-crawler",
      input: (q, max) => ({ categoryOrProductUrls: [{ url: `https://www.amazon.com/s?k=${encodeURIComponent(q).replace(/%20/g, "+")}` }], maxItemsPerStartUrl: max, maxSearchPagesPerStartUrl: 1, scrapeProductDetails: false, proxyCountry: "US" }),
    },
  ],
};
export const STORE_NAMES = Object.keys(STORES);

type Listing = Omit<Match, "score" | "missing">;

const first = (...vals: unknown[]) => vals.find((v) => v !== undefined && v !== null && v !== "");

function toPrice(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? v : null;
  if (typeof v === "object") { const o = v as any; return toPrice(first(o.value, o.amount, o.current, o.price)); }
  // The first amount only: "$71.69 ... 5% off" must not become 71.695.
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/);
  const n = m ? Number(m[0].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Every scraper names things differently; take whatever looks like a title, link, price and image. */
function normalize(source: string, item: any): Listing | null {
  const title = first(item.title, item.name, item.productName, item.productTitle, item.product_title);
  let url = first(item.url, item.productUrl, item.productLink, item.link, item.product_url, item.offerUrl, item.asin ? `https://www.amazon.com/dp/${item.asin}` : undefined) as string | undefined;
  if (url?.startsWith("/")) url = `https://www.${source === "amazon" ? "amazon" : "google"}.com${url}`;
  // Google Shopping's product link is often just the search page: prefer the store's own page.
  const store = first(item.merchantLink, item.offerLink, item.sellerLink) as string | undefined;
  if (store?.startsWith("http") && (!url || /google\.[a-z.]+\/search/.test(url))) url = store;
  // Still a search for the whole query: search Google Shopping for this exact product instead.
  else if (url && /google\.[a-z.]+\/search/.test(url) && title) {
    const seller = first(item.merchantName, item.seller, item.storeName) as string | undefined;
    url = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${title}${seller ? ` ${seller}` : ""}`)}`;
  }
  const img = first(item.thumbnailImage, item.imageUrl, item.productImage, item.image, item.thumbnail, item.mainImage, Array.isArray(item.images) ? item.images[0] : undefined, Array.isArray(item.imageUrls) ? item.imageUrls[0] : undefined) as any;
  if (!title || !url) return null;
  let image: string | null = typeof img === "string" ? img : img?.url ?? null;
  if (image && image.startsWith("data:") && image.length > 20_000) image = null; // huge inline thumbnails
  return {
    source,
    title: String(title).slice(0, 200),
    url: String(url),
    price: toPrice(first(item.priceNumeric, item.price, item.priceValue, item.currentPrice, item.extracted_price)),
    image,
  };
}

async function runActor(actorId: string, input: object, timeoutSecs: number): Promise<any[]> {
  const url = `https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?timeout=${timeoutSecs}&memory=1024&clean=true`;
  const res = await withTimeout(
    fetch(url, { method: "POST", headers: { Authorization: `Bearer ${env.apifyToken}`, "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    (timeoutSecs + 15) * 1000,
    actorId,
  );
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/** One store: try each scraper in turn until one returns listings. */
async function searchStore(source: string, query: string, max: number, timeoutSecs: number): Promise<Listing[]> {
  for (const s of STORES[source]) {
    const started = Date.now();
    try {
      const items = await runActor(s.actorId, s.input(query, max), timeoutSecs);
      const listings = items.map((i) => normalize(source, i)).filter((l): l is Listing => !!l).slice(0, max);
      console.log(`[apify] ${source} via ${s.actorId}: ${listings.length} listings in ${Date.now() - started}ms`);
      if (listings.length) return listings;
    } catch (err) {
      console.warn(`[apify] ${source} via ${s.actorId} failed after ${Date.now() - started}ms: ${(err as Error).message}`);
    }
  }
  throw new Error(`${source}: no scraper returned listings`);
}

export async function searchStores(query: string, spec: Wanted, max = 5, timeoutSecs = 60) {
  const settled = await Promise.allSettled(STORE_NAMES.map((s) => searchStore(s, query, max, timeoutSecs)));
  const listings = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const searched = settled.filter((r) => r.status === "fulfilled").length;
  return { matches: await score(query, spec, listings), searched, total: STORE_NAMES.length };
}

const Scores = z.object({ results: z.array(z.object({ index: z.number().int(), score: z.number().int(), missing: z.array(z.string()) })) });
const client = env.anthropicKey ? new Anthropic({ maxRetries: 1 }) : null;

/** What the listings are scored against: the wish's name, noun, description and price. */
type Wanted = { name?: string; category?: string; features?: string[]; target_price_usd?: number; notes?: string };

/** One Claude call scores every listing; keyword overlap if there's no key or the call fails. */
async function score(query: string, spec: Wanted, listings: Listing[]): Promise<Match[]> {
  if (!listings.length) return [];
  if (client) {
    try {
      const lines = listings.map((l, i) => `${i}. [${l.source}] ${l.title}${l.price != null ? ` ($${l.price})` : ""}`).join("\n");
      const response = await client.messages.parse(
        {
          model: env.editModel,
          max_tokens: 4000,
          output_config: { effort: "low", format: zodOutputFormat(Scores) },
          messages: [{
            role: "user",
            content:
              `A shopper is looking for this product:\n"${query}"\nStructured spec: ${JSON.stringify(spec)}\n\n` +
              `Score each store listing below from 0 to 100 for how well it IS that product (80+ = this is it, 50-79 = close but missing something, under 50 = not it). ` +
              `For each, list the wanted things it lacks as short noun phrases, e.g. "phone-sized pockets", "laptop stand". Judge only from the title and price.\n\n${lines}`,
          }],
        },
        { timeout: 30_000 },
      );
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(response.stop_reason === "refusal" ? "refusal" : "no parsed output");
      return listings.map((l, i) => {
        const r = parsed.results.find((x) => x.index === i);
        return { ...l, score: Math.max(0, Math.min(100, r?.score ?? 0)), missing: (r?.missing ?? []).slice(0, 4) };
      });
    } catch (err) {
      console.warn(`[apify] Claude scoring failed, using keyword overlap: ${(err as Error).message}`);
    }
  }
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const want = words(`${query} ${(spec.features ?? []).join(" ").replace(/_/g, " ")}`);
  return listings.map((l) => {
    const have = words(l.title);
    const hit = [...want].filter((w) => have.has(w)).length;
    const missing = (spec.features ?? []).filter((f) => !f.split("_").some((w) => have.has(w))).map((f) => f.replace(/_/g, " "));
    return { ...l, score: Math.round((hit / Math.max(1, want.size)) * 90), missing };
  });
}
