# Step 0.2: Scaffold the monorepo and deploy hello-world

Owner: C · Phase 0 (Fri 7:30 to 9:30pm) · Do this before anything else.

## Task
Set up an npm workspaces monorepo with four packages:

- `web/`: Vite + React + TypeScript, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `socket.io-client`. One page showing "Wish it" and a spinning cube.
- `server/`: Node + Express + Socket.IO + `better-sqlite3` (TypeScript, run with `tsx`). Serves the built `web/dist` and the API from **one** process on `PORT`.
- `actor/`: empty Apify Actor skeleton (`apify` SDK, `.actor/actor.json`, `INPUT_SCHEMA.json`). Not deployed with the server.
- `shared/`: TypeScript package imported by `web` and `server`. Empty `index.ts` for now (step 0.3 fills it).

Also add:
- `.env.example` with `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `APIFY_TOKEN`, `MESHY_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_URL`, `DEMO_MODE`. `.env` is gitignored.
- `server/db.ts` that opens `data/wishit.db` and runs `CREATE TABLE IF NOT EXISTS` for the tables below.
- Root scripts: `npm run dev` (web + server concurrently, Vite proxies `/api`, `/socket.io` and `/models` to the server), `npm run build`, `npm start`.
- A socket ping: client emits `ping`, server replies `pong` with a timestamp, page shows round-trip ms.
- `render.yaml` (or Railway config) for a single web service: build `npm ci && npm run build`, start `npm start`, persistent disk mounted at `data/`.

## Data model (SQLite)
| Table | Key columns |
| --- | --- |
| wishes | id, spec_json, transcript_json, meshy_task_id, model_path, status (drafting, locked) |
| matches | wish_id, source, title, url, price, image, score, missing_json |
| campaigns | id, wish_id, price_cents, target_backers, deadline_at, status, maker_json |
| pledges | id, campaign_id, email, payment_intent_id (unique), status, created_at |
| apify_cache | query_hash, results_json, fetched_at |

## Done when
- The deployed HTTPS URL loads the page and the socket ping round-trips.
- `npm run dev` works locally from a fresh clone after `npm install`.
