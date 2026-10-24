# Step prompts

Each file is one prompt for Claude Code, cut from [../build-plan.md](../build-plan.md). Give Claude Code one file at a time. Parallel steps run on their own branch or worktree and merge through `main`. Commit after each step passes its "Done when" test.

Rules for every step:
- `shared/spec.ts` is the contract. If a step needs to change it, change it on `main` first and tell the team.
- API keys stay on the server, read from `.env`. Browsers only get short-lived tokens (Cartesia) or publishable keys (Stripe).
- Don't build anything listed under the plan's non-goals.

| File | Step | Owner | Phase | Needs first |
| --- | --- | --- | --- | --- |
| [01-scaffold.md](01-scaffold.md) | 0.2 Monorepo + deploy | C | 0 | keys (0.1) |
| [02-shared-spec.md](02-shared-spec.md) | 0.3 Shared types | B | 0 | 01 |
| [A1-parametric-3d.md](A1-parametric-3d.md) | Parametric 3D + effects | A | 1 | 02 |
| [B1-voice-client.md](B1-voice-client.md) | Cartesia voice loop | B | 1 | 02 |
| [B2-design-brain.md](B2-design-brain.md) | LLM `update_spec` turn | B | 1 | 02 |
| [C1-payments.md](C1-payments.md) | Stripe holds, capture, release | C | 1 | 02 |
| [C2-apify-actor.md](C2-apify-actor.md) | `wish-matcher` Actor + cache | D | 1 | 02 |
| [I1-voice-to-3d.md](I1-voice-to-3d.md) | Voice turns drive 3D | A + B | 2 | A1, B1, B2 |
| [I2-lock-flow.md](I2-lock-flow.md) | Lock, Meshy, match cards | A + C | 2 | A1, C2 |
| [I3-campaign-board.md](I3-campaign-board.md) | Campaign, QR, demand bar | A + C | 2 | C1 |
| [I4-purchase-order.md](I4-purchase-order.md) | Funded order screen | C | 2 | C1, C2 |
| [P1-ui-polish.md](P1-ui-polish.md) | Polish | A | 3 | flow works |
| [P2-demo-seed.md](P2-demo-seed.md) | Demo reset script | C | 3 | flow works |
| [P3-error-handling.md](P3-error-handling.md) | Error table | B | 3 | flow works |
| [P4-stretch.md](P4-stretch.md) | Stretch | anyone | 3 | P1 to P3 |

Gates: full flow works on the deployed URL by **Sat 3:00pm**. Feature freeze **Sat 10:00pm**. Submit by **Sun 8:30am**.
