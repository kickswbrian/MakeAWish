import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// apify.ts opens the database and reads env on import, so set both up first. fetch is mocked: no
// network, and each call is counted as one paid actor run.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wishit-apify-test-"));
process.env.APIFY_TOKEN = "test-token";
process.env.APIFY_ACTOR = "someone~wish-matcher";
delete process.env.DEMO_MODE;
let runs = 0;
globalThis.fetch = (async () => {
  runs++;
  await new Promise((r) => setTimeout(r, 20));
  const items = [
    { source: "etsy", title: "Convertible Midi Dress", url: "https://www.etsy.com/listing/1", price: 74, image: null, score: 62, missing: [] },
    { _meta: { searched: 3, total: 3, listings: 12, scoredBy: "llm" } },
  ];
  return new Response(JSON.stringify(items), { status: 201 });
}) as typeof fetch;
const log = console.log;
console.log = () => {};

const { findMatches, getMatches, resumePendingMatches, searchQuery, shouldCache } = await import("./apify.ts");
const { createWish } = await import("./wishes.ts");
const { db } = await import("./db.ts");

test("shouldCache keeps only complete, Claude-scored answers", () => {
  assert.equal(shouldCache(3, 15, "llm", 3, 3), true);
  assert.equal(shouldCache(0, 15, "llm", 3, 3), true, "Claude rejected real listings: a real 'nothing exists'");
  assert.equal(shouldCache(3, 15, "keywords", 3, 3), false, "keyword-scored");
  assert.equal(shouldCache(3, null, null, 3, 3), false, "old actor build without scoredBy");
  assert.equal(shouldCache(3, 15, "llm", 2, 3), false, "partial search");
  assert.equal(shouldCache(0, 0, "none", 3, 3), false, "stores came back empty-handed");
});

test("searchQuery is short and doesn't depend on feature order", () => {
  const demo = { category: "dress", color: "#1F8A5B", length: "midi", fabric: "satin", features: ["converts_to_skirt", "phone_pockets"] };
  assert.equal(searchQuery(demo as any), "emerald convertible dress");
  assert.equal(searchQuery({ ...demo, features: ["phone_pockets", "converts_to_skirt"] } as any), "emerald convertible dress");
  assert.equal(searchQuery({ ...demo, length: "mini" } as any), searchQuery(demo as any), "length isn't in the cache key");
  const a = searchQuery({ category: "top", features: ["glow_in_dark", "bamboo"] } as any);
  assert.equal(searchQuery({ category: "top", features: ["bamboo", "glow_in_dark"] } as any), a);
  assert.equal(searchQuery({ category: "generic", features: ["solar_charger", "foldable"] } as any), "foldable solar charger");
});

test("a second lock during a running search doesn't start another paid run", async () => {
  const w = createWish({ category: "dress", color: "#D7263D", features: ["phone_pockets"] } as any);
  const before = runs;
  await Promise.all([findMatches(w.id), findMatches(w.id)]);
  assert.equal(runs - before, 1);
  assert.equal(getMatches(w.id).matches.length, 1);
});

test("resumePendingMatches re-runs recent searches and closes stale ones with samples", async () => {
  const fresh = createWish({ category: "backpack", features: ["laptop_stand"] } as any);
  const stale = createWish({ category: "helmet", features: ["headphones"] } as any);
  const legacy = createWish({ category: "skirt", features: ["phone_pockets"] } as any);
  const now = Date.now();
  const pending = db.prepare("INSERT OR REPLACE INTO match_runs (wish_id, searched, total, pending, sample, started_at) VALUES (?, 0, 3, 1, 0, ?)");
  pending.run(fresh.id, now - 60_000);
  pending.run(stale.id, now - 30 * 60_000);
  pending.run(legacy.id, null); // row from before started_at existed
  const before = runs;
  resumePendingMatches(now);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(runs - before, 1, "only the recent search runs again");
  assert.equal(getMatches(fresh.id).sample, false);
  assert.equal(getMatches(fresh.id).matches.length, 1);
  for (const w of [stale, legacy]) {
    const m = getMatches(w.id);
    assert.equal(m.pending, false);
    assert.equal(m.sample, true);
  }
});

test.after(() => {
  console.log = log;
  db.close();
  try {
    fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  } catch {} // Windows can hold the WAL files briefly
});
