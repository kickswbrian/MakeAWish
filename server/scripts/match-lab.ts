/**
 * Match lab: fetch real store listings for a few test wishes ONCE (Apify costs money), then replay
 * them offline to compare scoring and ranking.
 *   npm run match:lab -w server                 # fetch any wish without a saved file, then score
 *   MODE=score WISHES=mug,dress npm run match:lab -w server   # offline: score saved listings only
 * Files: $LAB_DIR (default $CLAUDE_JOB_DIR/tmp/matchlab, else data/matchlab)/<wish>.json.
 * "before" = the old pipeline (the genie's one query, 5 per store, title-only scoring);
 * "after"  = planned queries + photo scoring, as the server now runs it.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { planSearch, pickListings, scoreListings, searchStore, STORE_NAMES, normalize, type Listing, type Wanted, type SearchPlan } from "../src/stores.ts";
import { DATA_DIR, env } from "../src/env.ts";

const WISHES: Record<string, Wanted & { query: string }> = {
  backpack: { name: "Stand-Up Laptop Backpack", category: "backpack", description: "A laptop backpack with a fold-out laptop stand built into its back panel.", query: "backpack laptop stand" },
  dress: { name: "Skirt-Switch Dress", category: "dress", description: "A dress whose top unzips so it turns into a skirt.", query: "convertible dress skirt" },
  jetshoes: { name: "Jet Sneakers", category: "sneakers", description: "Sneakers with jet propulsion thrusters in the heels.", query: "jet propulsion shoes" },
  dogbed: { name: "Canopy Warm Den", category: "dog bed", description: "A heated dog bed with a fabric canopy roof.", query: "heated dog bed canopy" },
  mug: { name: "Perfect Temp Mug", category: "mug", description: "A smart coffee mug that keeps coffee at the exact temperature you set.", query: "temperature control coffee mug" },
  birdhouse: { name: "Bird Cam House", category: "birdhouse", description: "A wooden birdhouse with a built-in camera to watch nesting birds.", query: "birdhouse camera" },
};

const LAB = process.env.LAB_DIR ?? (process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, "tmp", "matchlab") : path.join(DATA_DIR, "matchlab"));
fs.mkdirSync(LAB, { recursive: true });
const MAX = 5;
const only = (process.env.WISHES ?? "").split(",").filter(Boolean);
const names = only.length ? only : Object.keys(WISHES);

interface Saved { wish: Wanted; plan: SearchPlan; queries: string[]; raw: Record<string, any[]>; ms: Record<string, number>; usd: number }

async function fetchWish(name: string): Promise<Saved> {
  const wish = WISHES[name];
  const plan = await planSearch(wish);
  // The baseline query rides along in the same runs, so "before" is the same listings minus the plan.
  const queries = [...new Set([wish.query, ...plan.queries])];
  const raw: Record<string, any[]> = {}, ms: Record<string, number> = {};
  let usd = 0;
  await Promise.all(STORE_NAMES.map(async (s) => {
    const t0 = Date.now();
    try {
      const r = await searchStore(s, queries, MAX, 60);
      raw[s] = r.raw;
      usd += r.usd;
    } catch (err) {
      console.warn(`${name} ${s}: ${(err as Error).message}`);
      raw[s] = [];
    }
    ms[s] = Date.now() - t0;
  }));
  const saved = { wish, plan, queries, raw, ms, usd };
  fs.writeFileSync(path.join(LAB, `${name}.json`), JSON.stringify(saved, null, 1));
  return saved;
}

/** The old scorer (title + price only, one generic query), kept here for the comparison. */
const client = new Anthropic({ maxRetries: 1 });
async function oldScore(wish: Wanted, listings: Listing[]) {
  const lines = listings.map((l, i) => `${i}. [${l.source}] ${l.title}${l.price != null ? ` ($${l.price})` : ""}`).join("\n");
  const spec = { name: wish.name, category: wish.category, features: [], notes: wish.description };
  const res = await client.messages.create({
    model: env.editModel,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    messages: [{
      role: "user",
      content:
        `A shopper is looking for this product:\n"${wish.query}"\nStructured spec: ${JSON.stringify(spec)}\n\n` +
        `Score each store listing below from 0 to 100 for how well it IS that product (80+ = this is it, 50-79 = close but missing something, under 50 = not it). ` +
        `For each, list the wanted things it lacks as short noun phrases. Judge only from the title and price.\n\n${lines}\n\n` +
        `Reply with JSON only: {"results":[{"index":0,"score":0,"missing":["..."]}]}`,
    }],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { results: { index: number; score: number; missing: string[] }[] };
  return listings
    .map((l, i) => ({ ...l, score: parsed.results.find((r) => r.index === i)?.score ?? 0, missing: parsed.results.find((r) => r.index === i)?.missing ?? [] }))
    .sort((a, b) => b.score - a.score);
}

const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const line = (m: { score: number; source: string; title: string; price: number | null; why?: string; rating?: number | null; reviews?: number | null }) =>
  `    ${String(m.score).padStart(3)}  ${m.source === "amazon" ? "AMZ" : "GGL"}  ${short(m.title)}${m.price != null ? `  $${m.price}` : ""}${m.rating ? `  ${m.rating}★/${m.reviews ?? 0}` : ""}${m.why ? `\n           ↳ ${m.why}` : ""}`;

if (process.env.MODE === "plan") {
  await Promise.all(names.map(async (n) => {
    const t0 = Date.now();
    const p = await planSearch(WISHES[n]);
    console.log(`${n} (${Date.now() - t0}ms, $${p.usd.toFixed(4)}): exists=${p.exists} sold_as=${p.soldAs ?? "-"}\n   ${p.queries.join(" | ")}\n   must: ${p.mustHave.join(", ")}`);
  }));
  process.exit(0);
}

for (const name of names) {
  const file = path.join(LAB, `${name}.json`);
  let saved: Saved;
  if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, "utf8"));
  else if (process.env.MODE === "score") { console.log(`${name}: no saved listings`); continue; }
  else saved = await fetchWish(name);
  // REPLAN=1: plan again (new must-haves) against the same saved listings.
  if (process.env.REPLAN === "1") saved.plan = await planSearch(WISHES[name]);
  const all = STORE_NAMES.flatMap((s) => (saved.raw[s] ?? []).map((i) => normalize(s, i)).filter((l): l is Listing => !!l));
  const base = saved.wish.query!;
  const fromBase = all.filter((l) => l.query === base);
  const queryOf = new Map(all.map((l) => [l.url, l.query]));
  console.log(`\n=== ${name}: "${saved.wish.description}"`);
  console.log(`  plan: exists=${saved.plan.exists} sold_as=${saved.plan.soldAs ?? "-"} queries=${saved.plan.queries.join(" | ")} must=${saved.plan.mustHave.join(", ")}`);
  console.log(`  fetched ${all.length} listings (${STORE_NAMES.map((s) => `${s} ${saved.raw[s]?.length ?? 0} in ${saved.ms[s]}ms`).join(", ")}), apify ~$${saved.usd.toFixed(3)}; baseline-query listings ${fromBase.length}`);

  if (process.env.SKIP_BEFORE !== "1") {
    const before = STORE_NAMES.flatMap((s) => fromBase.filter((l) => l.source === s).slice(0, MAX));
    if (before.length) {
      const scored = await oldScore(saved.wish, before);
      console.log(`  BEFORE ("${base}", title-only):`);
      for (const m of scored.slice(0, 3)) console.log(line(m));
    }
  }
  const t0 = Date.now();
  // As the server picks them: per store, round-robin over the plan's queries, minus repeats.
  const seen: Listing[] = [];
  const listings = STORE_NAMES.flatMap((s) => pickListings(saved.queries, all.filter((l) => l.source === s), seen));
  const after = await scoreListings(saved.wish, saved.plan, listings);
  console.log(`  AFTER (${listings.length} listings, scored in ${Date.now() - t0}ms, claude ~$${(after.usd + saved.plan.usd).toFixed(4)}):`);
  for (const m of after.matches.slice(0, Number(process.env.TOP ?? 3))) console.log(line(m) + `  [q: ${queryOf.get(m.url) ?? "?"}]`);
}
