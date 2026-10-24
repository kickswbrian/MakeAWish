import { colorName, describeSpec, EVENTS, type Match, type MatchesResponse, type ProductSpec } from "@wishit/shared";
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
export function matchQuery(spec: ProductSpec): string {
  return describeSpec(spec).toLowerCase().replace(/\s+/g, " ").trim();
}
/**
 * Cache key: what identifies the product (category, features, color family), not wording or small
 * tweaks like "a little shorter", so the pre-warmed demo wish still hits the cache on stage.
 */
const keyFor = (spec: ProductSpec) =>
  hash(JSON.stringify({ c: spec.category, f: [...(spec.features ?? [])].sort(), color: spec.color ? colorName(spec.color) : null, n: spec.category === "generic" ? (spec.name ?? "").toLowerCase() : null }));

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

export function readCache(spec: ProductSpec) {
  const row = db.prepare("SELECT * FROM apify_cache WHERE query_hash = ?").get(keyFor(spec)) as
    | { results_json: string; searched: number; total: number; fetched_at: number } | undefined;
  if (!row) return null;
  if (!env.demoMode && Date.now() - row.fetched_at > CACHE_MS) return null;
  return { matches: JSON.parse(row.results_json) as Match[], searched: row.searched, total: row.total };
}

export function writeCache(spec: ProductSpec, matches: Match[], searched: number, total: number) {
  db.prepare("INSERT OR REPLACE INTO apify_cache (query_hash, query, results_json, searched, total, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(keyFor(spec), matchQuery(spec), JSON.stringify(matches), searched, total, Date.now());
}

/** Kick off a match search for a locked wish. Never throws. */
export async function findMatches(wishId: string): Promise<void> {
  const wish = getWish(wishId);
  if (!wish) return;
  const spec = wish.spec;
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

async function search(wishId: string, spec: ProductSpec) {
  db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, 0, ?, 1, 0)").run(wishId, SOURCES.length);
  db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);

  const cached = readCache(spec);
  if (cached) {
    console.log(`[apify] cache hit "${matchQuery(spec)}"`);
    return save(wishId, cached.matches, cached.searched, cached.total, false);
  }
  if (!env.apifyToken || !env.apifyActor || env.demoMode || !spend("apifySearches")) {
    console.log(`[apify] ${env.demoMode ? "DEMO_MODE cache miss" : env.apifyToken && env.apifyActor ? "daily search cap reached" : "no APIFY_TOKEN/APIFY_ACTOR"}, serving sample matches`);
    return save(wishId, sampleMatches(spec), SOURCES.length, SOURCES.length, true);
  }

  const started = Date.now();
  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(env.apifyActor)}/run-sync-get-dataset-items?token=${env.apifyToken}&timeout=60`;
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // minScore 0: keep every listing so the grid shows real results even when scoring is keyword-only.
        body: JSON.stringify({ query: matchQuery(spec), spec, sources: SOURCES, maxPerSource: MAX_PER_SOURCE, minScore: 0, sourceActors: sourceActors(matchQuery(spec)) }),
      }),
      70_000,
      "apify",
    );
    if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const items = (await res.json()) as any[];
    const meta = items.find((i) => i && i._meta);
    const matches: Match[] = items
      .filter((i) => i && !i._meta && i.title && i.url)
      .map((i) => ({ source: String(i.source ?? "web"), title: String(i.title), url: String(i.url), price: i.price == null ? null : Number(i.price), image: i.image ?? null, score: Number(i.score ?? 0), missing: Array.isArray(i.missing) ? i.missing.map(String) : [] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
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
export function sampleMatches(spec: ProductSpec): Match[] {
  const f = spec.features ?? [];
  const want = (feat: string, label: string) => (f.includes(feat) ? [label] : []);
  const s = (title: string, price: number, score: number, missing: string[]): Match => ({
    source: "sample", title, url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(title)}`, price, image: null, score, missing,
  });
  switch (spec.category) {
    case "dress":
    case "skirt":
    case "top":
      return [
        s("Convertible Wrap Midi Dress", 74, f.includes("converts_to_skirt") ? 62 : 70, [...want("phone_pockets", "phone-sized pockets"), ...(spec.color ? ["exact color"] : [])]),
        s("Midi Dress with Pockets", 58, 55, [...want("converts_to_skirt", "doesn't convert to a skirt")]),
        s("Two-Piece Set, Top and Midi Skirt", 66, 48, ["not one garment", ...want("phone_pockets", "pockets")]),
        s("Satin Slip Dress", 49, 31, ["no pockets", "doesn't convert"]),
      ];
    case "backpack":
      return [
        s("Laptop Backpack with Phone Stand Strap", 89, 58, [...want("laptop_stand", "laptop stand")]),
        s("Commuter Backpack, 15.6in", 64, 44, ["no stand"]),
        s("Portable Laptop Stand (separate)", 29, 35, ["not a backpack"]),
        s("Rolling Work Bag", 110, 22, ["not a backpack"]),
      ];
    case "helmet":
      return [
        s("Smart Bike Helmet with Bluetooth Speakers", 129, 76, ["over-ear headphone cups"]),
        s("Helmet Audio Clip-On Kit", 59, 51, ["not a helmet"]),
        s("Urban Bike Helmet, MIPS", 85, 40, [...want("headphones", "headphones")]),
        s("Ski Helmet with Audio Pockets", 140, 33, ["for skiing, not cycling"]),
      ];
    default:
      return [
        s(`Something like a ${describeSpec(spec)}`, 45, 38, ["key feature"]),
        s("Closest generic alternative", 30, 25, ["most of the wish"]),
      ];
  }
}
