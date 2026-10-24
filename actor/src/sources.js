/** Store actor configs and the pure helpers that turn their output into listings (no Apify runtime here, so it is unit-testable). */

// zodOutputFormat (SDK 1.x) builds the JSON schema with zod/v4's toJSONSchema; a schema made with the
// classic `zod` import throws inside it ("Cannot read properties of undefined (reading 'def')").
import { z } from "zod/v4";

// Default Store actors, checked against each actor's published input schema and sample output on
// 2026-10-24. Swap any of them via the `sourceActors` input without redeploying.
// `memory` is the sub-run's memory in MB (CPU scales with it); `base` resolves relative listing URLs.
export const DEFAULT_SOURCES = {
  amazon: {
    // Output: { title, url | asin, price: { value, currency }, thumbnailImage }; empty searches push
    // { error, url } rows. Search-page data only (no product page visits), which keeps it fast.
    actorId: "junglee/amazon-crawler",
    input: {
      categoryOrProductUrls: [{ url: "https://www.amazon.com/s?k={{queryEncoded}}" }],
      maxItemsPerStartUrl: "{{max}}",
      maxSearchPagesPerStartUrl: 1,
      scrapeProductDetails: false,
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
      // Pin the exit country: Etsy prices in the visitor's local currency ("€45,00") otherwise.
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "US" },
    },
    memory: 2048,
    base: "https://www.etsy.com",
  },
  google_shopping: {
    // Output: { productName, productLink, price, productImage (sometimes an inline data: URI) }.
    // maxItems caps the run; without it the scraper keeps paging (and charging) until the timeout.
    // (emastra/... now resolves to epctex/google-shopping-scraper.) The spend cap is a backstop.
    actorId: "emastra/google-shopping-scraper",
    input: { queries: ["{{query}}"], maxItems: "{{max}}", maxItemsPerQuery: "{{max}}", countryCode: "us" },
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

// Prices are shown as USD, so a listing priced in another currency gets no price rather than a wrong one.
// Codes may touch the digits on either side ("INR500", "500INR", "Rs,500"); letter-only lookarounds
// instead of \b catch those without matching inside words like "RSVP", "Mrs" or "Euro-style".
const FOREIGN_CURRENCY = /[€£¥₹₨₩₽₺₫₪]|(?<![a-z])Rs(?![a-z])|(?<![a-z])(?:EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|MXN|BRL|KRW|CNY|RMB|HKD|SGD|ZAR|TRY|RUB)(?![a-z])|\b(?:CA|AU|A|C|NZ|HK|S|R|MX)\$/i;
// US number formats only: "1,299.99", "1299", ".99". "1.299,00" and "45,00" are another locale's, and
// so is "1.299" (a dot before exactly three digits reads as a thousands separator, not cents).
const US_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;
const DOT_THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/;

/**
 * USD amount from numbers, { value, currency }, or strings like "$1,299.99", "$49.00+", "From $24.99",
 * "$.99", "$20 - $30" (takes the first), "2 for $10" (the number after "$"). Non-USD currencies
 * ("€45,00", "£12", "CA$30", "Rs. 500") and non-US number formats ("$1.299,00", "45,00") return null.
 */
export function toPrice(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "object") {
    const cur = first(v.currency, v.currencyCode, v.symbol);
    if (cur != null && !/^(\$|usd|us\$)$/i.test(String(cur).trim())) return null;
    return toPrice(first(v.value, v.amount, v.current, v.price, v.extracted_value));
  }
  const s = String(v);
  if (FOREIGN_CURRENCY.test(s)) return null;
  // Prefer the amount right after "$"; with no "$" (e.g. "USD 15", "24.99") take the first number.
  const m = s.includes("$") ? s.match(/\$\s*(\.?\d[\d.,]*)/) : s.match(/(\.?\d[\d.,]*)/);
  const token = m?.[1].replace(/[.,]+$/, "");
  if (!token || !US_NUMBER.test(token) || DOT_THOUSANDS.test(token)) return null;
  const n = Number(token.replace(/,/g, ""));
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
  // Amazon's search-page-only results can come with just an ASIN.
  const asinUrl = typeof item.asin === "string" && item.asin ? `https://www.amazon.com/dp/${item.asin}` : undefined;
  const url = absoluteUrl(first(item.url, item.link, item.productUrl, item.product_url, item.productLink, asinUrl), base);
  if (!title || !url) return null;
  let image = first(item.thumbnailImage, item.productImage, item.imageUrl, item.image, item.thumbnail, item.mainImage, firstOf(item.images), firstOf(item.imageUrls));
  if (image && typeof image === "object") image = first(image.url, image.src, image.link);
  // Inline base64 thumbnails (Google Shopping) are kept only when small.
  const inline = typeof image === "string" && /^data:image\//.test(image) ? (image.length < 20000 ? image : null) : undefined;
  return {
    source,
    title: title.slice(0, 200),
    url,
    price: toPrice(first(item.price, item.Price, item.priceValue, item.currentPrice, item.extracted_price, item.priceString)),
    image: inline !== undefined ? inline : absoluteUrl(image, base),
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

/** Claude's structured output for scoring: one entry per listing index. */
export const Scores = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      score: z.number().int(),
      missing: z.array(z.string()),
    }),
  ),
});
