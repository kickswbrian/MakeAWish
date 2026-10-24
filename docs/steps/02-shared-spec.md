# Step 0.3: Shared spec, events and API types

Owner: B · Phase 0 · Needs 01.

## Task
Write `shared/spec.ts` (export from `shared/index.ts`) with zod schemas and inferred types. This file is the contract all four tracks build against, so keep it small and stable.

### ProductSpec
```json
{
  "category": "dress | top | skirt | backpack | helmet | generic",
  "name": "Convertible Pocket Midi",
  "length": "mini | knee | midi | maxi",
  "silhouette": "fitted | a_line | wrap | flowy",
  "sleeves": "none | cap | short | long",
  "neckline": "crew | v | square | halter",
  "color": "#1F8A5B",
  "fabric": "cotton | satin | linen | knit",
  "pattern": "solid | floral | stripe",
  "features": ["phone_pockets", "converts_to_skirt"],
  "target_price_usd": 79,
  "notes": "bodice detaches at the waist"
}
```
- Every field optional except `category` (default `generic`). Export `defaultSpec`.
- `features` is a string array. Export a `KNOWN_FEATURES` list the 3D track renders: `phone_pockets`, `converts_to_skirt`, `laptop_stand` (backpack), `headphones` (helmet). Unknown features are allowed and kept for Meshy/Apify prompts.
- `color` is a hex string.
- Export `SpecPatch = ProductSpec.partial()` and `applyPatch(spec, patch)`. It must validate field by field and **drop invalid fields instead of throwing**.

### Socket events
Constants plus payload types: `spec:updated` `{ wishId, spec, changed: string[] }`, `meshy:ready` `{ wishId, modelUrl }`, `matches:ready` `{ wishId, matches, searched, total }` (it can fire once per store), `campaign:updated` `{ campaign }`.

### API types
Request and response types for every route:

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/api/wish` | `{ id, spec }` |
| POST | `/api/wish/:id/turn` | body `{ text }` → `{ say, spec, ms }` |
| POST | `/api/wish/:id/lock` | `{ ok }` |
| GET | `/api/wish/:id/matches` | `{ matches: Match[], searched, total }` |
| POST | `/api/campaigns` | body `{ wishId, priceCents, targetBackers, deadlineAt }` → `Campaign` |
| GET | `/api/campaigns/:id` | `Campaign` (with wish spec, model url, held count) |
| POST | `/api/campaigns/:id/pledges` | body `{ email }` → `{ pledgeId, clientSecret }` |
| GET | `/api/cartesia/token` | `{ token, expiresAt }` |
| POST | `/api/admin/campaigns/:id/expire` | `{ ok }` |

`Match = { source, title, url, price, image, score, missing: string[] }`.
`Campaign.status`: `funding | capturing | funded | releasing | expired`. `Pledge.status`: `created | held | failed | captured | released | capture_failed`.
Campaign deadline is capped at 6 days. Put that in the schema.

## Done when
- `web` and `server` both import from `shared` and `npm run build` passes.
- A small test shows `applyPatch` keeping valid fields and dropping a bad `color` and a bad enum value.
