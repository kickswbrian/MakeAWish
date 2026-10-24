import { colorName, describeSpec, EVENTS, type Match, type MatchesResponse, type ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { hash } from "./util.ts";
import { getWish } from "./wishes.ts";

const CACHE_MS = 24 * 3600_000;
export const SOURCES = ["amazon", "etsy", "google_shopping"];

// Actor run limits. The actor gives each store ~40 s (+10 s guard) and Claude up to 2 x 20 s, so a
// worst-case run is ~95 s; a run that hits its own timeout makes the sync endpoint return an error.
const RUN_TIMEOUT_SECS = 120;
const FETCH_TIMEOUT_MS = (RUN_TIMEOUT_SECS + 15) * 1000;
// The actor only waits on HTTP calls, so it doesn't need the platform default memory (billed per GB-hour).
const RUN_MEMORY_MB = 512;

/** Full description the listings are scored against: stable across field order and wording noise. */
export function matchQuery(spec: ProductSpec): string {
  const d = spec.category === "generic" && spec.name ? describeSpec(spec).replace(/\bwish\b/, spec.name) : describeSpec(spec);
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
 */
export function searchQuery(spec: ProductSpec): string {
  const generic = spec.category === "generic";
  const noun = generic ? (spec.name ?? "").trim() : spec.category;
  const color = spec.color ? colorName(spec.color) : "";
  const length = spec.length && (spec.category === "dress" || spec.category === "skirt") && spec.length !== "knee" ? spec.length : "";
  const feats = spec.features ?? [];
  const known = feats.find((f) => FEATURE_WORDS[f]);
  const words = known ? FEATURE_WORDS[known] : !generic && feats[0] ? { post: `with ${feats[0].replace(/_/g, " ")}` } : {};
  const q = [color, words.pre, length, noun || matchQuery(spec), words.post].filter(Boolean).join(" ");
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

/** Kick off a match search for a locked wish. Never throws. */
export async function findMatches(wishId: string): Promise<void> {
  const wish = getWish(wishId);
  if (!wish) return;
  const spec = wish.spec;
  db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample) VALUES (?, 0, ?, 1, 0)").run(wishId, SOURCES.length);
  db.prepare("DELETE FROM matches WHERE wish_id = ?").run(wishId);

  const cached = readCache(spec);
  if (cached) {
    console.log(`[apify] cache hit "${matchQuery(spec)}"`);
    return save(wishId, cached.matches, cached.searched, cached.total, false);
  }
  if (!env.apifyToken || !env.apifyActor || env.demoMode) {
    console.log(`[apify] ${env.demoMode ? "DEMO_MODE cache miss" : "no APIFY_TOKEN/APIFY_ACTOR"}, serving sample matches`);
    return save(wishId, sampleMatches(spec), SOURCES.length, SOURCES.length, true);
  }

  const started = Date.now();
  try {
    const { matches, searched, total, costUsd } = await runActor(spec);
    console.log(`[apify] ${matches.length} matches in ${Date.now() - started}ms, searched ${searched}/${total}, cost ~$${costUsd ?? "?"}`);
    // No store answered: that's an outage, not "nothing like it exists", so don't present it as a result.
    if (searched === 0) throw new Error(`no store answered (0 of ${total})`);
    // Cache empty results too when stores did answer: "nothing close" is a real answer, and re-running
    // a paid search on every lock (or falling back to samples in DEMO_MODE) would be wrong.
    writeCache(spec, matches, searched, total);
    save(wishId, matches, searched, total, false);
  } catch (err) {
    console.warn("[apify] failed, serving sample matches:", (err as Error).message);
    save(wishId, sampleMatches(spec), 0, SOURCES.length, true);
  }
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One synchronous run of the wish-matcher actor. Throws on HTTP errors, timeouts and unexpected bodies. */
export async function runActor(spec: ProductSpec) {
  const params = new URLSearchParams({ timeout: String(RUN_TIMEOUT_SECS), memory: String(RUN_MEMORY_MB) });
  const url = `https://api.apify.com/v2/acts/${actorPath(env.apifyActor!)}/run-sync-get-dataset-items?${params}`;
  const res = await fetch(url, {
    method: "POST",
    // Token in a header, not the query string, so it can't end up in logged URLs.
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apifyToken}` },
    body: JSON.stringify({ query: matchQuery(spec), searchQuery: searchQuery(spec), spec, sources: SOURCES, maxPerSource: 5 }),
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
  return { matches, searched, total, costUsd: num(meta?.costUsd) };
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
