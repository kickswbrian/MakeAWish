# Design notes

How Wish it came together over the weekend: the calls we made, the parts we're proud of, and what broke along the way. For what the app does and how to run it, see the [README](../README.md). The original plan is in [build-plan.md](build-plan.md).

## How we worked

- **Plan first, then one loop that always works.** Aarnav's [build plan](build-plan.md) fixed the core loop before any code: speak a wish, watch it change in 3D, check whether it exists, launch a campaign, pledge with a card hold. Everything else was optional. Step specs in [`steps/`](steps) split the work so the three of us could build in parallel against one shared contract (`shared/`).
- **Small PRs, merged often.** We worked on feature branches with lots of small PRs. Before merging, we pulled main and kept the other person's version wherever our changes overlapped.
- **Reproduce with the real thing.** Most bugs were reproduced by scripts that drive the real genie or the real studio, not by mocks:
  - `npm run brain:test` replays scripted wishes and edits;
  - `npm run collide:lab` replays geometry cases;
  - `match-lab` replays store searches;
  - a headless Chrome harness takes screenshots of the UI.
- **Audit every batch.** After each batch of changes, a fresh reviewer read the diff for anything that could break the live demo. We checked each finding against the code before fixing it, and some turned out wrong.

## Decisions that shaped it

| Decision | Why |
| --- | --- |
| **Products are parts, not meshes.** A product is a flat map of typed parts with parent links. Every change is a validated `add` / `update` / `remove` patch. | One `applyPatches` runs on both client and server. Undo comes free, Claude's output can be checked part by part, and edits stream in one patch at a time. This replaced the first design (one big `ProductSpec` plus a text-to-3D model in the background), which couldn't take "add a pocket here". |
| **Instant first, smart second.** A local classifier and style compiler put a full design on screen before Claude is called. | The screen is never blank. Claude refines a design that already exists instead of starting from nothing. |
| **Claude over a keyword parser for edits.** | On blind test sets, Claude handled about 97% of edits. The rule-based parser handled 77%, then fell to 52% on harder phrasing. Patching the parser to cover misses barely generalized, so it became the offline fallback only. |
| **Pick models by measured speed.** Opus 5.5 fast mode designs, Sonnet 5 edits. | Opus streams about 290 tokens/s, so it wins on long designs. Sonnet's quicker first token wins on short edits. |
| **Search the stores while the genie is still designing.** | Brian cut the match search from about 38 s to about 15 s, then started it early so "See matches" shows results in under 5 s. |
| **Visa Trusted Agent Protocol, honestly labeled.** | Visa Intelligent Commerce and the rest of Visa's agent stack need partner approval. TAP is the piece anyone can implement. So the signatures and merchant checks are real, the orders are test mode, and we never claim Visa approval. |
| **Buy without leaving the app.** | One tap on a match card: the genie signs a checkout under a one-listing, ten-minute mandate, and the card says "Purchased!" in place. The order shows up in Your purchases, with no redirect. |
| **Wish World shows idea collisions, not catalog items.** | A field of plain mugs and couches doesn't make anyone say "wow". The 29 seed wishes were built by the genie through the real studio: a double-decker couch, a skateboard with jet engines, a turtle robot vacuum, a teapot shaped like a hot-air balloon. |

## Things we're proud of

- **Streaming tool calls, patch by patch.** Tool input streams with `eager_input_streaming`. A JSON scanner pulls out each patch the moment its object closes, and the part pops in. New designs fan out: a planner writes part groups, and parallel builders start on each group as soon as it is written.
- **Aesthetic words mean something.** "Coquette", "grunge", "old money" and "cute" each compile to fabrics, palettes, hardware and things to avoid (`shared/fashion/styles.json`). For "cute", we pinned the style to what women around 20 to 45 actually save on Pinterest, so it doesn't drift into "seductive".
- **Garments that keep their details.** Real CC-BY scans are split into pattern pieces in headless Blender. Length, fit and taper deformers run per vertex, so pockets and stitching stay attached as the shape changes.
- **The v2 experience.** A "Want it? Wish it." intro, a real 3D glass bubble, and type-anywhere input. The bubble flies into the matches, and a faint planet in the corner opens the Wish World.
- **Collision sense.** The genie gets told when a bunk's upper deck cuts through the cushions below or hovers above its posts. It repairs that in one extra call, and geometry fixes whatever is left (see below).

## Failures we got past

- **The upper deck went through the couch.** "Make it a double decker" put the deck right through the lower back cushions. "Raise the second deck" could leave it floating above its posts. Our floating check only caught parts touching *nothing*, and the deck still touched the back frame.
  - *Fix:* "levels" (big flat parts like decks, shelves and tabletops) must clear what's under them and be held up. Edits that newly push similar-sized parts into each other are flagged too.
  - The issues go to one repair call, then the code lifts the level clear or stretches its posts to meet it.
  - Before shipping, we scanned all 54 templates and the 29 seeds: no false alarms.
- **It couldn't draw.** An "eagle buckle" came out as a few-point polygon that read as a star. The only way to draw was hand-placed point lists. Extrudes now take an SVG path, which Claude writes well, so emblems and silhouettes look like what was asked for.
- **Sonic came out as a blue teddy bear.** The word "plush" locked every plush wish into the teddy template, and the genie only recolored it. Catch-all words now pick the teddy only when nothing else is named.
- **The pull-cord bird ended up against the bulb.** The genie hangs things "down" in the frame of the part they hang from, so under a tilted lamp shade the cord went sideways. New cords under tilted parts are now re-hung straight down, with the charm upright below.
- **The planner ran out of room.** "A double decker couch" sometimes came back with no genie reply. Customizing the big sofa template overran the planner's 3,000-token budget, and the reply is written last. We doubled the budget and added a fallback line.
- **"Double decker couch" matched a regular couch.** The search planner rewrote the wish into generic queries, which lost the one word that mattered. Now the shopper's own phrase is always the first query, and results wait for it. It finds real bunk couches.
- **Search-ahead quietly spent the budget.** Every settled design ran a paid store search. Bulk-building the demo wishes used 164 searches against a cap of 60. Past the cap, the app quietly serves sample matches, which looked like "Apify is down".
  - *Fix:* search keys now describe *what* the product is, not each added part.
  - Scripted runs use `SEARCH_AHEAD=0`.
- **The match scorer never ran.** The Actor passed a zod v3 schema to an SDK helper that needs zod v4, so Claude scoring silently didn't happen.
- **The glass bubble had a white disc in it.** The bloom/AO post-processing made the transparent canvas opaque. The intro also ran at about 1 fps for its first seconds until we fixed how the scene loads.
- **CSS and id collisions.** A `.world` class on wishlist cards took over the full-screen Wish World. Seeded wish ids with hyphens failed the id check. A stale timer could reveal the next card's 3D model early.
- **A style that silently disappeared.** The "cute" style's vibe ran past the 220-character limit, so the style was dropped with no error. Only two tests caught it. A bare `top` keyword then hijacked "a spinning top toy" and "a desk with a top shelf". We switched to specific phrases.
- **A dead server that looked like a frontend bug.** During a merge, files briefly had conflict markers and the dev server crashed while Vite kept running. The result was "Searching…" stuck forever and Purchase returning a 500. A restart fixed it, and now we check the server first.
- **No disk on the free plan.** Render's free tier resets SQLite on every deploy, so the Wish World reseeds itself on startup when it's empty.

## If we kept going

- Collision sense only sees boxes. A couch "double-decker" made by raising the lower seat cushions still gets past it, because single cushions are too small to count as a level.
- A real maker network and real Visa Intelligent Commerce tokens once partner access comes through.
- Holds for campaigns longer than 6 days: save the card now and place the hold in the final 6 days.
