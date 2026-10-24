import { createHash } from "node:crypto";
import type { ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { SYSTEM, type BrainResult } from "./brain.ts";

/**
 * Claude turns, cached by (spec, utterance, how far into the chat, prompt version). A line
 * rehearsed before the demo comes back instantly and identically on stage. Only real LLM answers
 * are stored; a turn that fell back to the rule brain is not.
 */
db.exec(`CREATE TABLE IF NOT EXISTS brain_cache (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

const TTL_MS = 7 * 24 * 3600_000;
const PROMPT = createHash("sha256").update(SYSTEM).digest("hex").slice(0, 12);

const keyFor = (spec: ProductSpec, text: string, genieTurns: number) =>
  createHash("sha256")
    .update(JSON.stringify({ spec, text: text.toLowerCase().replace(/[^a-z0-9$#' ]+/g, " ").replace(/\s+/g, " ").trim(), genieTurns, model: env.brainModel, prompt: PROMPT }))
    .digest("hex");

export function cachedTurn(spec: ProductSpec, text: string, genieTurns: number): BrainResult | null {
  const row = db.prepare("SELECT result_json, created_at FROM brain_cache WHERE key = ?").get(keyFor(spec, text, genieTurns)) as
    | { result_json: string; created_at: number } | undefined;
  if (!row || (!env.demoMode && Date.now() - row.created_at > TTL_MS)) return null;
  return JSON.parse(row.result_json) as BrainResult;
}

export function storeTurn(spec: ProductSpec, text: string, genieTurns: number, result: BrainResult) {
  if (result.brain !== "llm") return;
  db.prepare("INSERT OR REPLACE INTO brain_cache (key, result_json, created_at) VALUES (?, ?, ?)")
    .run(keyFor(spec, text, genieTurns), JSON.stringify(result), Date.now());
}
