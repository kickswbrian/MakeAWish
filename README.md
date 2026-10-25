# ✦ Wish it

**Shop for products that don't exist yet, and only pay if they get made.**

Describe a product out loud ("a midi dress that turns into a skirt, with pockets that actually fit my phone"). A genie asks a couple of follow-ups while a 3D model reshapes as you talk. Wish it then checks whether the product already exists, using Apify to search Amazon, Etsy and Google Shopping. If it doesn't, the wish becomes a campaign: backers scan a QR code and place a **card hold**. When enough people commit, every hold is captured and a purchase order goes to a maker. If the deadline passes first, every hold is released and nobody pays.

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
| Genie (design brain) | Claude Opus 5.5 fast mode (new designs) + Sonnet 5 (edits), streamed patch tool calls | Templates + the instant fast path |
| Voice | Cartesia Ink 2 STT (turn detection) and Sonic TTS | Browser speech APIs, plus the text box |
| Does it exist? | `wish-matcher` Apify Actor, cached 24 h | Clearly labelled sample listings |
| Payments | Stripe **test mode** manual-capture holds | Simulated provider with the same test cards |

Other commands:

```bash
npm test                 # shared product/patch/fast-path tests
npm run typecheck        # shared + server + web
npm run brain:test       # genie latency bench: new designs + edits, writes web/public/bench/*.json
npm run demo:reset -- --planter-deadline=120   # demo starting state (needs the server running)
npm run demo:reset -- --remote=https://your.deploy --planter-deadline=180
npm run build && npm start   # production: one process serves API + web
```

Stripe webhooks locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`. Without a webhook secret, the pledge page polls Stripe every 3 s, so holds still register.

## Demo script (about 90 seconds)

1. **Wish** (tap Talk): "A midi dress that turns into a skirt, with pockets that actually fit my phone." The template appears the instant you stop talking; the genie customizes it and asks a follow-up.
2. **Instant edits** (no LLM, under a frame): "Make it navy." "A bit longer." "Make the pockets gold." "Undo."
3. **Tap to edit**: tap the waist zipper. The camera flies to it, a gold outline pulses, and the genie card shows its real size. Tap a swatch, then ask the card: "add a little bow here". It lands exactly where you tapped.
4. **Show off**: "Take it apart" (exploded view), "show me the back", "put it back together". Press `G` for the gizmo and drag a part.
5. **Something new**: "A robot vacuum that looks like a turtle". With no template it builds from scratch: first parts in ~1.5 s, finished in ~6 s, parts popping in with sparkles.
6. **See matches**, then **Wish it into existence**: launch the campaign, scan the QR code with a phone and place a card hold.

Add `?debug` to the studio URL to show per-turn latency (speech end → request → first patch → last patch → first audio).

## Screens

| Route | What |
| --- | --- |
| `/` | The studio. Talk to the orb, watch the product form, lock it in, see matches, launch a campaign with a QR code. One canvas, no page changes. `?debug` shows per-turn latency. |
| `/c/:id` | Mobile pledge page: email, card, hold. Shows released or captured afterwards, plus the purchase order. |
| `/campaign/:id` | Laptop campaign view (QR, live demand bar). `?admin` adds a "Force deadline" button. |
| `/` (wish world) | After the matches, "Can't find it?" flies your bubble into a pannable field of past wishes nobody has made yet (`GET /api/world`). Click one for its details and up/down votes (`POST /api/wish/:id/vote`, one per browser); **Organize** lines them up by popularity. Your own bubble's panel launches the campaign. |
| `/wishlist` | My wishes and the live "Most wished" board, ranked by community upvotes (one per browser, toggleable; also on the campaign and pledge pages). |
| `/debug` | 3D bench: templates (`?t=backpack`), bench results (`?src=/bench/lamp.json`), live product JSON; `&bare` for full screen. |
| `/lab/materials`, `/lab/kit` | Material presets and the 31 kit parts under studio light. |

## Architecture

```
browser (studio, laptop) ──audio──> Cartesia (Ink 2 STT / Sonic TTS, short-lived token)
        │  REST + Socket.IO
        ▼
Node server (Express + Socket.IO + SQLite) ──> Claude (streamed plan_design / add_parts / apply_patches)
        │                                  ──> Apify wish-matcher Actor ──> Amazon / Etsy / Google Shopping actors
        │                                  <─> Stripe test mode (manual capture, webhooks)
        ▼
browser (pledge page, phone) ──card──> Stripe Payment Element
```

- `shared/`: the contract. A product is a flat map of `Part`s with parent links (`product.ts`: zod schemas, `applyPatches` that validates and never throws); every edit is a `Patch` (`add` / `update` / `remove`). Also the kit catalog (`kit.ts`, 31 parts with attachment points), 20 hand-built templates (`templates/`: bags, shoes, a dress, helmet, headphones, speaker, suitcase, lamp, bottle, mug, planter, watch, sunglasses, kettle, umbrella, office chair, skateboard, teddy bear, phone), and the instant fast path (`intent.ts`: "make it red", "bigger", "leather", "remove this", "make the straps black", "undo", plus camera commands like "show me the back", "zoom in", "take it apart").
- `server/`: the streaming brain (`brain.ts`). New designs: a planner call writes the root body and 5-8 part groups; each group starts its own builder call the moment it is written, so groups build in parallel. Edits: one call with the tapped part, its neighbors, the tap point, normal and mount rotation; a new part whose position was written in product space instead of its parent's frame is moved back onto its parent (`shared/frames.ts`). Template wishes: the client shows the template instantly and the planner customizes it from a per-part outline. Tool input is streamed (`eager_input_streaming`) and scanned incrementally (`jsonstream.ts`), each patch validated and forwarded as NDJSON the moment it closes. The static system prompt (rules, schema, kit catalog, templates, worked examples) is prompt-cached and pre-warmed at boot. Also the campaign state machine, Apify, Stripe and simulated payments.
- `web/`: React + react-three-fiber. `three/parts/` renders products: procedural geometry (rounded boxes, smoothed lathes, swept straps, beveled extrusions, CSG cutouts via three-bvh-csg), 31 procedural kit parts, textured `MeshPhysicalMaterial` presets (CC0 Poly Haven / ambientCG, see `web/public/textures/CREDITS.md`), spring pop-in per part with sparkle bursts, and a selection outline. `state/store.ts` holds the product with zundo undo/redo (one step per edit or per genie turn). The studio adds tap-to-select (gold outline, camera zoom to the part), the anchored genie card (colors, materials, size, move, remove, ask), a parts tree, an exploded view, real-world dimensions, `.glb` export for makers, the move/rotate/scale gizmo (`G`), keyboard undo/redo, a speculative turn on Cartesia's early end-of-turn, and `?debug` latency timings.

### Latency (measured, `npm run brain:test` and `?debug`)

| Path | Time |
| --- | --- |
| Fast-path edit ("make it red", chips, gizmo, undo, "show me the back") | instant, no network |
| Compound request ("make it red and add wheels") | the instant half lands immediately; the genie streams the rest |
| Wish that matches a template | template on screen immediately; Claude (Opus planner, given the template's part outline) streams its customizations from ~1 s, done ~1.5-7 s |
| Asking again while the genie works | instant edits apply at once; anything else is queued and runs right after |
| Edit through the genie | first patch ~1-2 s, done ~2.5-3.5 s |
| Brand-new design | first part ~1.1-1.7 s, complete ~5-6 s (planner + parallel builders) |

New designs use Opus 5.5 in fast mode: it streams ~290 tokens/s vs ~140 for Haiku 4.5 and ~120 for Sonnet 5 (measured), so it is both faster and better for long outputs. Edits use Sonnet 5 with thinking off: edit outputs are short, so its fast first token wins (first patch ~1.9 s vs ~2.4-3.9 s on Opus, whose thinking can't be disabled). Haiku 4.5 is the automatic fallback if a call fails before streaming. Models are set with `DESIGN_MODEL`, `EDIT_MODEL`, `FAST_MODE`, `FALLBACK_MODEL`.
- `actor/`: the `wish-matcher` Apify Actor. It calls three Store actors in parallel with per-store timeouts, normalizes listings, scores them all in one Claude call, and returns the top matches plus a `_meta` row. The server searches with the genie's short `searchQuery` ("electric kettle tea infuser"), not the product's invented name. After changing `actor/src`, redeploy it (`cd actor && apify push`): the server only sends inputs. See [actor/README.md](actor/README.md).
- Visual match (`server/src/visual.ts`): once the text-scored matches are on screen, one Claude call compares the wish's render with each listing's photo (downloaded server-side; photos that won't load stay unscored) and the grid re-ranks. The match % blends look (60%) and description (40%); "Best match + price" weighs that 70/30 against price. Capped by `DAILY_VISUAL_SCORES` (default 120).

### Payments: card holds as a commitment primitive

A pledge creates a PaymentIntent with `capture_method: "manual"`. It only counts once Stripe confirms the hold (`amount_capturable_updated`). When held pledges reach the target, a single SQLite transaction flips the campaign from `funding` to `capturing`, so exactly one caller runs the captures (with idempotency keys `capture-<pledgeId>`). If the deadline passes first, every hold is canceled. Campaigns are capped at 6 days to stay inside the 7-day hold window. Webhook handlers are idempotent by PaymentIntent id and status.

Test cards: `4242 4242 4242 4242` (works), `4000 0000 0000 0002` (declined), `4000 0000 0000 9995` (insufficient funds).

### Agent checkout: the genie pays as a Visa Trusted Agent Protocol agent

On the campaign view, "Genie, back it for me" lets the genie pledge for the shopper within a spending limit they set. This follows [Visa's Trusted Agent Protocol](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications) (TAP).

**How it works:**

1. The shopper's limit becomes a mandate: a cap, an expiry at the campaign deadline, and this campaign only. It is modelled on Visa Intelligent Commerce payment instructions.
2. The genie signs its checkout request with RFC 9421 HTTP Message Signatures: Ed25519, `tag="agent-payer-auth"`, covering `@authority`, `@path` and `content-digest`. The body carries an `agenticPaymentContainer` signed with the same key and nonce.
3. Wish it, as the merchant, verifies the request before placing the hold. In order: trusted-agent tag, required fields, timestamps no more than 8 minutes apart, nonce not replayed, key from the registry, body digest, signature, payment container, and the mandate.
4. Every check appears live in the trust log. The "Try to fool the merchant" buttons send an unsigned bot, a replayed request, an amount edited in flight, an expired signature, and an over-limit request. Each is refused at the step that catches it (the first four by TAP's checks, the last by the mandate), and none places a hold.

**Files:** `server/src/tap.ts` (protocol), `server/src/agent.ts` (genie and merchant), `web/src/ui/AgentCheckout.tsx` (panel).

**Tests:**

- `npm test -w server` runs the protocol tests.
- `npm run tap:demo -- --base=http://localhost:3000` checks it against a running server.

**What is real and what isn't:**

- Real: the signatures and verification are real TAP.
- Not real: Visa Intelligent Commerce (agentic tokens, payment instructions, the Visa key directory) is open to approved partners only. So:
  - the merchant looks the genie's public key up in Wish it's own registry (the same key is served at `GET /api/tap/keys?keyID=`), not in Visa's directory;
  - the mandate lives in Wish it, and the mandate check is Wish it's own step, not part of TAP.
- Whose card: the shopper only gives an email. The hold goes on a server-side test card (Stripe's `pm_card_visa`, or 4242 in the simulator). The payment container carries the mandate reference and amount, not a card credential.
- The holds themselves are Stripe test mode, or the simulated provider.

## Deploy

`render.yaml` defines one Render web service with a persistent disk for SQLite and models. Set `PUBLIC_URL` to the HTTPS URL (the mic needs HTTPS, and phones need a reachable QR link), add the keys, and register `https://<host>/api/stripe/webhook` in the Stripe dashboard for the four `payment_intent.*` events.

The maker is simulated: purchase orders go to a plausible stub maker. The payments are real card holds in Stripe test mode.
