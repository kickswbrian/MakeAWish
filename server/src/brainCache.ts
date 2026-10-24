import { createHash } from "node:crypto";
import type { ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { SYSTEM, tool, type BrainResult } from "./brain.ts";

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
const OFF = process.env.BRAIN_CACHE === "0";
// The prompt and the tool schema both shape the reply: changing either starts a fresh cache.
const PROMPT = createHash("sha256").update(SYSTEM).update(JSON.stringify(tool.input_schema)).digest("hex").slice(0, 12);

// Rows older than a week are dead weight (DEMO_MODE keeps rehearsed lines forever, by design).
if (!env.demoMode) db.prepare("DELETE FROM brain_cache WHERE created_at < ?").run(Date.now() - TTL_MS);
// CLEAR_GENIE_CACHE=1 wipes it on boot, e.g. after a bad rehearsal answer.
if (process.env.CLEAR_GENIE_CACHE === "1") db.exec("DELETE FROM brain_cache");

/**
 * Key: the spec, the utterance (case, emoji and every script kept; only spacing and punctuation
 * normalized), how far into the chat, the genie's last line (so "yes" to "Shall I make your wish
 * real?" isn't replayed after a different question), the model and the prompt version.
 */
const keyFor = (spec: ProductSpec, text: string, genieTurns: number, lastGenie: string) =>
  createHash("sha256")
    .update(JSON.stringify({
      spec,
      text: text.normalize("NFC").replace(/[^\p{L}\p{N}\p{Extended_Pictographic}$#' ]+/gu, " ").replace(/\s+/g, " ").trim(),
      genieTurns, lastGenie, model: env.brainModel, prompt: PROMPT,
    }))
    .digest("hex");

export function cachedTurn(spec: ProductSpec, text: string, genieTurns: number, lastGenie = ""): BrainResult | null {
  if (OFF) return null;
  const row = db.prepare("SELECT result_json, created_at FROM brain_cache WHERE key = ?").get(keyFor(spec, text, genieTurns, lastGenie)) as
    | { result_json: string; created_at: number } | undefined;
  if (!row || (!env.demoMode && Date.now() - row.created_at > TTL_MS)) return null;
  return JSON.parse(row.result_json) as BrainResult;
}

export function storeTurn(spec: ProductSpec, text: string, genieTurns: number, result: BrainResult, lastGenie = "") {
  if (OFF || result.brain !== "llm") return;
  db.prepare("INSERT OR REPLACE INTO brain_cache (key, result_json, created_at) VALUES (?, ?, ?)")
    .run(keyFor(spec, text, genieTurns, lastGenie), JSON.stringify(result), Date.now());
}
