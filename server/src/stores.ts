import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Match } from "@wishit/shared";
import { env } from "./env.ts";
import { hash, withTimeout } from "./util.ts";

/**
 * "Does it already exist?" without a deployed Actor: the server calls Apify Store scrapers itself.
 *  1. plan:   Claude names what the wish is actually sold as (when it exists) and writes 2-3 store
 *             queries plus the must-have features (cached, and started as soon as a design is done).
 *  2. search: each store runs every query in ONE scraper run, the stores in parallel.
 *  3. score:  Claude looks at each listing's photo and title against the must-haves, and drops
 *             accessories and spare parts.
 * Google Shopping has a backup scraper because Google changes its pages often.
 */
/** batch: every query in one run (the scraper parallelizes internally); else one run per query. */
type Store = { actorId: string; usdPerItem: number; batch?: boolean; input: (queries: string[], max: number) => object };

const amazonSearch = (q: string) => `https://www.amazon.com/s?k=${encodeURIComponent(q).replace(/%20/g, "+")}`;
const STORES: Record<string, Store[]> = {
  google_shopping: [
    { actorId: "emastra/google-shopping-scraper", usdPerItem: 0.0044, input: (qs, max) => ({ queries: qs, maxItems: max * qs.length, maxItemsPerQuery: max, countryCode: "us" }) },
    { actorId: "automation-lab/google-shopping-scraper", usdPerItem: 0.004, input: (qs, max) => ({ queries: qs, maxResults: max, country: "us", language: "en" }) },
  ],
  amazon: [
    {
      actorId: "junglee/amazon-crawler",
      usdPerItem: 0.005,
      // Crawls its start URLs in parallel: 3 searches in one run take ~9 s, about as long as one.
      batch: true,
      input: (qs, max) => ({ categoryOrProductUrls: qs.map((q) => ({ url: amazonSearch(q) })), maxItemsPerStartUrl: max, maxSearchPagesPerStartUrl: 1, scrapeProductDetails: false, proxyCountry: "US" }),
    },
  ],
};
export const STORE_NAMES = Object.keys(STORES);

/** A store listing before scoring, tagged with the query that found it. */
export type Listing = Omit<Match, "score" | "missing" | "why"> & { query?: string };

/** What the shopper wished for, as the planner and scorer see it. */
/** `parts`: the design's distinct part names, so add-ons the description leaves out (a flower on a plush) still count. */
export type Wanted = { name?: string; category?: string; description?: string; query?: string; target_price_usd?: number; parts?: string[] };

const first = (...vals: unknown[]) => vals.find((v) => v !== undefined && v !== null && v !== "");

function toPrice(v: unknown): number | null {
  if (v == null) return null;
  // Cents only: the Amazon crawler sometimes glues the whole-dollar part on again (35.2535 for $35.25).
  if (typeof v === "number") return v > 0 ? Math.floor(v * 100 + 1e-6) / 100 : null;
  if (typeof v === "object") { const o = v as any; return toPrice(first(o.value, o.amount, o.current, o.price)); }
  // The first amount only: "$71.69 ... 5% off" must not become 71.695.
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/);
  const n = m ? Number(m[0].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? toPrice(n) : null;
}

/** "4.5 out of 5 stars" / 4.5 / {rating: 4.5} -> 4.5, within 0-5. */
function toRating(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") return toRating(first((v as any).rating, (v as any).value, (v as any).average));
  const n = typeof v === "number" ? v : Number(String(v).match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

/** "(2,345)" / "2.3K" / 2345 -> 2345. */
function toCount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? Math.round(v) : null;
  const m = String(v).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1);
  return n > 0 ? Math.round(n) : null;
}

/** Every scraper names things differently; take whatever looks like a title, link, price and image. */
export function normalize(source: string, item: any): Listing | null {
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
  // Which query found it: Google names it, Amazon gives back the search URL it crawled.
  const searchUrl = first(typeof item.input === "string" ? item.input : item.input?.url, item.searchUrl, item.categoryUrl, item.startUrl);
  let fromUrl: string | null = null;
  try {
    if (typeof searchUrl === "string") fromUrl = new URL(searchUrl, "https://www.amazon.com").searchParams.get("k");
  } catch { /* not a URL */ }
  return {
    source,
    title: String(title).replace(/\s+/g, " ").trim().slice(0, 200),
    url: String(url),
    price: toPrice(first(item.priceNumeric, item.price, item.priceValue, item.currentPrice, item.extracted_price)),
    image,
    rating: toRating(first(item.stars, item.rating, item.productRating, item.averageRating, item.reviewRating)),
    reviews: toCount(first(item.reviewsCount, item.reviewCount, item.ratingsCount, item.numberOfReviews, item.ratingCount, typeof item.reviews === "number" || typeof item.reviews === "string" ? item.reviews : undefined)),
    query: (first(item.searchKeyword, item.searchQuery, item.query, fromUrl) as string | undefined) ?? undefined,
  };
}

/**
 * Apify caps concurrent runs per account (5 on this plan; more start with 402). Runs past the cap
 * wait here for a slot instead of failing, so two searches at once queue rather than error.
 */
const MAX_RUNS = Number(process.env.APIFY_MAX_RUNS) || 5;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNS) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runActor(actorId: string, input: object, timeoutSecs: number): Promise<any[]> {
  return slot(() => runActorNow(actorId, input, timeoutSecs));
}

async function runActorNow(actorId: string, input: object, timeoutSecs: number): Promise<any[]> {
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

/**
 * One scraper run per query, all in parallel. A single run with every query is ~3x slower: Google
 * Shopping works through a batch's queries one after another (measured 33 s for 3 vs 7-15 s for 1).
 * `onRun` gets each query's listings the moment its run finishes.
 */
async function runPerQuery(source: string, s: Store, queries: string[], max: number, timeoutSecs: number, onRun?: (listings: Listing[]) => Promise<void> | void) {
  const raw: any[] = [];
  let usd = 0;
  const listings: Listing[] = [];
  await Promise.all((s.batch ? [queries] : queries.map((q) => [q])).map(async (qs) => {
    const q = qs.length === 1 ? qs[0] : `${qs.length} queries`;
    const started = Date.now();
    try {
      const items = await runActor(s.actorId, s.input(qs, max), timeoutSecs);
      raw.push(...items);
      usd += items.length * s.usdPerItem;
      const found = items.map((i) => normalize(source, i)).filter((l): l is Listing => !!l).map((l) => ({ ...l, query: l.query ?? (qs.length === 1 ? q : undefined) }));
      console.log(`[apify] ${source} via ${s.actorId}: ${found.length} listings for "${q}" in ${Date.now() - started}ms`);
      listings.push(...found);
      if (found.length) await onRun?.(found);
    } catch (err) {
      console.warn(`[apify] ${source} via ${s.actorId} "${q}" failed after ${Date.now() - started}ms: ${(err as Error).message}`);
    }
  }));
  return { listings, raw, usd };
}

/** One store: each scraper in turn until one returns listings, its queries run in parallel. Raw items too (for the match lab). */
export async function searchStore(source: string, queries: string[], max: number, timeoutSecs: number): Promise<{ listings: Listing[]; raw: any[]; usd: number }> {
  for (const s of STORES[source]) {
    const started = Date.now();
    try {
      const { listings, raw } = await runPerQuery(source, s, queries, max, timeoutSecs);
      console.log(`[apify] ${source} via ${s.actorId}: ${listings.length} listings for ${queries.length} queries in ${Date.now() - started}ms`);
      if (listings.length) return { listings, raw, usd: raw.length * s.usdPerItem };
    } catch (err) {
      console.warn(`[apify] ${source} via ${s.actorId} failed after ${Date.now() - started}ms: ${(err as Error).message}`);
    }
  }
  throw new Error(`${source}: no scraper returned listings`);
}

// ---------- 1. Plan ----------

const client = env.anthropicKey ? new Anthropic({ maxRetries: 1 }) : null;
/** Sonnet 5 list price per token (USD), for the cost log. */
const USD_IN = 3 / 1e6, USD_OUT = 15 / 1e6;
const usdOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) =>
  (u.input_tokens + (u.cache_read_input_tokens ?? 0) * 0.1) * USD_IN + u.output_tokens * USD_OUT;

export interface SearchPlan {
  /** How likely a store already sells this. */
  exists: "yes" | "maybe" | "no";
  /** What it's sold as, when it exists ("convertible dress"). */
  soldAs: string | null;
  /** Store queries, most specific first. */
  queries: string[];
  /** The defining features a listing needs to count as this product. */
  mustHave: string[];
  usd: number;
}

const PlanSchema = z.object({
  exists: z.enum(["yes", "maybe", "no"]),
  sold_as: z.string(),
  queries: z.array(z.string()),
  must_have: z.array(z.string()),
});

const clean = (q: string) => q.toLowerCase().replace(/[^a-z0-9 &'-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const wantedText = (w: Wanted) =>
  [w.name && `Name: ${w.name}`, w.category && `Kind of product: ${w.category}`, w.description && `Description: ${w.description}`, w.parts?.length && `Parts in their 3D design: ${w.parts.join(", ")}`, w.target_price_usd && `Target price: $${w.target_price_usd}`]
    .filter(Boolean)
    .join("\n");

const plans = new Map<string, Promise<SearchPlan>>();
const planKey = (w: Wanted) => hash(JSON.stringify([w.name, w.category, w.description, w.query, w.parts]));

/**
 * The search plan for a wish, cached: call it early (a design just finished) and the search at
 * lock time finds it ready. Never throws; without Claude it falls back to the wish's own query.
 */
export function planSearch(w: Wanted): Promise<SearchPlan> {
  const key = planKey(w);
  const hit = plans.get(key);
  if (hit) return hit;
  const p = makePlan(w);
  plans.set(key, p);
  if (plans.size > 300) plans.delete(plans.keys().next().value!);
  return p;
}

async function makePlan(w: Wanted): Promise<SearchPlan> {
  const fallback: SearchPlan = { exists: "maybe", soldAs: null, queries: [clean(w.query || w.category || w.name || "")].filter(Boolean), mustHave: [], usd: 0 };
  if (!client) return fallback;
  const started = Date.now();
  try {
    const response = await client.messages.parse(
      {
        model: env.editModel,
        max_tokens: 1000,
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: zodOutputFormat(PlanSchema) },
        messages: [{
          role: "user",
          content:
            `A shopper designed this product and wants to know if it already exists:\n${wantedText(w)}${w.query ? `\nTheir search words: ${w.query}` : ""}\n\n` +
            `Plan an Amazon and Google Shopping search.\n` +
            `- exists: how likely stores already sell essentially this product.\n` +
            `- sold_as: the name it's sold under if it exists (e.g. a dress that turns into a skirt is a "convertible dress"; a mug that holds coffee at a set temperature is a "temperature control smart mug"), else "".\n` +
            `- queries: 3 store searches, 2-5 words each, the way shoppers type them (no filler like "with", "that", "turns into"), most specific first:\n` +
            `  1. what it's sold as (a brand or model name only when one well-known product is exactly this). If it doesn't exist, the closest real thing stores actually stock that does its main job (jet shoes: "motorized electric shoes"), never the invented idea itself;\n` +
            `  2. the product noun plus its defining feature, in shopper words. A distinctive add-on in their parts list counts, even when the description leaves it out (a cow plush holding a flower: "cow plush with flower");\n` +
            `  3. a broader search: the plain product with its single most important feature.\n` +
            `- must_have: usually ONE short phrase for the core idea (two only when the wish combines two separate functions, like "heated" and "canopy roof"), what a shopper would accept as "that's it". Name what it DOES, never how the description says it's built: a dress that unzips into a skirt -> "converts into a skirt" (not "zip-off top"); a backpack with a stand in its back panel -> "built-in laptop stand" (not "built into back panel"). Never things every product of its kind has, nor color, material or size unless they are the point. A distinctive add-on from the parts list (a flower, a hood, a speaker) is often the point.`,
        }],
      },
      { timeout: 15_000 },
    );
    const out = response.parsed_output;
    if (!out) throw new Error(response.stop_reason === "refusal" ? "refusal" : "no parsed output");
    const queries = [...new Set([...out.queries.map(clean), ...fallback.queries].filter((q) => q.length > 2))].slice(0, 3);
    const plan: SearchPlan = {
      exists: out.exists,
      soldAs: out.sold_as.trim() || null,
      queries: queries.length ? queries : fallback.queries,
      mustHave: out.must_have.map((f) => f.trim()).filter(Boolean).slice(0, 3),
      usd: usdOf(response.usage),
    };
    console.log(`[apify] plan in ${Date.now() - started}ms (exists ${plan.exists}${plan.soldAs ? `, sold as "${plan.soldAs}"` : ""}): ${plan.queries.map((q) => `"${q}"`).join(", ")}; must have ${plan.mustHave.join(", ") || "-"}`);
    return plan;
  } catch (err) {
    console.warn(`[apify] search planning failed, using the wish's query: ${(err as Error).message}`);
    plans.delete(planKey(w));
    return fallback;
  }
}

// ---------- 3. Score ----------

const Scores = z.object({
  results: z.array(z.object({
    index: z.number().int(),
    /** The same kind of product (a backpack, with or without the special features); false for accessories, parts, unrelated items. */
    same_kind: z.boolean(),
    has: z.array(z.string()),
    score: z.number().int(),
    why: z.string(),
  })),
});

/** Squash near-identical listings (same product from two queries or stores). */
export function dedupe<T extends { title: string; image: string | null; url: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((l) => {
    const words = l.title.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 7).join(" ");
    // Search-page links differ only in their query string; product pages only in tracking params.
    const page = /google\.[a-z.]+\/search/.test(l.url) ? null : l.url.split("?")[0];
    const keys = [`t:${words}`, ...(page ? [`u:${page}`] : []), ...(l.image && !l.image.startsWith("data:") ? [`i:${l.image}`] : [])];
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
}

/** A listing photo Claude can see: small Amazon renditions, inline data, else the URL fetched here. */
async function photo(url: string | null): Promise<Anthropic.ImageBlockParam | null> {
  if (!url) return null;
  const data = url.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (data) return { type: "image", source: { type: "base64", media_type: data[1] as "image/png", data: data[2] } };
  if (!/^https:\/\//.test(url)) return null;
  // Amazon serves any size: 320px shows small features (a stand folded beside a backpack) for ~140 tokens.
  const small = url.replace(/\._[A-Z0-9_,]+_\.(jpg|png)$/i, "._AC_UL320_.$1");
  try {
    const res = await withTimeout(fetch(small), 4000, "photo");
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 400_000) return null;
    return { type: "image", source: { type: "base64", media_type: type as "image/png", data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

/** The shopper's own design render (the wish thumbnail), when the studio saved one. */
function designImage(thumb: string | null | undefined): Anthropic.ImageBlockParam | null {
  const m = thumb?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  return m ? { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } } : null;
}

type Scored = Match & { accessory: boolean };
/** Listings per scoring call: calls run in parallel, so smaller chunks finish sooner. */
const CHUNK = 7;

/**
 * Claude scores listings from their photos, titles, prices and ratings against the plan's
 * must-haves, in parallel chunks; keyword overlap for any chunk without a key or whose call fails.
 */
export async function scoreListings(w: Wanted, plan: SearchPlan, listings: Listing[], thumb?: string | null): Promise<{ matches: Match[]; usd: number }> {
  const chunks: Listing[][] = [];
  for (let i = 0; i < listings.length; i += CHUNK) chunks.push(listings.slice(i, i + CHUNK));
  const design = designImage(thumb);
  const done = await Promise.all(chunks.map((c) => scoreChunk(w, plan, c, design)));
  return { matches: rank(done.flatMap((d) => d.scored)), usd: done.reduce((s, d) => s + d.usd, 0) };
}

/**
 * One scoring call. A slow or failed call with photos is retried once from text alone (the API
 * occasionally stalls on image requests), then keyword overlap.
 */
async function scoreChunk(w: Wanted, plan: SearchPlan, listings: Listing[], design: Anthropic.ImageBlockParam | null, withPhotos = true): Promise<{ scored: Scored[]; usd: number }> {
  if (!listings.length) return { scored: [], usd: 0 };
  if (client) {
    const started = Date.now();
    try {
      const photos = withPhotos ? await Promise.all(listings.map((l) => photo(l.image))) : listings.map(() => null);
      if (!withPhotos) design = null;
      const content: Anthropic.ContentBlockParam[] = [{
        type: "text",
        text:
          `A shopper designed this product and wants to know if it already exists:\n${wantedText(w)}\n` +
          `Must-have features: ${plan.mustHave.length ? plan.mustHave.map((f) => `"${f}"`).join(", ") : "(judge from the description)"}\n` +
          (design ? "Their 3D design is the first image.\n" : ""),
      }];
      if (design) content.push(design);
      content.push({ type: "text", text: "Store listings:" });
      listings.forEach((l, i) => {
        const meta = [l.price != null && `$${l.price}`, l.rating != null && `${l.rating}★${l.reviews ? ` (${l.reviews} reviews)` : ""}`].filter(Boolean).join(", ");
        content.push({ type: "text", text: `#${i} [${l.source}] ${l.title}${meta ? ` — ${meta}` : ""}${photos[i] ? "" : " (no photo)"}` });
        if (photos[i]) content.push(photos[i]!);
      });
      content.push({
        type: "text",
        text:
          `For each listing #index, judge from its photo and title whether it IS the shopper's product.\n` +
          `- same_kind: true when it is the same kind of product (for a backpack wish: any backpack, special features or not); false for accessories, spare or replacement parts, covers, cases, add-ons, bundles built around something else, or a different kind of product.\n` +
          `- has: which must-have features it has (copy their wording exactly). Doing the same job another way counts (a dress that converts to a skirt by folding still "converts into a skirt"). Titles are keyword-stuffed: trust the photo when they disagree.\n` +
          `- score 0-100: 85+ = this is the product (every must-have); 60-84 = the same product, missing a second must-have or with a notable difference; 40-59 = lacks the core idea but gets part of the way to its purpose another way (roller shoes for a jet-shoe wish); 20-39 = the same kind of product, nothing special; under 20 = not it.\n` +
          `- why: under 12 words, what it has and lacks, e.g. "Has the fold-out stand; no USB port".`,
      });
      const response = await client.messages.parse(
        {
          model: env.editModel,
          max_tokens: 3000,
          thinking: { type: "disabled" },
          output_config: { effort: "low", format: zodOutputFormat(Scores) },
          messages: [{ role: "user", content }],
        },
        { timeout: withPhotos ? 15_000 : 10_000, maxRetries: 0 },
      );
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(response.stop_reason === "refusal" ? "refusal" : "no parsed output");
      const usd = usdOf(response.usage);
      console.log(`[apify] scored ${listings.length} listings (${photos.filter(Boolean).length} photos${design ? " + design" : ""}) in ${Date.now() - started}ms, in=${response.usage.input_tokens} out=${response.usage.output_tokens} ~$${usd.toFixed(4)}`);
      const lower = (s: string) => s.toLowerCase().trim();
      const scored = listings.map((l, i): Scored => {
        const r = parsed.results.find((x) => x.index === i);
        const has = new Set((r?.has ?? []).map(lower));
        const { query: _q, ...rest } = l;
        return {
          ...rest,
          score: Math.max(0, Math.min(100, r ? (r.same_kind ? r.score : Math.min(r.score, 25)) : 0)),
          missing: plan.mustHave.filter((f) => !has.has(lower(f))),
          why: r?.why.trim().slice(0, 90) || undefined,
          accessory: !!r && !r.same_kind,
        };
      });
      return { scored, usd };
    } catch (err) {
      if (withPhotos) {
        console.warn(`[apify] photo scoring failed after ${Date.now() - started}ms (${(err as Error).message}), scoring from text`);
        return scoreChunk(w, plan, listings, design, false);
      }
      console.warn(`[apify] Claude scoring failed, using keyword overlap: ${(err as Error).message}`);
    }
  }
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const want = words(`${plan.queries.join(" ")} ${plan.mustHave.join(" ")}`);
  const scored = listings.map(({ query: _q, ...l }) => {
    const have = words(l.title);
    const hit = [...want].filter((x) => have.has(x)).length;
    const missing = plan.mustHave.filter((f) => !f.toLowerCase().split(/\s+/).some((x) => have.has(x)));
    return { ...l, score: Math.round((hit / Math.max(1, want.size)) * 90), missing, accessory: false };
  });
  return { scored, usd: 0 };
}

/**
 * Best first; accessories only when nothing better exists; well-reviewed listings win ties
 * (a real, proven product beats an obscure lookalike at the same score).
 */
function rank(list: Scored[]): Match[] {
  const trust = (m: Match) => (m.rating ?? 0) >= 4 ? Math.min(3, Math.log10(1 + (m.reviews ?? 0))) : 0;
  const real = list.filter((m) => !m.accessory);
  const pool = real.length >= 3 ? real : list;
  return dedupe(pool.sort((a, b) => b.score + trust(b) - (a.score + trust(a)))).map(({ accessory: _a, ...m }) => m);
}

// ---------- The whole search ----------

export interface StoreSearch { matches: Match[]; searched: number; total: number; plan: SearchPlan; usd: { apify: number; claude: number } }

/** Every store has answered: wait at most this long (from the first run) for the remaining queries. */
const ENOUGH_MS = 15_000;
/** Some store has answered: never wait longer than this. */
const CUTOFF_MS = 22_000;

/** Listings scored per store, at most (the best of each query first). */
const PER_STORE = 15;

/**
 * One store's listings worth scoring: round-robin over the queries so every query gets a say,
 * minus what another store already returned (appended to `seen`).
 */
export function pickListings(queries: string[], found: Listing[], seen: Listing[]): Listing[] {
  const byQuery = queries.map((q) => found.filter((l) => l.query === q));
  const ordered = dedupe([...interleave(byQuery), ...found]);
  const fresh = dedupe([...seen, ...ordered]).slice(seen.length).slice(0, PER_STORE);
  seen.push(...fresh);
  return fresh;
}

/**
 * Plan (usually cached already), then every store x query runs as its own scraper run, all in
 * parallel. Each run's listings are scored the moment it returns and `onPartial` gets the ranking
 * so far, so the first matches show up after the fastest run (~7 s), not the slowest.
 */
export async function searchStores(
  w: Wanted,
  opts: { max?: number; timeoutSecs?: number; thumb?: string | null; onPartial?: (matches: Match[], searched: number) => void } = {},
): Promise<StoreSearch> {
  const max = opts.max ?? 5, timeoutSecs = opts.timeoutSecs ?? 60;
  const plan = await planSearch(w);
  const design = designImage(opts.thumb);
  const seen: Listing[] = [];
  const scored: Scored[] = [];
  const answered = new Set<string>();
  let apify = 0, claude = 0;
  const score = async (source: string, found: Listing[]) => {
    const fresh = pickListings([...new Set(found.map((l) => l.query ?? ""))], found, seen);
    const chunks: Listing[][] = [];
    for (let i = 0; i < fresh.length; i += CHUNK) chunks.push(fresh.slice(i, i + CHUNK));
    const done = await Promise.all(chunks.map((c) => scoreChunk(w, plan, c, design)));
    claude += done.reduce((t, d) => t + d.usd, 0);
    scored.push(...done.flatMap((d) => d.scored));
    answered.add(source);
    if (scored.length && !finished) opts.onPartial?.(rank([...scored]), answered.size);
  };
  let finished = false;
  const started = Date.now();
  const all = Promise.all(STORE_NAMES.map(async (source) => {
    const [primary, ...backups] = STORES[source];
    const r = await runPerQuery(source, primary, plan.queries, max, timeoutSecs, (found) => score(source, found));
    apify += r.usd;
    if (r.listings.length) return;
    // Nothing from the main scraper: one batched run on each backup in turn.
    for (const b of backups) {
      const started = Date.now();
      try {
        const raw = await runActor(b.actorId, b.input(plan.queries, max), timeoutSecs);
        apify += raw.length * b.usdPerItem;
        const found = raw.map((i) => normalize(source, i)).filter((l): l is Listing => !!l);
        console.log(`[apify] ${source} backup ${b.actorId}: ${found.length} listings in ${Date.now() - started}ms`);
        if (found.length) return void (await score(source, found));
      } catch (err) {
        console.warn(`[apify] ${source} backup ${b.actorId} failed after ${Date.now() - started}ms: ${(err as Error).message}`);
      }
    }
  }));
  // Scraper runs have a long tail (Google sometimes retries a blocked page for 30 s+): once every
  // store has been heard from, a straggling extra query isn't worth waiting for.
  await new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      const t = Date.now() - started;
      if ((answered.size === STORE_NAMES.length && t > ENOUGH_MS) || (scored.length && t > CUTOFF_MS)) {
        clearInterval(tick);
        console.log(`[apify] not waiting for slower runs after ${t}ms (${answered.size}/${STORE_NAMES.length} stores in)`);
        resolve();
      }
    }, 250);
    void all.finally(() => {
      clearInterval(tick);
      resolve();
    });
  });
  finished = true;
  return { matches: rank([...scored]), searched: answered.size, total: STORE_NAMES.length, plan, usd: { apify, claude: plan.usd + claude } };
}

function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

// ---------- Searching ahead ----------

/**
 * A search started before the shopper asked for it (a design just finished), so "See matches" can
 * show results instantly. Keyed like the plan (what the product is, not its color), so tweaks
 * reuse it. Late joiners get the ranking so far, then every update.
 */
export interface Ahead {
  latest: { matches: Match[]; searched: number } | null;
  listeners: Set<(matches: Match[], searched: number) => void>;
  done: Promise<StoreSearch>;
  at: number;
}

const ahead = new Map<string, Ahead>();
/** How long a search done ahead stays good (stores change slowly). */
const AHEAD_MS = 30 * 60_000;

export function searchAhead(w: Wanted, thumb?: string | null): Ahead {
  const key = planKey(w);
  const hit = ahead.get(key);
  if (hit && Date.now() - hit.at < AHEAD_MS) return hit;
  const a: Ahead = { latest: null, listeners: new Set(), done: null as unknown as Promise<StoreSearch>, at: Date.now() };
  a.done = searchStores(w, {
    thumb,
    onPartial: (matches, searched) => {
      a.latest = { matches, searched };
      for (const l of a.listeners) l(matches, searched);
    },
  });
  // A failed search (or one that found nothing) shouldn't stick: the next try starts fresh.
  a.done.then((r) => { if (!r.matches.length) ahead.delete(key); }, () => ahead.delete(key));
  ahead.set(key, a);
  if (ahead.size > 200) ahead.delete(ahead.keys().next().value!);
  return a;
}

/** The search already running or done for this wish, if any. */
export function searchedAhead(w: Wanted): Ahead | null {
  const a = ahead.get(planKey(w));
  return a && Date.now() - a.at < AHEAD_MS ? a : null;
}
