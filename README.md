# ✦ Wish it

**Shop for products that don't exist yet, and only pay if they get made.**

Describe a product out loud ("a midi dress that turns into a skirt, with pockets that actually fit my phone"). A genie asks a couple of follow-ups while a 3D model reshapes as you talk. Wish it then checks whether the product already exists, using Apify to search Amazon and Google Shopping. If it doesn't, the wish becomes a campaign: backers scan a QR code and place a **card hold**. When enough people commit, every hold is captured and a purchase order goes to a maker. If the deadline passes first, every hold is released and nobody pays.

Built at Cal Hacks 13.0 for the Visa (Reimagining Shopping), Apify and Cartesia tracks.

## Run it

```bash
npm install
cp .env.example .env   # optional: every key has a fallback
npm run dev            # server :3000, web :5173 (open http://localhost:5173)
```

Each key you leave empty falls back, so the full flow runs offline:

| Piece | With keys | Without |
| --- | --- | --- |
| Genie (design brain) | Claude, one `update_spec` tool call per turn | Rule-based keyword genie |
| Voice | Cartesia Ink 2 STT (turn detection) and Sonic TTS | Browser speech APIs, plus the text box |
| Does it exist? | `wish-matcher` Apify Actor, cached 24 h | Clearly labelled sample listings |
| Hero 3D model | Meshy text-to-3D, swapped in when ready | The parametric model stays |
| Payments | Stripe **test mode** manual-capture holds | Simulated provider with the same test cards |

Other commands:

```bash
npm test                 # shared spec tests + 3D render coverage
npm run typecheck        # shared + server + web
npm run brain:test       # 5 scripted genie turns (step B2's check)
npm run judge            # judge-request corpus through the rule brain (see "Judge edits")
npm run judge -- --brain=cli --cases=../shared/judge/heldout2.json   # same, through Claude via the claude CLI
npm run demo:reset -- --planter-deadline=120   # demo starting state (needs the server running)
npm run demo:reset -- --remote=https://your.deploy --planter-deadline=180
npm run build && npm start   # production: one process serves API + web
```

Stripe webhooks locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`. Without a webhook secret, the pledge page polls Stripe every 3 s, so holds still register.

## Screens

| Route | What |
| --- | --- |
| `/` | The studio. Talk to the orb, watch the product form, lock it in, see matches, launch a campaign with a QR code. One canvas, no page changes. `?debug` shows per-turn latency. |
| `/c/:id` | Mobile pledge page: email, card, hold. Shows released or captured afterwards, plus the purchase order. |
| `/campaign/:id` | Laptop campaign view (QR, live demand bar). `?admin` adds a "Force deadline" button. |
| `/wishlist` | My wishes and the live "Most wished" leaderboard. |
| `/debug` | 3D test bench: edit the spec JSON and watch the model morph. |

## Architecture

```
browser (studio, laptop) ──audio──> Cartesia (Ink 2 STT / Sonic TTS, short-lived token)
        │  REST + Socket.IO
        ▼
Node server (Express + Socket.IO + SQLite) ──> Claude (update_spec tool)
        │                                  ──> Apify wish-matcher Actor ──> Amazon / Google Shopping actors
        │                                  ──> Meshy text-to-3D (GLB served from /models)
        │                                  <─> Stripe test mode (manual capture, webhooks)
        ▼
browser (pledge page, phone) ──card──> Stripe Payment Element
```

- `shared/`: the contract. A `ProductSpec` zod schema, `applyPatch` (drops invalid fields, never throws), socket event names and API types. Also the keyword "instant guess" that starts forming the product from live captions before the server answers.
- `server/`: turn handling (patch applied and `spec:updated` emitted **before** the reply is spoken), campaign state machine, Apify and Meshy jobs, Stripe and simulated payments, and deadline timers that are rebuilt on boot.
- `web/`: React + react-three-fiber. Parametric garments on a dress form (lathe-style skirt whose shape comes from length and silhouette, bodice with blended necklines, sleeves, pockets, a glowing convertible seam), a backpack with a fold-out laptop stand, and a helmet with headphone cups. Every spec change morphs over about 400 ms with a particle shimmer. Also the sparkle orb, bloom, and the Meshy GLB dissolve-swap.
- `actor/`: the `wish-matcher` Apify Actor. It calls three Store actors in parallel with per-store timeouts, normalizes listings, scores them all in one Claude call, and returns the top matches plus a `_meta` row. See [actor/README.md](actor/README.md).

### Payments: card holds as a commitment primitive

A pledge creates a PaymentIntent with `capture_method: "manual"`. It only counts once Stripe confirms the hold (`amount_capturable_updated`). When held pledges reach the target, a single SQLite transaction flips the campaign from `funding` to `capturing`, so exactly one caller runs the captures (with idempotency keys `capture-<pledgeId>`). If the deadline passes first, every hold is canceled. Campaigns are capped at 6 days to stay inside the 7-day hold window. Webhook handlers are idempotent by PaymentIntent id and status.

Test cards: `4242 4242 4242 4242` (works), `4000 0000 0000 0002` (declined), `4000 0000 0000 9995` (insufficient funds).

### Agent checkout: the genie pays as a Visa Trusted Agent Protocol agent

On the campaign view, "Genie, back it for me" lets the genie pledge for the shopper within a spending limit they set. This follows [Visa's Trusted Agent Protocol](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications) (TAP).

**How it works:**

1. The shopper's limit becomes a mandate: a cap, an expiry at the campaign deadline, and this campaign only. It is modelled on Visa Intelligent Commerce payment instructions.
2. The genie signs its checkout request with RFC 9421 HTTP Message Signatures: Ed25519, `tag="agent-payer-auth"`, covering `@authority`, `@path` and `content-digest`. The body carries an `agenticPaymentContainer` signed with the same key and nonce.
3. Wish it, as the merchant, verifies the request before placing the hold. In order: trusted-agent tag, required fields, timestamps no more than 8 minutes apart, nonce not replayed, key from the registry, body digest, signature, payment container, and the mandate.
4. Every check appears live in the trust log. The "Try to fool the merchant" buttons send an unsigned bot, a replayed request, an amount edited in flight, an expired signature, and an over-limit request. Each is refused at the step the spec names, and none places a hold.

**Files:** `server/src/tap.ts` (protocol), `server/src/agent.ts` (genie and merchant), `web/src/ui/AgentCheckout.tsx` (panel).

**Tests:**

- `npm test -w server` runs the protocol tests.
- `npm run tap:demo -- --base=http://localhost:3000` checks it against a running server.

**What is real and what isn't:**

- Real: the signatures and verification are real TAP.
- Not real: Visa Intelligent Commerce (agentic tokens, payment instructions, the Visa key directory) is open to approved partners only. So the genie's public key is served by Wish it's own registry at `GET /api/tap/keys?keyID=`, and the mandate lives in Wish it.
- The holds themselves are Stripe test mode, or the simulated provider.

## Deploy

`render.yaml` defines one Render web service with a persistent disk for SQLite and models. Set `PUBLIC_URL` to the HTTPS URL (the mic needs HTTPS, and phones need a reachable QR link), add the keys, and register `https://<host>/api/stripe/webhook` in the Stripe dashboard for the four `payment_intent.*` events.

The maker is simulated: purchase orders go to a plausible stub maker. The payments are real card holds in Stripe test mode.
