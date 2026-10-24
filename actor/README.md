# Wish Matcher: does this product already exist?

Describe a product you wish someone made. Wish Matcher searches **Amazon, Etsy and Google Shopping in parallel**, then has Claude score every listing **0 to 100** against your idea and say exactly what each one is missing.

- **80+**: it exists, go buy it.
- **50 to 79**: close, but missing something ("no phone-sized pockets").
- **Under 50**: dropped.

Built for [Wish it](../README.md) (Cal Hacks 13.0): if nothing scores 80+, the wish becomes a crowdfunded campaign backed by card holds.

## Input

```json
{
  "query": "emerald satin midi dress that converts to a skirt with phone pockets",
  "searchQuery": "emerald convertible midi dress",
  "spec": { "category": "dress", "color": "#1F8A5B", "features": ["converts_to_skirt", "phone_pockets"] },
  "sources": ["amazon", "etsy", "google_shopping"],
  "maxPerSource": 5,
  "timeoutSecs": 40
}
```

Only `query` is required. `spec` makes the "missing" lists sharper. `searchQuery` is what gets typed into each store's search box: store search returns little or nothing for a whole feature sentence, so keep it to the product noun plus a color or one key feature. Listings are still scored against the full `query`. Without it, `query` is used for both.

## Output

Up to 6 dataset items, best first:

```json
{ "source": "etsy", "title": "Convertible Wrap Midi Dress", "url": "https://...", "price": 74, "image": "https://...", "score": 62, "missing": ["phone-sized pockets"] }
```

plus one metadata row: `{ "_meta": { "searched": 3, "total": 3, "costUsd": 0.021, "ms": 18400, "listings": 15 } }`.

Call it synchronously:

```bash
curl -X POST "https://api.apify.com/v2/acts/<username>~wish-matcher/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H 'Content-Type: application/json' -d '{"query":"backpack with a built-in laptop stand"}'
```

## How it works

1. One existing Store actor per store, called in parallel with `Actor.call` and a per-store timeout. A store that fails is skipped, and one that times out keeps whatever it found before the cut-off, so you get partial results instead of an error.
2. Listings are normalized to `{ source, title, url, price, image }`, whatever field names the store actor uses.
3. **One** Claude call (structured output) scores all listings at once. With no `ANTHROPIC_API_KEY` set, it falls back to keyword overlap.

## Configuration

| Env var (Actor secret) | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude scoring. Optional; without it, keyword scoring is used. |
| `SCORING_MODEL` | Override the scoring model (default `claude-opus-5-5`). |

### Store actors

Checked on 2026-10-24 against each actor's published input schema, sample output and pricing (Apify API, no live run yet). Prices are the list price per result at 5 results per store.

| Source | Default Store actor | Input we send | Output fields read | List price, 5 results |
| --- | --- | --- | --- | --- |
| amazon | `junglee/amazon-crawler` | search URL, `maxItemsPerStartUrl`, 1 page, `proxyCountry: "US"` | `title`, `url`, `price.value`, `thumbnailImage` | ~$0.025 ($0.005/result) |
| etsy | `epctex/etsy-scraper` | `search`, `maxItems`, `endPage: 1`, RESIDENTIAL proxy | `name`, `url`, `Price` ("$49.00+"), `images[0]` | ~$0.017 ($0.0034/result) + compute and residential proxy |
| google_shopping | `damilo/google-shopping-apify` | `query`, `num: "10"` (string enum), 1 page, `us`/`en` | `title`, `link`, `price` ("$24.99"), `imageUrl` | ~$0.0175, capped at $0.03 |

Why these:

- **Google Shopping** was `emastra/google-shopping-scraper`, which now resolves to `epctex/google-shopping-scraper`. Our input used `maxPagesPerQuery` and `resultsPerPage`, which that actor doesn't have, so nothing capped the result count; and it outputs `productName`/`productImage`, which we didn't read, so every Google Shopping listing was dropped. It also scrapes Google through a SERP proxy (472 runs in the last 30 days, 20 timed out). `damilo/google-shopping-apify` uses a hosted SERP API, answers in seconds, and had 10,604 runs in the last 30 days with 94% succeeded and none timed out. To go back, override it (see below).
- **Etsy** needs the RESIDENTIAL proxy group (its own prefill uses it; Etsy blocks datacenter IPs), and its price field is `Price` with a capital P.
- All three are pay-per-event now (Apify retired rental pricing in October 2026). Every sub-run gets `maxTotalChargeUsd` (about $0.06 at 5 results, $0.03 for Google Shopping) so one misbehaving store can't run up the bill. `_meta.costUsd` adds up charged events plus platform usage where the user pays it, priced at the free-tier rate, so it is an upper estimate.

Swap any of them without redeploying via the `sourceActors` input, e.g. back to the old Google Shopping actor:

```json
{ "sourceActors": { "google_shopping": { "actorId": "epctex/google-shopping-scraper", "input": { "queries": ["{{query}}"], "maxItems": "{{max}}", "countryCode": "us" } } } }
```

`{{query}}` (the store search query), `{{queryEncoded}}` and `{{max}}` are substituted into the input template; a bare `"{{max}}"` becomes a number. `normalize()` in `src/sources.js` reads the common field spellings (`title`/`name`/`productName`, `url`/`link`/`productLink`, `price`/`Price`, image fields and arrays), so most overrides work without code changes.

## Cost control

Defaults are 5 results per store, 3 stores, a spend cap on every store run and one LLM call per run: roughly $0.06 to $0.08 per search at list prices plus the Claude call. Wish it caches results for 24 h by product (an empty result is cached too, as long as at least one store answered), and its `DEMO_MODE=1` serves from cache only, so rehearsals cost nothing.

## Deploy

```bash
npm i -g apify-cli
apify login
cd actor && apify push
```

Then set `ANTHROPIC_API_KEY` as a secret env var in the Actor's settings, publish it to the Store, and set `APIFY_ACTOR=<username>~wish-matcher` on the Wish it server.
