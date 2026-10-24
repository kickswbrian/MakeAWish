# Step I3: Campaign launch, QR, wishlist and live demand bar

Owners: A + C · Phase 2 · Needs C1 merged.

## Task
- "Wish it into existence" opens a small launch sheet: price (prefilled from `target_price_usd`), target backers, and duration (demo presets: 2 min, 5 min, 1 day, 6 days max). It calls `POST /api/campaigns`.
- Campaign view on the laptop: product, demand bar "X of N", countdown, a big QR code (`qrcode.react`) to `PUBLIC_URL/c/:id`, and a short URL printed under it.
- Every screen subscribes to `campaign:updated`. On each new held pledge, a star flies into the demand bar and the bar pulses.
- Hidden admin button (`?admin`) calls `/api/admin/campaigns/:id/expire`.
- Wishlist (screen 3) at `/wishlist`:
  - **My wishes** tab: hearted or launched wishes with thumbnail, status (saved, funding, funded, released), and a live demand bar. Tap opens the campaign view.
  - **Most wished** tab (leaderboard, low priority, cut first): campaigns ranked by held pledges. Needs a `GET /api/campaigns?sort=held` route.

## Done when
A pledge from a phone updates the laptop's bar within 2 s.
