import { test } from "node:test";
import assert from "node:assert/strict";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DEFAULT_SOURCES, fill, normalize, Scores, toPrice } from "../src/sources.js";

test("Scores builds a structured-output format and parses a reply", () => {
  // Regression: a schema built with the classic `zod` import threw inside zodOutputFormat, so every
  // run silently fell back to keyword scoring.
  const format = zodOutputFormat(Scores);
  assert.equal(format.type, "json_schema");
  assert.equal(format.schema.type, "object");
  assert.deepEqual(format.parse('{"results":[{"index":0,"score":72,"missing":["phone-sized pockets"]}]}'), {
    results: [{ index: 0, score: 72, missing: ["phone-sized pockets"] }],
  });
});

test("toPrice reads USD prices", () => {
  assert.equal(toPrice("$1,299.99"), 1299.99);
  assert.equal(toPrice("$49.00+"), 49);
  assert.equal(toPrice("From $24.99"), 24.99);
  assert.equal(toPrice("$20.00 - $30.00"), 20);
  assert.equal(toPrice("$.99"), 0.99);
  assert.equal(toPrice("USD 15"), 15);
  assert.equal(toPrice("2 for $10"), 10); // the number after "$", not the first number
  assert.equal(toPrice("$ 1,000"), 1000);
  assert.equal(toPrice({ value: 145.5, currency: "$" }), 145.5);
  assert.equal(toPrice(12.5), 12.5);
});

test("toPrice returns null for other currencies, other number formats and non-prices", () => {
  for (const v of ["€45,00", "£12.00", "45,00 €", "CA$30", "A$ 20", "EUR 10", "¥1200", "Rs. 500", "Rs500", "₨500", "$1.299,00", "$1.299", "$12.500", "45,00", "$45,00", "Free", "", 0, -3]) {
    assert.equal(toPrice(v), null, JSON.stringify(v));
  }
  assert.equal(toPrice({ value: 45, currency: "EUR" }), null);
});

test("normalize reads each default store's documented output", () => {
  const amazon = normalize("amazon", { title: "Dress", url: "/dp/B1", price: { value: 39.99, currency: "$" }, thumbnailImage: "https://m.media-amazon.com/x.jpg" });
  assert.deepEqual(amazon, { source: "amazon", title: "Dress", url: "https://www.amazon.com/dp/B1", price: 39.99, image: "https://m.media-amazon.com/x.jpg" });
  const etsy = normalize("etsy", { name: "Midi Dress\nRegions Etsy does business in:", url: "https://www.etsy.com/listing/1", Price: "$49.00+", images: ["https://i.etsystatic.com/a.jpg"] });
  assert.equal(etsy.title, "Midi Dress");
  assert.equal(etsy.price, 49);
  const gs = normalize("google_shopping", { title: "Earbuds", link: "https://www.google.com/search?ibp=oshop&q=x", price: "$24.99", imageUrl: "https://encrypted-tbn1.gstatic.com/x" });
  assert.equal(gs.price, 24.99);
  assert.equal(normalize("amazon", { error: "no_results_found", url: "https://www.amazon.com/s?k=x" }), null);
});

test("filled inputs use the types the store actors' schemas require", () => {
  const vars = { query: "emerald convertible dress", queryEncoded: "emerald+convertible+dress", max: 5 };
  assert.equal(fill(DEFAULT_SOURCES.amazon.input, vars).maxItemsPerStartUrl, 5);
  assert.equal(fill(DEFAULT_SOURCES.etsy.input, vars).maxItems, 5);
  assert.equal(fill(DEFAULT_SOURCES.etsy.input, vars).proxy.apifyProxyCountry, "US");
  assert.equal(fill(DEFAULT_SOURCES.google_shopping.input, vars).maxItems, 5); // without it the scraper keeps paging
  assert.equal(fill(DEFAULT_SOURCES.amazon.input, vars).scrapeProductDetails, false);
});

test("normalize handles search-page-only Amazon rows and inline thumbnails", () => {
  assert.equal(normalize("amazon", { title: "Dress", asin: "B0ABC" }).url, "https://www.amazon.com/dp/B0ABC");
  const small = "data:image/webp;base64," + "A".repeat(100);
  assert.equal(normalize("google_shopping", { productName: "X", productLink: "https://www.google.com/shopping/product/1", productImage: small }).image, small);
  const big = "data:image/webp;base64," + "A".repeat(30000);
  assert.equal(normalize("google_shopping", { productName: "X", productLink: "https://www.google.com/shopping/product/1", productImage: big }).image, null);
});
