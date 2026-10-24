# Step C1: Payments (Stripe manual-capture holds)

Owner: C · Phase 1 · Runs in parallel with A1, B1, C2. Stripe **test mode only**.

## Task
Server:
- `POST /api/campaigns` creates a campaign from a wish. Status `funding`; deadline capped at 6 days.
- `GET /api/campaigns/:id` returns the campaign, wish spec, model url and held count.
- `POST /api/campaigns/:id/pledges` with `{ email }`. Reject unless status is `funding`. Insert a pledge (`created`), then `stripe.paymentIntents.create({ amount, currency: 'usd', capture_method: 'manual', metadata: { campaignId, pledgeId } })`. Return `{ pledgeId, clientSecret }`.
- `POST /api/stripe/webhook` uses the raw body and verifies the signature with `STRIPE_WEBHOOK_SECRET`. Every handler is idempotent by `payment_intent_id` + status.
  - `payment_intent.amount_capturable_updated` (status `requires_capture`) → pledge `held`, emit `campaign:updated`, then check the goal.
  - `payment_intent.payment_failed` → pledge `failed`, store the decline reason.
  - `payment_intent.succeeded` → pledge `captured`. When none are left `held`, the campaign becomes `funded` and gets a stub `maker_json`.
  - `payment_intent.canceled` → pledge `released`. When none are left `held`, the campaign becomes `expired`.
- **Goal hit (exactly once):** in one `better-sqlite3` transaction, count held pledges; if `held >= target` and status is `funding`, set `capturing`. Only the caller that wins this flip runs `stripe.paymentIntents.capture(id, {}, { idempotencyKey: 'capture-<pledgeId>' })` for each held pledge. A failed capture marks that pledge `capture_failed` and continues.
- **Deadline:** a timer every 5 s, also run on boot. A `funding` campaign past its deadline → `releasing` → `stripe.paymentIntents.cancel(id)` for each held pledge.
- `POST /api/admin/campaigns/:id/expire` sets the deadline to now.
- Emit `campaign:updated` on every state change.

Web: a mobile-first pledge page at `/c/:id` showing the product name, price, and an "X of N backers" bar. Email field plus the Stripe Payment Element. `stripe.confirmPayment({ elements, redirect: 'if_required' })`. Show "Hold placed, you'll only be charged if this gets made", or the decline reason. Fallback: poll the pledge status every 3 s in case the webhook is slow. After release, show "Released, you were not charged."

Local webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Also register the deployed webhook URL in the Stripe dashboard.

Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` generic decline, `4000 0000 0000 9995` insufficient funds.

## Done when
- A target-3 campaign: 3 pledges with 4242 all show captured in the Stripe dashboard, and the campaign is `funded`.
- A declined card shows its error and doesn't move the count.
- An expired campaign's holds show canceled in Stripe.
- Replaying a webhook (`stripe events resend`) changes nothing.
