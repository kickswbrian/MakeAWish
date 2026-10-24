# Step P3: Error handling

Owner: B · Phase 3.

## Task
Implement every row, then force each failure once and confirm the behavior:

| Failure | What the user sees | Behavior | How to force it |
| --- | --- | --- | --- |
| STT socket drops | "Mic reconnecting" chip | Auto-reconnect once; text box stays usable | Kill the socket in devtools |
| LLM returns invalid patch | Nothing breaks | zod drops invalid fields; reply still spoken | Inject a bad patch in a test |
| TTS fails | Reply shown as text | Continue without audio | Bad voice id |
| Meshy slow or fails | Parametric model stays | Hero swap optional; never blocks | Bad Meshy key |
| Apify timeout | "Searched 2 of 3 stores" | Partial results; cache when present | Timeout set to 1 s for one source |
| Card declined | Decline reason on pledge page | Pledge failed; bar unchanged | `4000 0000 0000 0002` |
| Duplicate webhook | Nothing | Idempotent by `payment_intent_id` + status | `stripe events resend` |
| Server restart | Nothing | SQLite state; deadline timers rebuilt on boot | Restart mid-campaign |

## Done when
Each failure above has been forced once and handled as described. Write the results in `docs/steps/P3-results.md`.
