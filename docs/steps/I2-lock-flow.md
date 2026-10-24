# Step I2: Lock flow, Meshy hero model and match cards

Owners: A + C · Phase 2 · Needs A1, C2 merged.

## Task
Server:
- `POST /api/wish/:id/lock` sets status `locked`, then starts both jobs in the background without awaiting them:
  - **Meshy:** `POST https://api.meshy.ai/openapi/v2/text-to-3d` with `{ mode: "preview", prompt, should_remesh: true }` (prompt built from the spec). Poll `GET /openapi/v2/text-to-3d/{id}` every 5 s until `SUCCEEDED`. Download `model_urls.glb` to `data/models/<wishId>.glb`, serve it at `/models/:wishId.glb`, and emit `meshy:ready`. If a cached GLB exists for this wish, emit right away. Failure is silent: the parametric model stays.
  - **Apify:** `findMatches`, emitting `matches:ready` as results arrive.
- The genie's "yes, make it real" (`lock: true` from B2) and the glowing "Wish it" button both call lock.

Web, results screen (screen 2), same canvas with no reload:
- The model slides up to top center, still spinnable and still voice-editable.
- A 2x2 grid of match cards streams in: photo, store, price, score, and "missing: …" chips. Show "Searched 2 of 3 stores" when partial.
- Top card scores 80+: it gets a "This exists" badge, a buy link, and the genie says "It exists, here it is."
- Otherwise: a glowing "Wish it into existence" CTA (wired in I3) and the genie names the closest gap ("Closest match scores 62, but no phone-sized pockets").
- On `meshy:ready`, pass `heroUrl` so the particle dissolve swaps in the GLB.
- Heart top right saves the wish to the wishlist (localStorage list of wish ids is fine).

## Done when
Lock shows the match cards and then the hero model, with no page reload.
