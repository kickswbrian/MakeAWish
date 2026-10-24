import Anthropic from "@anthropic-ai/sdk";
import { childrenOf, colorName, describeProduct, EVENTS, type Match, type MatchesResponse, type Product } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { hash, withTimeout } from "./util.ts";
import { getWish } from "./wishes.ts";
import { spend } from "./security.ts";

const CACHE_MS = 24 * 3600_000;
// Etsy's scraper (Playwright) can't finish inside the Actor's per-store timeout, so it's left out.
export const SOURCES = ["amazon", "google_shopping"];
const MAX_PER_SOURCE = 5;
/** Per-store run limit inside the Actor. Google Shopping takes ~30 s; the Actor default (25 s) cut it off every time. */
const STORE_TIMEOUT_SECS = 40;
/**
 * Store inputs sent through the Actor's `sourceActors` override, so they can be tuned without
 * redeploying it. Google Shopping ignores page limits and keeps paging (and charging per result)
 * until it times out unless maxItems is set.
 */
const sourceActors = (query: string) => ({
  amazon: {
    actorId: "junglee/amazon-crawler",
    input: { categoryOrProductUrls: [{ url: `https://www.amazon.com/s?k=${encodeURIComponent(query).replace(/%20/g, "+")}` }], maxItemsPerStartUrl: MAX_PER_SOURCE, maxSearchPagesPerStartUrl: 1, scrapeProductDetails: false, proxyCountry: "US" },
  },
  google_shopping: {
    actorId: "emastra/google-shopping-scraper",
    input: { queries: [query], maxItems: MAX_PER_SOURCE, maxItemsPerQuery: MAX_PER_SOURCE, countryCode: "us" },
  },
});

/** Normalized query: stable across field order and wording noise. */
/**
 * The store search: short, generic, like a shopper types it. Stores return nothing for a whole
 * sentence with an invented product name in it. The genie writes `searchQuery`; otherwise the
 * category plus the features named after "with" in the description.
 */
export function matchQuery(product: Product): string {
  const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();
  const asked = clean(product.searchQuery ?? "").slice(0, 80);
  if (asked) return asked;
  const noun = clean(product.category ?? "");
  const features = clean(product.description?.split(/\bwith\b/i)[1]?.split(/[,.;]| and /)[0] ?? "")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 3);
  const q = [noun, ...features].join(" ").trim();
  return q || clean(product.description ? `${product.title} ${product.description}` : describeProduct(product)).slice(0, 80);
}
const STOP = new Set(["the", "and", "built", "little", "tiny", "small", "big", "cozy", "soft", "your", "its", "that", "for", "which", "from", "into", "onto", "real"]);
/**
 * Cache key: the query plus the product's top-level parts and main color, so a customized template
 * (red, with wheels) doesn't reuse the stock template's matches; a re-run of the same wish still hits.
 */
const keyFor = (product: Product) => {
  const root = product.parts[product.rootId];
  const parts = childrenOf(product, product.rootId).map((c) => c.name.toLowerCase()).sort();
  return hash(JSON.stringify({ q: matchQuery(product), parts, color: root ? colorName(root.material.color) : null }));
};

/** The structured summary the matcher Actor scores listings against. */
function actorSpec(product: Product) {
  // Features are the wish's selling points (from the description), not structural part names.
  return { name: product.title, category: product.category ?? "generic", features: [], target_price_usd: product.targetPriceUsd, notes: product.description };
}

export function getMatches(wishId: string): MatchesResponse {
  const run = db.prepare("SELECT * FROM match_runs WHERE wish_id = ?").get(wishId) as
    | { searched: number; total: number; pending: number; sample: number } | undefined;
  const rows = db.prepare("SELECT * FROM matches WHERE wish_id = ? ORDER BY score DESC").all(wishId) as any[];
  return {
    matches: rows.map((r) => ({ source: r.source, title: r.title, url: r.url, price: r.price, image: r.image, score: r.score, missing: JSON.parse(r.missing_json) })),
    searched: run?.searched ?? 0,
    total: run?.total ?? SOURCES.length,
    pending: run ? !!run.pending : false,
    sample: !!run?.sample,
  };
}

function save(wishId: string, matches: Match[], searched: number, total: number, sample: boolean) {
  db.transaction(() => {
    db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);
    const ins = db.prepare("INSERT INTO matches (wish_id, source, title, url, price, image, score, missing_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const m of matches) ins.run(wishId, m.source, m.title, m.url, m.price, m.image, Math.round(m.score), JSON.stringify(m.missing ?? []));
    db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, ?, ?, 0, ?)").run(wishId, searched, total, sample ? 1 : 0);
  })();
  emit(`wish:${wishId}`, EVENTS.matchesReady, { wishId, ...getMatches(wishId) });
}

export function readCache(spec: Product) {
  const row = db.prepare("SELECT * FROM apify_cache WHERE query_hash = ?").get(keyFor(spec)) as
    | { results_json: string; searched: number; total: number; fetched_at: number } | undefined;
  if (!row) return null;
  if (!env.demoMode && Date.now() - row.fetched_at > CACHE_MS) return null;
  return { matches: JSON.parse(row.results_json) as Match[], searched: row.searched, total: row.total };
}

export function writeCache(spec: Product, matches: Match[], searched: number, total: number) {
  db.prepare("INSERT OR REPLACE INTO apify_cache (query_hash, query, results_json, searched, total, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(keyFor(spec), matchQuery(spec), JSON.stringify(matches), searched, total, Date.now());
}

/** Kick off a match search for a locked wish. Never throws. */
export async function findMatches(wishId: string): Promise<void> {
  const wish = getWish(wishId);
  if (!wish) return;
  const spec = wish.product;
  // A double-tapped "See matches" shouldn't pay for the same search twice.
  const flight = `${wishId}:${keyFor(spec)}`;
  if (inflight.has(flight)) return;
  inflight.add(flight);
  try {
    await search(wishId, spec);
  } finally {
    inflight.delete(flight);
  }
}

const inflight = new Set<string>();

async function search(wishId: string, spec: Product) {
  db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, 0, ?, 1, 0)").run(wishId, SOURCES.length);
  db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);

  const cached = readCache(spec);
  if (cached) {
    console.log(`[apify] cache hit "${matchQuery(spec)}"`);
    return save(wishId, cached.matches, cached.searched, cached.total, false);
  }
  if (!env.apifyToken || env.demoMode || !spend("apifySearches")) {
    console.log(`[apify] ${env.demoMode ? "DEMO_MODE cache miss" : env.apifyToken ? "daily search cap reached" : "no APIFY_TOKEN"}, serving sample matches`);
    return save(wishId, sampleMatches(spec), SOURCES.length, SOURCES.length, true);
  }

  const started = Date.now();
  try {
    const r = await searchBoth(spec);
    const matches = r.matches.sort((a, b) => b.score - a.score).slice(0, 6);
    console.log(`[apify] ${matches.length} matches via ${r.via} in ${Date.now() - started}ms, searched ${r.searched}/${r.total}, cost ~$${r.costUsd ?? "?"}`);
    if (matches.length) writeCache(spec, matches, r.searched, r.total);
    save(wishId, matches, r.searched, r.total, false);
  } catch (err) {
    console.warn("[apify] failed, serving sample matches:", (err as Error).message);
    save(wishId, sampleMatches(spec), 0, SOURCES.length, true);
  }
}

interface SearchResult { matches: Match[]; searched: number; total: number; costUsd?: number; via: "actor" | "stores" }

/**
 * Whether the deployed wish-matcher Actor can be trusted. An outdated build runs the stores fine
 * but drops every listing while normalizing them (it reports listings: 0). Until one run proves it
 * either way, the server searches the stores itself in parallel; once the Actor is known stale it
 * is skipped until the server restarts (after an `apify push`).
 */
let actorState: "unknown" | "ok" | "stale" = "unknown";

async function searchBoth(spec: Product): Promise<SearchResult> {
  if (!env.apifyActor || actorState === "stale") return searchStores(spec);
  const direct = actorState === "unknown" ? searchStores(spec) : null;
  direct?.catch(() => {}); // awaited below only when needed
  try {
    const r = await searchActor(spec);
    if (r) {
      actorState = "ok";
      return r;
    }
    if (actorState === "unknown") console.warn("[apify] the deployed Actor returned no listings (outdated build?), searching the stores directly; redeploy with `apify push` from actor/");
    actorState = "stale";
  } catch (err) {
    console.warn("[apify] Actor failed, searching the stores directly:", (err as Error).message);
  }
  return direct ?? searchStores(spec);
}

/** The wish-matcher Actor. Null when it searched stores but kept no listings at all. */
async function searchActor(spec: Product): Promise<SearchResult | null> {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(env.apifyActor!)}/run-sync-get-dataset-items?token=${env.apifyToken}&timeout=60`;
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // minScore 0: keep every listing so the grid shows real results even when scoring is keyword-only.
      body: JSON.stringify({ query: matchQuery(spec), spec: actorSpec(spec), sources: SOURCES, maxPerSource: MAX_PER_SOURCE, minScore: 0, timeoutSecs: STORE_TIMEOUT_SECS, sourceActors: sourceActors(matchQuery(spec)) }),
    }),
    70_000,
    "apify",
  );
  if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items = (await res.json()) as any[];
  const meta = items.find((i) => i && i._meta)?._meta;
  const matches: Match[] = items
    .filter((i) => i && !i._meta && i.title && i.url)
    .map((i) => ({ source: String(i.source ?? "web"), title: String(i.title), url: String(i.url), price: i.price == null ? null : Number(i.price), image: i.image ?? null, score: Number(i.score ?? 0), missing: Array.isArray(i.missing) ? i.missing.map(String) : [] }));
  if (!matches.length && meta && meta.searched > 0 && !meta.listings) return null;
  return { matches, searched: meta?.searched ?? new Set(matches.map((m) => m.source)).size, total: meta?.total ?? SOURCES.length, costUsd: meta?.costUsd, via: "actor" };
}

// ---------- Searching the stores directly (same Store actors, called from here) ----------

const first = (...vals: unknown[]) => vals.find((v) => v !== undefined && v !== null && v !== "");

function toPrice(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? v : null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return toPrice(first(o.value, o.amount, o.current, o.price));
  }
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Store actors all name things differently; take whatever looks like a title, link, price and image. */
export function normalizeListing(source: string, item: Record<string, any>): Omit<Match, "score" | "missing"> | null {
  const title = first(item.title, item.name, item.productTitle, item.product_title, item.productName);
  let url = first(item.url, item.link, item.productUrl, item.product_url, item.productLink, item.asin ? `https://www.amazon.com/dp/${item.asin}` : undefined) as string | undefined;
  if (url && url.startsWith("/")) url = `https://www.amazon.com${url}`;
  const img = first(item.thumbnailImage, item.image, item.imageUrl, item.productImage, item.thumbnail, item.mainImage, Array.isArray(item.images) ? item.images[0] : undefined);
  const image = typeof img === "string" ? img : (img as { url?: string } | undefined)?.url;
  if (!title || !url) return null;
  return {
    source,
    title: String(title).slice(0, 200),
    url: String(url),
    price: toPrice(first(item.price, item.priceValue, item.currentPrice, item.extracted_price)),
    // Inline base64 thumbnails (Google Shopping) are kept only when small.
    image: image && !(image.startsWith("data:") && image.length > 60_000) ? image : null,
  };
}

async function runStore(source: string, actorId: string, input: unknown): Promise<Omit<Match, "score" | "missing">[]> {
  const url = `https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?token=${env.apifyToken}&timeout=${STORE_TIMEOUT_SECS}&memory=1024&limit=${MAX_PER_SOURCE * 3}`;
  const res = await withTimeout(fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), (STORE_TIMEOUT_SECS + 10) * 1000, source);
  if (!res.ok) throw new Error(`${source} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = (await res.json()) as Record<string, any>[];
  return items.map((i) => normalizeListing(source, i)).filter((m): m is NonNullable<typeof m> => !!m).slice(0, MAX_PER_SOURCE);
}

async function searchStores(spec: Product): Promise<SearchResult> {
  const query = matchQuery(spec);
  const cfg = sourceActors(query) as Record<string, { actorId: string; input: unknown }>;
  const settled = await Promise.allSettled(SOURCES.map((s) => runStore(s, cfg[s].actorId, cfg[s].input)));
  const listings = settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[apify] ${SOURCES[i]} skipped: ${(r.reason as Error)?.message ?? r.reason}`);
    return [];
  });
  const searched = settled.filter((r) => r.status === "fulfilled").length;
  if (!searched) throw new Error("every store failed");
  return { matches: await scoreListings(spec, listings), searched, total: SOURCES.length, via: "stores" };
}

const scorer = env.anthropicKey ? new Anthropic({ maxRetries: 1 }) : null;

/** One Claude call scores every listing against the wish; keyword overlap if that fails. */
async function scoreListings(spec: Product, listings: Omit<Match, "score" | "missing">[]): Promise<Match[]> {
  if (!listings.length) return [];
  if (scorer) {
    try {
      const lines = listings.map((l, i) => `${i}. [${l.source}] ${l.title}${l.price != null ? ` ($${l.price})` : ""}`).join("\n");
      const res = await scorer.messages.create(
        {
          model: env.editModel,
          max_tokens: 2000,
          ...(env.editModel.includes("sonnet") ? { thinking: { type: "disabled" } } : {}),
          tools: [{
            name: "score",
            description: "Score every listing.",
            input_schema: {
              type: "object",
              properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, score: { type: "integer" }, missing: { type: "array", items: { type: "string" } } }, required: ["index", "score", "missing"] } } },
              required: ["results"],
            },
          }],
          tool_choice: { type: "tool", name: "score" },
          messages: [{
            role: "user",
            content:
              `A shopper wishes this product existed: "${spec.title}"${spec.description ? ` (${spec.description})` : ""}.\n\n` +
              `Score each marketplace listing below from 0 to 100 for how well it IS that product (80+ = this exists, 50-79 = close but missing something, under 50 = not it). ` +
              `For each, list up to 3 wished-for things it lacks as short noun phrases, e.g. "laptop stand". Judge only from the title.\n\n${lines}`,
          }],
        } as unknown as Anthropic.MessageCreateParamsNonStreaming,
        { timeout: 20_000 },
      );
      const tool = res.content.find((b) => b.type === "tool_use") as { input?: { results?: { index: number; score: number; missing: string[] }[] } } | undefined;
      const results = tool?.input?.results;
      if (!Array.isArray(results)) throw new Error("no scores");
      return listings.map((l, i) => {
        const r = results.find((x) => x.index === i);
        return { ...l, score: Math.max(0, Math.min(100, Math.round(Number(r?.score ?? 0)))), missing: (Array.isArray(r?.missing) ? r!.missing : []).map(String).slice(0, 3) };
      });
    } catch (err) {
      console.warn("[apify] scoring failed, using keyword overlap:", (err as Error).message);
    }
  }
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const want = words(`${matchQuery(spec)} ${spec.title}`);
  return listings.map((l) => {
    const have = words(l.title);
    const hit = [...want].filter((w) => have.has(w)).length;
    return { ...l, score: Math.round((hit / Math.max(1, want.size)) * 90), missing: [] };
  });
}

/**
 * Clearly-labelled sample data for when Apify is unavailable. Source is "sample" so the UI can
 * badge it; these are not real listings.
 */
export function sampleMatches(product: Product): Match[] {
  const noun = product.category ?? product.title;
  const features = childrenOf(product, product.rootId).map((c) => c.name.toLowerCase()).slice(0, 3);
  const s = (title: string, price: number, score: number, missing: string[]): Match => ({
    source: "sample", title, url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(title)}`, price, image: null, score, missing,
  });
  const price = product.targetPriceUsd ?? 60;
  return [
    s(`Classic ${noun}`, Math.round(price * 0.8), 52, features.slice(0, 2).length ? features.slice(0, 2) : ["the twist you described"]),
    s(`${noun.charAt(0).toUpperCase() + noun.slice(1)} with accessories`, Math.round(price * 1.2), 44, features.slice(1, 3).length ? features.slice(1, 3) : ["exact design"]),
    s(`Budget ${noun}`, Math.round(price * 0.5), 28, ["materials", "most features"]),
  ];
}
