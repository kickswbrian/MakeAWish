# Step B2: Design brain (`/api/wish/:id/turn`)

Owner: B · Phase 1 · Runs in parallel with A1, C1, C2. Work only in `server/`.

## Task
- `POST /api/wish` creates a wish row with `defaultSpec`, status `drafting`.
- `POST /api/wish/:id/turn` with `{ text }`:
  1. Load spec and recent transcript (last ~6 turns).
  2. Call Claude via `@anthropic-ai/sdk` with a fast model, streaming, and exactly one tool, `update_spec(patch)`, whose input schema mirrors `SpecPatch`. Keep the schema tiny.
  3. Apply the patch with `applyPatch` from `shared` (invalid fields are dropped, never fatal). As soon as the tool arguments parse, save and emit `spec:updated` `{ wishId, spec, changed }` over Socket.IO. **That happens before the response returns, so 3D updates before audio.**
  4. Return `{ say, spec, ms }` and append both sides to `transcript_json`.
- Log `transcript received → patch emitted` ms for every turn.

## System prompt
Write it for a warm, witty, brief genie:
- At most 2 short sentences per reply, at most one question, always ending with that question if there is one.
- Leans on the wish theme ("Your wish is taking shape...") without being cheesy.
- Always calls `update_spec` with whatever it can infer (category, color as hex, length, etc.), even on the first vague utterance.
- Over 2 to 3 turns, asks about size/length, color, material and the price they'd pay. Then offers: "Shall I make your wish real?"
- If the user says yes to that, return a `lock: true` flag in the response (the client calls `/lock`).
- Map color names to hex ("emerald" → `#1F8A5B`). "Shorter" or "longer" moves `length` one step.

If the LLM call fails or times out (~4 s), return a canned reply and an empty patch. Never 500.

## Done when
A script `server/scripts/brain-test.ts` runs these 5 utterances against one wish and prints valid patches and replies of 2 sentences or fewer:
1. "I want a midi dress that turns into a skirt, with pockets that actually fit my phone"
2. "emerald green, and a little shorter"
3. "satin, and I'd pay about eighty bucks"
4. "a bike helmet with built-in headphones" (new wish)
5. "yes, make it real"
