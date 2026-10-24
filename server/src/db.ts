import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.ts";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "wishit.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  meshy_task_id TEXT,
  model_path TEXT,
  status TEXT NOT NULL DEFAULT 'drafting',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price REAL,
  image TEXT,
  score INTEGER NOT NULL,
  missing_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS matches_wish ON matches(wish_id);
CREATE TABLE IF NOT EXISTS match_runs (
  wish_id TEXT PRIMARY KEY REFERENCES wishes(id) ON DELETE CASCADE,
  searched INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 1,
  sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id),
  price_cents INTEGER NOT NULL,
  target_backers INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'funding',
  maker_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pledges (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  fail_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pledges_campaign ON pledges(campaign_id);
CREATE TABLE IF NOT EXISTS apify_cache (
  query_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  results_json TEXT NOT NULL,
  searched INTEGER NOT NULL,
  total INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
`);

// Part-based products replaced the old fixed spec: add the new columns to existing databases.
const cols = new Set((db.prepare("PRAGMA table_info(wishes)").all() as { name: string }[]).map((c) => c.name));
if (!cols.has("product_json")) db.exec("ALTER TABLE wishes ADD COLUMN product_json TEXT");
if (!cols.has("thumb")) db.exec("ALTER TABLE wishes ADD COLUMN thumb TEXT");

// Agent checkout (Visa Trusted Agent Protocol): which pledges the genie placed, and the shopper's
// spending mandates (modelled on Visa Intelligent Commerce payment instructions).
const pledgeCols = (db.prepare("PRAGMA table_info(pledges)").all() as { name: string }[]).map((c) => c.name);
if (!pledgeCols.includes("agent_keyid")) db.exec("ALTER TABLE pledges ADD COLUMN agent_keyid TEXT");
db.exec(`CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  max_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
)`);
