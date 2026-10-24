# Step C2: Apify `wish-matcher` Actor and server cache

Owner: D · Phase 1 · Runs in parallel with A1, B1, C1. Work in `actor/` and `server/apify.ts`.

## Task
Actor (`actor/`, Node, Apify SDK):
- Input: `{ query, spec, sources: ["amazon", "etsy", "google_shopping"], maxPerSource: 5 }`. Keep the default at 5 to save credits.
- Pick one existing Apify Store actor per source. Test 2 or 3 candidates for each source tonight and record the choice and its cost per run in `actor/README.md`.
- Call the three in parallel with `Actor.call` and a 25 s timeout each. A source that fails or times out is skipped, not fatal.
- Normalize to `{ source, title, url, price, image }`.
- One LLM scoring call for all results against the spec: `{ score: 0-100, missing: ["laptop stand"] }`. 80+ = exists, 50 to 79 = close, under 50 = drop.
- Push the top 6 by score to the default dataset. Include `searched` / `total` source counts.
- Publish to the Apify Store with a clear README and input schema (this is our "Best Actor" entry).

Server (`server/apify.ts`):
- `findMatches(wishId, spec)` calls `POST https://api.apify.com/v2/acts/<username>~wish-matcher/run-sync-get-dataset-items?token=...`.
- Cache in `apify_cache` by a hash of the normalized query (lowercased, sorted key fields) for 24 h.
- `DEMO_MODE=1` reads from cache only and never calls Apify.
- Writes rows to `matches` and emits `matches:ready`. Log the run cost and duration.
- `GET /api/wish/:id/matches` returns cached or stored matches.

Also: run the demo wish (emerald convertible midi dress with phone pockets) and confirm the top score is **under 80**. If it isn't, tell the team today so the demo wish can change.

## Done when
The demo query returns scored results in under 25 s live, and in well under 1 s the second time from cache.
