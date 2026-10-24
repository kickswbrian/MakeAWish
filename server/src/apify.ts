import { colorName, describeSpec, EVENTS, type Match, type MatchesResponse, type ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { hash } from "./util.ts";
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

// Actor run limits. The actor budgets itself from its run timeout: stores get up to 35 s, Claude what's
// left (at most 35 s), and it pushes results ~8 s before the deadline. A run that still hits its timeout
// makes the sync endpoint return an error, so the fetch waits a little longer than the run.
const RUN_TIMEOUT_SECS = 90;
const FETCH_TIMEOUT_MS = (RUN_TIMEOUT_SECS + 15) * 1000;
// The actor only waits on HTTP calls, so it doesn't need the platform default memory (billed per GB-hour).
const RUN_MEMORY_MB = 512;

/** Full description the listings are scored against: stable across field order and wording noise. */
export function matchQuery(spec: ProductSpec): string {
  let d = describeSpec(spec);
  if (spec.category === "generic") {
    // describeSpec says "wish" for the generic category; use the name, or the features, instead.
    const what = spec.name?.trim() || (spec.features ?? []).map((f) => f.replace(/_/g, " ")).join(", ");
    if (what) d = d.replace(/\bwish\b/, what);
  }
  return d.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Short, store-friendly words per known feature: before the noun ("convertible dress") or after it. */
const FEATURE_WORDS: Record<string, { pre?: string; post?: string }> = {
  converts_to_skirt: { pre: "convertible" },
  phone_pockets: { post: "with pockets" },
  laptop_stand: { post: "with laptop stand" },
  headphones: { post: "with headphones" },
};

/**
 * What gets typed into each store's search box. Marketplace search returns little or nothing for a
 * whole feature sentence ("... that converts to a skirt, with phone pockets"), so keep the product
 * noun, the color and the single most distinctive feature; Claude still scores against matchQuery.
 * Only fields that are in the cache key go in here (no length or fabric), so two wishes that share a
 * cache row also share the search that filled it.
 */
export function searchQuery(spec: ProductSpec): string {
  // Sorted, like the cache key, so feature order never changes the search.
  const feats = [...(spec.features ?? [])].sort();
  const plain = (f: string) => f.replace(/_/g, " ");
  const color = spec.color ? colorName(spec.color) : "";
  let noun = spec.category === "generic" ? (spec.name ?? "").trim() : spec.category;
  let words: { pre?: string; post?: string } = {};
  if (!noun) {
    // Unnamed generic wish: the features are all we know about what it is.
    noun = feats.slice(0, 2).map(plain).join(" ");
  } else {
    // Known features in FEATURE_WORDS order (most distinctive first), else the first unknown one.
    const known = Object.keys(FEATURE_WORDS).find((f) => feats.includes(f));
    words = known ? FEATURE_WORDS[known] : feats[0] ? { pre: plain(feats[0]) } : {};
  }
  if (!noun) return matchQuery(spec); // nothing to search on but the description itself
  const q = [color, words.pre, noun, words.post].filter(Boolean).join(" ");
  return q.toLowerCase().replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ");
}

/**
 * Cache key: what identifies the product (category, features, color family), not wording or small
 * tweaks like "a little shorter", so the pre-warmed demo wish still hits the cache on stage.
 * `v` changes when the search itself changes, so results from an older pipeline aren't served forever
 * (DEMO_MODE never expires cache rows).
 */
const keyFor = (spec: ProductSpec) =>
  hash(JSON.stringify({ v: 2, c: spec.category, f: [...(spec.features ?? [])].sort(), color: spec.color ? colorName(spec.color) : null, n: spec.category === "generic" ? (spec.name ?? "").toLowerCase() : null }));

/** APIFY_ACTOR may be written "user/wish-matcher"; the API path wants "user~wish-matcher". */
const actorPath = (id: string) => encodeURIComponent(id.trim().replace("/", "~"));

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

// Searches in progress in this process, by wish and product: a double-tapped "See matches" (or a boot
// resume racing a lock) shouldn't pay for the same search twice.
const inflight = new Set<string>();

/**
 * Kick off a match search for a locked wish. Never throws (callers fire and forget it).
 * `resumeOf` is the original start time when re-running a search a restart interrupted.
 */
export async function findMatches(wishId: string, resumeOf?: number): Promise<void> {
  let flight: string | null = null;
  try {
    const wish = getWish(wishId);
    if (!wish) return;
    const key = `${wishId}:${keyFor(wish.spec)}`;
    if (inflight.has(key)) return;
    inflight.add((flight = key));
    await searchAndSave(wishId, wish.spec, resumeOf);
  } catch (err) {
    console.error(`[apify] match search for ${wishId} crashed:`, err);
    try {
      const wish = getWish(wishId);
      if (wish) save(wishId, sampleMatches(wish.spec), 0, SOURCES.length, true);
    } catch (e) {
      console.error("[apify] could not save fallback matches:", e);
    }
  } finally {
    if (flight) inflight.delete(flight);
  }
}

const RESUME_MAX_AGE_MS = 10 * 60_000;

/**
 * A server restart mid-search leaves match_runs.pending = 1 with nothing running, and the UI would
 * wait forever. Each interrupted search is re-run at most once, and only if it started in the last
 * 10 minutes (the resume keeps the original start time, so repeated restarts can't keep it young).
 * Everything else (already resumed once, older, or from before started_at existed) gets labelled
 * samples instead of another paid search: tsx watch restarts on every save, and the abandoned actor
 * run keeps billing to its end anyway.
 */
export function resumePendingMatches(now = Date.now()): void {
  const rows = db.prepare("SELECT wish_id, started_at, resumed FROM match_runs WHERE pending = 1").all() as { wish_id: string; started_at: number | null; resumed: number }[];
  if (rows.length) console.log(`[apify] ${rows.length} match search(es) interrupted by a restart`);
  for (const r of rows) {
    if (!r.resumed && r.started_at != null && now - r.started_at < RESUME_MAX_AGE_MS) {
      void findMatches(r.wish_id, r.started_at);
      continue;
    }
    try {
      const wish = getWish(r.wish_id);
      if (wish) save(r.wish_id, sampleMatches(wish.spec), 0, SOURCES.length, true);
      else db.prepare("DELETE FROM match_runs WHERE wish_id = ?").run(r.wish_id);
    } catch (e) {
      console.error("[apify] could not close stale search:", e);
    }
  }
}

/** False when the wish has been re-locked with a different product since this search started. */
function stillCurrent(wishId: string, spec: ProductSpec): boolean {
  const now = getWish(wishId);
  if (now && keyFor(now.spec) === keyFor(spec)) return true;
  console.log(`[apify] wish ${wishId} changed while searching; dropping the older result`);
  return false;
}

async function searchAndSave(wishId: string, spec: ProductSpec, resumeOf?: number): Promise<void> {
  db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample, started_at, resumed) VALUES (?, 0, ?, 1, 0, ?, ?)")
    .run(wishId, SOURCES.length, resumeOf ?? Date.now(), resumeOf != null ? 1 : 0);
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
    const { matches, searched, total, costUsd, listings, scoredBy } = await runActor(spec);
    console.log(`[apify] ${matches.length} matches from ${listings ?? "?"} listings (scored by ${scoredBy ?? "?"}) in ${Date.now() - started}ms, searched ${searched}/${total}, cost ~$${costUsd ?? "?"}`);
    // No store answered: that's an outage, not "nothing like it exists", so don't present it as a result.
    if (searched === 0) throw new Error(`no store answered (0 of ${total})`);
    // The result is right for this spec either way, so cache it even if the wish has moved on.
    if (shouldCache(matches.length, listings, scoredBy, searched, total)) writeCache(spec, matches, searched, total);
    else console.log(`[apify] not cached: ${scoredBy !== "llm" ? `scored by ${scoredBy ?? "unknown"}, not Claude` : searched < total ? `only ${searched} of ${total} stores answered` : "no listings to judge"}`);
    if (stillCurrent(wishId, spec)) save(wishId, matches, searched, total, false);
  } catch (err) {
    console.warn("[apify] failed, serving sample matches:", (err as Error).message);
    if (stillCurrent(wishId, spec)) save(wishId, sampleMatches(spec), 0, SOURCES.length, true);
  }
}

/**
 * Cached rows live 24 h (forever in DEMO_MODE), so only cache complete answers Claude scored:
 * - scoredBy must be "llm": keyword overlap is a degraded result, and an actor build older than
 *   scoredBy (null) only ever scored by keywords.
 * - every store must have answered: a partial search would stand in for the full one.
 * - an empty result counts only when stores returned listings and Claude rejected them all; zero
 *   listings usually means the stores came back empty-handed, which a later search may not.
 */
export function shouldCache(matchCount: number, listings: number | null, scoredBy: string | null, searched: number, total: number): boolean {
  if (scoredBy !== "llm" || searched < total) return false;
  return matchCount > 0 || (listings ?? 0) > 0;
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One synchronous run of the wish-matcher actor. Throws on HTTP errors, timeouts and unexpected bodies. */
export async function runActor(spec: ProductSpec) {
  const q = searchQuery(spec);
  const params = new URLSearchParams({ timeout: String(RUN_TIMEOUT_SECS), memory: String(RUN_MEMORY_MB) });
  const url = `https://api.apify.com/v2/acts/${actorPath(env.apifyActor!)}/run-sync-get-dataset-items?${params}`;
  const res = await fetch(url, {
    method: "POST",
    // Token in a header, not the query string, so it can't end up in logged URLs.
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apifyToken}` },
    // query is what Claude scores against; stores get the short searchQuery (also baked into the
    // sourceActors inputs). minScore 0 keeps every listing so the grid shows real results even when
    // scoring falls back to keywords.
    body: JSON.stringify({ query: matchQuery(spec), searchQuery: q, spec, sources: SOURCES, maxPerSource: MAX_PER_SOURCE, minScore: 0, sourceActors: sourceActors(q) }),
    // Aborts the request itself (a bare Promise.race would leave the socket open).
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: Error) => {
    throw new Error(err.name === "TimeoutError" ? `apify timed out after ${FETCH_TIMEOUT_MS}ms` : `apify fetch failed: ${err.message}`);
  });
  if (!res.ok) {
    // Failed/timed-out runs come back as 4xx JSON: { error: { type: "run-failed", message: "... status: TIMED-OUT" } }.
    const body = await res.text();
    let msg = body.slice(0, 300);
    try {
      const e = JSON.parse(body)?.error;
      if (e?.message) msg = `${e.type ?? "error"}: ${e.message}`;
    } catch {}
    throw new Error(`apify ${res.status}: ${msg}`);
  }
  const items = (await res.json()) as unknown;
  if (!Array.isArray(items)) throw new Error(`apify returned ${typeof items}, expected a dataset item array`);
  const meta = items.find((i) => i && typeof i === "object" && i._meta)?._meta;
  const matches: Match[] = items
    .filter((i) => i && typeof i === "object" && !i._meta && i.title && i.url)
    .map((i) => ({
      source: String(i.source ?? "web"),
      title: String(i.title),
      url: String(i.url),
      price: num(i.price),
      image: typeof i.image === "string" && i.image ? i.image : null,
      score: Math.max(0, Math.min(100, num(i.score) ?? 0)),
      missing: Array.isArray(i.missing) ? i.missing.map(String) : [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const searched = num(meta?.searched) ?? new Set(matches.map((m) => m.source)).size;
  const total = num(meta?.total) ?? SOURCES.length;
  return { matches, searched, total, costUsd: num(meta?.costUsd), listings: num(meta?.listings), scoredBy: typeof meta?.scoredBy === "string" ? meta.scoredBy : null };
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
        s(`Something like a ${matchQuery(spec)}`, 45, 38, ["key feature"]),
        s("Closest generic alternative", 30, 25, ["most of the wish"]),
      ];
  }
}
