import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProduct } from "@wishit/shared";
import { db } from "../src/db.ts";
import "../src/world.ts"; // creates the wish_votes table

/**
 * Seeds the Wish World with demo wishes (real genie-built products with their thumbnails, from
 * server/seed/world.json) and demo vote counts. Safe to run again: the seeded wishes keep fixed ids and
 * their seeded votes are replaced, so real votes from visitors stay.
 *
 *   npm run world:seed
 */
interface Seed { key: string; up: number; down: number; thumb: string; product: unknown }

const here = path.dirname(fileURLToPath(import.meta.url));
const seeds = JSON.parse(fs.readFileSync(path.join(here, "..", "seed", "world.json"), "utf8")) as Seed[];

const upsertWish = db.prepare(`
  INSERT INTO wishes (id, spec_json, product_json, thumb, status, created_at) VALUES (?, '{}', ?, ?, 'locked', ?)
  ON CONFLICT(id) DO UPDATE SET product_json = excluded.product_json, thumb = excluded.thumb, status = 'locked'`);
const clearVotes = db.prepare("DELETE FROM wish_votes WHERE wish_id = ? AND voter LIKE 'seed-%'");
const addVote = db.prepare("INSERT OR REPLACE INTO wish_votes (wish_id, voter, value, created_at) VALUES (?, ?, ?, ?)");

const now = Date.now();
db.transaction(() => {
  seeds.forEach((s, i) => {
    const id = `world-${s.key}`;
    const product = parseProduct({ ...(s.product as object), id });
    if (!product) throw new Error(`${s.key}: not a valid product`);
    // Spread over the past few weeks, so "newest" ordering looks natural.
    upsertWish.run(id, JSON.stringify(product), s.thumb, now - (i + 1) * 36 * 3600_000);
    clearVotes.run(id);
    for (let n = 0; n < s.up; n++) addVote.run(id, `seed-${n}`, 1, now);
    for (let n = 0; n < s.down; n++) addVote.run(id, `seed-d${n}`, -1, now);
  });
})();
console.log(`[world] seeded ${seeds.length} wishes with demo votes`);
