/** Store actor configs and the pure helpers that turn their output into listings (no Apify runtime here, so it is unit-testable). */

// Default Store actors, checked against each actor's published input schema and sample output on
// 2026-10-24. Swap any of them via the `sourceActors` input without redeploying.
// `memory` is the sub-run's memory in MB (CPU scales with it); `base` resolves relative listing URLs.
export const DEFAULT_SOURCES = {
  amazon: {
    // Output: { title, url, price: { value, currency }, thumbnailImage }; empty searches push { error, url } rows.
    actorId: "junglee/amazon-crawler",
    input: {
      categoryOrProductUrls: [{ url: "https://www.amazon.com/s?k={{queryEncoded}}" }],
      maxItemsPerStartUrl: "{{max}}",
      maxSearchPagesPerStartUrl: 1,
      proxyCountry: "US",
    },
    memory: 2048,
    base: "https://www.amazon.com",
  },
  etsy: {
    // Output: { name, url, Price: "$49.00+", images: [...] }. Etsy blocks datacenter IPs, so the
    // actor's own prefill uses the RESIDENTIAL proxy group; plain `useApifyProxy` gets blocked.
    actorId: "epctex/etsy-scraper",
    input: {
      search: "{{query}}",
      maxItems: "{{max}}",
      endPage: 1,
      includeDescription: false,
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    },
    memory: 2048,
    base: "https://www.etsy.com",
  },
  google_shopping: {
    // Output: { title, link, price: "$24.99", imageUrl, source: <merchant> }. Hosted SERP API, no
    // browser or proxy, so it answers in seconds. `num` is a string enum in its schema ("10" is the minimum).
    actorId: "damilo/google-shopping-apify",
    // Google returns up to 40 products per page whatever `num` says, so cap the spend (~8 results at $0.0035).
    input: { query: "{{query}}", num: "10", max_pages: 1, country: "us", language: "en", date_range: "anytime" },
    maxChargeUsd: 0.03,
    memory: 1024,
    base: "https://www.google.com",
  },
};

/** Replace {{query}}, {{queryEncoded}}, {{max}} anywhere in an input template. A bare "{{max}}" becomes a number. */
export function fill(template, vars) {
  if (typeof template === "string") {
    if (template === "{{max}}") return vars.max;
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
  }
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  if (template && typeof template === "object") return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, vars)]));
  return template;
}

export const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "");

/** Numbers, { value }, or strings like "$1,299.99", "$49.00+", "From $24.99", "$20 - $30" (takes the first). */
export function toPrice(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "object") return toPrice(first(v.value, v.amount, v.current, v.price, v.extracted_value));
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/);
  const n = m ? Number(m[0].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

/** Absolute http(s) URL, resolving relative ("/dp/...") and protocol-relative ("//...") links against the store. */
function absoluteUrl(u, base) {
  if (typeof u !== "string" || !u.trim()) return null;
  try {
    const url = new URL(u.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Store actors all name things differently; take whatever looks like a title, link, price and image.
 * Field names below are the ones the default actors really output (see DEFAULT_SOURCES), plus common
 * spellings so a `sourceActors` override usually works without code changes.
 */
export function normalize(source, item, base = DEFAULT_SOURCES[source]?.base ?? "https://www.google.com") {
  if (!item || typeof item !== "object" || item.error) return null; // Amazon pushes { error, url } rows for empty searches
  // Etsy titles carry page junk after a newline ("...Handmade in the USA\nRegions Etsy does business in:").
  const rawTitle = first(item.title, item.name, item.productName, item.productTitle, item.product_title);
  const title = rawTitle == null ? null : String(rawTitle).split("\n")[0].replace(/\s+/g, " ").trim();
  const url = absoluteUrl(first(item.url, item.link, item.productUrl, item.product_url, item.productLink), base);
  if (!title || !url) return null;
  let image = first(item.thumbnailImage, item.productImage, item.imageUrl, item.image, item.thumbnail, item.mainImage, firstOf(item.images), firstOf(item.imageUrls));
  if (image && typeof image === "object") image = first(image.url, image.src, image.link);
  return {
    source,
    title: title.slice(0, 200),
    url,
    price: toPrice(first(item.price, item.Price, item.priceValue, item.currentPrice, item.extracted_price, item.priceString)),
    image: absoluteUrl(image, base),
  };
}

/**
 * What a finished sub-run cost us. Pay-per-event actors bill their events (results, start fee) on top
 * of, or instead of, platform usage, and `usageTotalUsd` alone misses them. Uses the FREE-tier event
 * price, the highest tier, so this is an upper estimate.
 */
export function runCostUsd(run) {
  const p = run?.pricingInfo;
  const events = p?.pricingPerEvent?.actorChargeEvents ?? {};
  let usd = 0;
  for (const [name, count] of Object.entries(run?.chargedEventCounts ?? {})) {
    const e = events[name];
    usd += (count || 0) * (e?.eventPriceUsd ?? e?.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? 0);
  }
  if (p?.pricingModel === "PRICE_PER_DATASET_ITEM") usd += (run?.stats?.datasetItemCount ?? 0) * (p.pricePerUnitUsd ?? 0);
  const platformPaidByUser = !p || p.pricingModel !== "PAY_PER_EVENT" || p.isPPEPlatformUsagePaidByUser;
  if (platformPaidByUser) usd += run?.usageTotalUsd ?? 0;
  return usd;
}
