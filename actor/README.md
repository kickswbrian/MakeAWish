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
  "spec": { "category": "dress", "color": "#1F8A5B", "features": ["converts_to_skirt", "phone_pockets"] },
  "sources": ["amazon", "etsy", "google_shopping"],
  "maxPerSource": 5,
  "timeoutSecs": 25
}
```

Only `query` is required. `spec` makes the "missing" lists sharper.

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

1. One existing Store actor per store, called in parallel with `Actor.call` and a per-store timeout. A store that fails or times out is skipped, so you get partial results instead of an error.
2. Listings are normalized to `{ source, title, url, price, image }`, whatever field names the store actor uses.
3. **One** Claude call (structured output) scores all listings at once. With no `ANTHROPIC_API_KEY` set, it falls back to keyword overlap.

## Configuration

| Env var (Actor secret) | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude scoring. Optional; without it, keyword scoring is used. |
| `SCORING_MODEL` | Override the scoring model (default `claude-opus-5-5`). |

### Store actors

| Source | Default Store actor | Cost per run | Status |
| --- | --- | --- | --- |
| amazon | `junglee/amazon-crawler` | _measure_ | **To verify** |
| etsy | `epctex/etsy-scraper` | _measure_ | **To verify** |
| google_shopping | `emastra/google-shopping-scraper` | _measure_ | **To verify** |

These defaults have not been test-run yet. Before the demo, run 2 or 3 candidates per store, record the winner and its cost here, and swap any of them without redeploying via the `sourceActors` input:

```json
{ "sourceActors": { "etsy": { "actorId": "someone/etsy-scraper", "input": { "search": "{{query}}", "maxItems": "{{max}}" } } } }
```

`{{query}}`, `{{queryEncoded}}` and `{{max}}` are substituted into the input template.

## Cost control

Defaults are 5 results per store, 3 stores and one LLM call per run. Wish it caches results for 24 h by query, and its `DEMO_MODE=1` serves from cache only, so rehearsals cost nothing.

## Deploy

```bash
npm i -g apify-cli
apify login
cd actor && apify push
```

Then set `ANTHROPIC_API_KEY` as a secret env var in the Actor's settings, publish it to the Store, and set `APIFY_ACTOR=<username>~wish-matcher` on the Wish it server.
