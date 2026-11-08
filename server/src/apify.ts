import { childrenOf, colorName, describeProduct, EVENTS, type Match, type MatchesResponse, type Product } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { hash, withTimeout } from "./util.ts";
import { getWish } from "./wishes.ts";
import { spend } from "./security.ts";
import { planSearch, searchAhead, searchedAhead, searchStores, STORE_NAMES, type Wanted } from "./stores.ts";

const CACHE_MS = 24 * 3600_000;
// Etsy's scraper (Playwright) can't finish inside a per-store timeout, so it's left out.
export const SOURCES = STORE_NAMES;
/** Listings per query per store (each store runs up to 3 queries in one scraper run). */
const MAX_PER_SOURCE = 5;
/** Matches kept for the results grid. */
const KEEP = 8;
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
  // v2: planned queries + photo scoring; older cached results are re-searched.
  return hash(JSON.stringify({ v: 2, q: matchQuery(product), parts, color: root ? colorName(root.material.color) : null }));
};

/** The structured summary the matcher Actor scores listings against. */
function actorSpec(product: Product) {
  // Features are the wish's selling points (from the description), not structural part names.
  return { name: product.title, category: product.category ?? "generic", features: [], target_price_usd: product.targetPriceUsd, notes: product.description };
}

/** What the direct search plans and scores against. */
/** The design's part names, deduped and without sides or numbering ("Petal 1".."Petal 4" -> "petal"). */
function partNames(product: Product): string[] {
  const names = Object.values(product.parts).map((p) =>
    p.name.toLowerCase().replace(/\b(left|right|front|back|top|bottom|upper|lower|inner|outer)\b/g, "").replace(/\d+/g, "").replace(/\s+/g, " ").trim());
  return [...new Set(names.filter((n) => n.length > 2))].slice(0, 30);
}

function wanted(product: Product): Wanted {
  return { name: product.title, category: product.category, description: product.description, query: matchQuery(product), target_price_usd: product.targetPriceUsd, parts: partNames(product), asks: featureAsks(product.id) };
}

/**
 * What the shopper added after the first wish ("add Sonic to it"): the genie doesn't always fold a new
 * feature into the description or search words, so the search would still look for a plain temple buggy.
 * Only turns that added parts count, so recolors and resizes keep reusing the same (paid) search.
 */
function featureAsks(wishId: string): string[] {
  const turns = getWish(wishId)?.transcript.filter((t) => t.role === "user") ?? [];
  // Only since the current design started ("actually, make me a lamp" leaves Sonic behind).
  const start = turns.map((t) => !!t.fresh).lastIndexOf(true);
  return turns.slice(Math.max(1, start + 1)).filter((t) => t.adds).map((t) => t.text.replace(/\s+/g, " ").trim().slice(0, 100)).slice(-3);
}

const aheadTimers = new Map<string, NodeJS.Timeout>();
/** Wait this long after a design settles before searching ahead (a quick follow-up edit replaces it). */
const AHEAD_DELAY_MS = 800;

/**
 * A design just finished: plan its store search now (one small Claude call, cached), then, once
 * the design has settled, run the whole search ahead so "See matches" shows results instantly.
 * Keyed by what the product is, so color and size tweaks reuse the same search. Skips untitled
 * drafts. SEARCH_AHEAD=0 only plans ahead (searches start on See matches).
 */
export function prepareMatches(product: Product, thumb?: string | null): void {
  if (!product.description || !env.apifyToken || env.demoMode || readCache(product)) return;
  const w = wanted(product);
  void planSearch(w);
  if (process.env.SEARCH_AHEAD === "0" || searchedAhead(w)) return;
  clearTimeout(aheadTimers.get(product.id));
  aheadTimers.set(product.id, setTimeout(() => {
    aheadTimers.delete(product.id);
    if (searchedAhead(w) || !spend("apifySearches")) return;
    console.log(`[apify] searching ahead for "${product.title}"`);
    searchAhead(w, thumb ?? getWish(product.id)?.thumb);
  }, AHEAD_DELAY_MS));
}

export function getMatches(wishId: string): MatchesResponse {
  const run = db.prepare("SELECT * FROM match_runs WHERE wish_id = ?").get(wishId) as
    | { searched: number; total: number; pending: number; sample: number } | undefined;
  const rows = db.prepare("SELECT * FROM matches WHERE wish_id = ? ORDER BY score DESC").all(wishId) as any[];
  return {
    matches: rows.map((r) => ({ source: r.source, title: r.title, url: r.url, price: r.price, image: r.image, score: r.score, missing: JSON.parse(r.missing_json), ...(r.extra_json ? JSON.parse(r.extra_json) : {}) })),
    searched: run?.searched ?? 0,
    total: run?.total ?? SOURCES.length,
    pending: run ? !!run.pending : false,
    sample: !!run?.sample,
  };
}

function save(wishId: string, matches: Match[], searched: number, total: number, sample: boolean, pending = false) {
  db.transaction(() => {
    db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);
    const ins = db.prepare("INSERT INTO matches (wish_id, source, title, url, price, image, score, missing_json, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const m of matches) {
      const extra = { rating: m.rating ?? null, reviews: m.reviews ?? null, why: m.why };
      ins.run(wishId, m.source, m.title, m.url, m.price, m.image, Math.round(m.score), JSON.stringify(m.missing ?? []), JSON.stringify(extra));
    }
    db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, ?, ?, ?, ?)").run(wishId, searched, total, pending ? 1 : 0, sample ? 1 : 0);
  })();
  emit(`wish:${wishId}`, EVENTS.matchesReady, { wishId, ...getMatches(wishId) });
}

/** Photo links from the search done ahead (or cached) for a wish, so the browser can fetch them early. */
export function previewImages(wishId: string): string[] {
  const wish = getWish(wishId);
  if (!wish || !wish.product.description) return [];
  const found = readCache(wish.product)?.matches ?? searchedAhead(wanted(wish.product))?.latest?.matches ?? [];
  return [...new Set(found.map((m) => m.image).filter((u): u is string => !!u && /^https?:\/\//.test(u)))].slice(0, 16);
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
    await search(wishId, spec, wish.thumb);
  } finally {
    inflight.delete(flight);
  }
}

const inflight = new Set<string>();
/** Set when the deployed Actor proves outdated (it searched but kept no listings). */
let actorStale = false;

async function search(wishId: string, spec: Product, thumb: string | null) {
  db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, 0, ?, 1, 0)").run(wishId, SOURCES.length);
  db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);

  const cached = readCache(spec);
  if (cached) {
    console.log(`[apify] cache hit "${matchQuery(spec)}"`);
    return save(wishId, cached.matches, cached.searched, cached.total, false);
  }
  // A search done ahead was already counted against the daily cap.
  if (!env.apifyToken || env.demoMode || !(searchedAhead(wanted(spec)) || spend("apifySearches"))) {
    console.log(`[apify] ${env.demoMode ? "DEMO_MODE cache miss" : env.apifyToken ? "daily search cap reached" : "no APIFY_TOKEN"}, serving sample matches`);
    return save(wishId, sampleMatches(spec), SOURCES.length, SOURCES.length, true);
  }

  const started = Date.now();
  const query = matchQuery(spec);
  console.log(`[apify] searching ${SOURCES.join(" + ")} for "${query}" ${env.apifyActor && env.matchViaActor ? `via ${env.apifyActor}` : "directly"}`);
  // No deployed Actor (or an outdated one): the server calls the store scrapers itself (same scrapers, one hop less).
  const direct = async () => {
    try {
      const partial = (m: Match[], searched: number) => save(wishId, m.slice(0, KEEP), searched, SOURCES.length, false, true);
      // Searched ahead while they were designing: show what's in now and follow the rest.
      const pre = searchedAhead(wanted(spec));
      if (pre) {
        console.log(`[apify] using the search done ahead (${Math.round((Date.now() - pre.at) / 1000)}s old${pre.latest ? `, ${pre.latest.matches.length} matches in` : ", still running"})`);
        if (pre.latest) partial(pre.latest.matches, pre.latest.searched);
        pre.listeners.add(partial);
      }
      // Otherwise matches stream into the grid as each scraper run is scored (pending until all are in).
      const r = pre
        ? await pre.done.finally(() => pre.listeners.delete(partial))
        : await searchStores(wanted(spec), { max: MAX_PER_SOURCE, timeoutSecs: STORE_TIMEOUT_SECS, thumb, onPartial: partial });
      const matches = r.matches.slice(0, KEEP);
      console.log(`[apify] ${matches.length} matches in ${Date.now() - started}ms, searched ${r.searched}/${r.total}, top ${matches.slice(0, 3).map((m) => m.score).join("/") || "-"}, cost ~$${(r.usd.apify + r.usd.claude).toFixed(3)} (apify $${r.usd.apify.toFixed(3)}, claude $${r.usd.claude.toFixed(3)})`);
      if (matches.length) writeCache(spec, matches, r.searched, r.total);
      // Every store came back empty: clearly-labelled samples rather than an empty grid.
      return matches.length ? save(wishId, matches, r.searched, r.total, false) : save(wishId, sampleMatches(spec), 0, r.total, true);
    } catch (err) {
      console.warn("[apify] failed, serving sample matches:", (err as Error).message);
      return save(wishId, sampleMatches(spec), 0, SOURCES.length, true);
    }
  };
  if (!env.apifyActor || !env.matchViaActor || actorStale) return direct();
  try {
    // The Actor runs the stores in parallel, each up to STORE_TIMEOUT_SECS, then scores: give it room.
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(env.apifyActor)}/run-sync-get-dataset-items?timeout=${STORE_TIMEOUT_SECS + 45}`;
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.apifyToken}`, "Content-Type": "application/json" },
        // minScore 0: keep every listing so the grid shows real results even when scoring is keyword-only.
        body: JSON.stringify({ query: matchQuery(spec), spec: actorSpec(spec), sources: SOURCES, maxPerSource: MAX_PER_SOURCE, minScore: 0, timeoutSecs: STORE_TIMEOUT_SECS, sourceActors: sourceActors(matchQuery(spec)) }),
      }),
      (STORE_TIMEOUT_SECS + 55) * 1000,
      "apify",
    );
    if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const items = (await res.json()) as any[];
    const meta = items.find((i) => i && i._meta);
    const matches: Match[] = items
      .filter((i) => i && !i._meta && i.title && i.url)
      .map((i) => ({ source: String(i.source ?? "web"), title: String(i.title), url: String(i.url), price: i.price == null ? null : Number(i.price), image: i.image ?? null, score: Number(i.score ?? 0), missing: Array.isArray(i.missing) ? i.missing.map(String) : [] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, KEEP);
    if (!matches.length && meta?._meta?.searched > 0 && !meta._meta.listings) {
      // An outdated Actor build runs the stores but drops every listing: skip it until a restart.
      console.warn(`[apify] ${env.apifyActor} returned no listings (outdated build? \`apify push\` from actor/), searching the stores directly`);
      actorStale = true;
      return direct();
    }
    const searched = meta?._meta?.searched ?? new Set(matches.map((m) => m.source)).size;
    const total = meta?._meta?.total ?? SOURCES.length;
    console.log(`[apify] ${matches.length} matches in ${Date.now() - started}ms, searched ${searched}/${total}, cost ~$${meta?._meta?.costUsd ?? "?"}`);
    if (matches.length) writeCache(spec, matches, searched, total);
    save(wishId, matches, searched, total, false);
  } catch (err) {
    console.warn("[apify] failed, serving sample matches:", (err as Error).message);
    save(wishId, sampleMatches(spec), 0, SOURCES.length, true);
  }
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
