# Step P2: Demo reset script

Owner: C (per plan; D owns demo seeding by role, so agree who takes it) · Phase 3.

## Task
`npm run demo:reset -- --planter-deadline=120`:
- Wipes demo rows (keeps `apify_cache` and `data/models`).
- Pre-warms the Apify cache for the demo wish (emerald convertible pocket midi) if missing.
- Ensures the demo wish's GLB exists in `data/models` (generates via Meshy if missing).
- Creates the "Self-watering desk planter" campaign: target 4, 2 real test-mode held pledges (create and confirm PaymentIntents server-side with `pm_card_visa`), and a deadline N seconds out.
- Prints the studio URL, both campaign URLs, and a checklist (Stripe tab open, decline card ready, hotspot on).
- Works against the deployed server (`--remote`) as well as locally.

## Done when
One command puts the demo in its starting state, and running it twice in a row gives the same result.
