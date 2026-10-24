import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MODELS_DIR } from "./env.ts";

fs.mkdirSync(MODELS_DIR, { recursive: true });

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
CREATE TABLE IF NOT EXISTS meshy_cache (
  prompt_hash TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  file TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
