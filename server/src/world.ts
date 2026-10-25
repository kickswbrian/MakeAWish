import { EXISTS_SCORE, type WorldItem } from "@wishit/shared";
import { db } from "./db.ts";
import { hash } from "./util.ts";

/**
 * The wish world: past wishes that were searched and turned out not to exist yet, as floating bubbles
 * people can up- or downvote (one vote per browser, which they can change or take back).
 */

db.exec(`CREATE TABLE IF NOT EXISTS wish_votes (
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wish_id, voter)
)`);

db.exec("CREATE INDEX IF NOT EXISTS wish_votes_voter ON wish_votes(voter)");
db.exec("CREATE INDEX IF NOT EXISTS campaigns_wish ON campaigns(wish_id)");

interface Row {
  id: string; product_json: string | null; thumb_tail: string | null; created_at: number;
  best: number | null; up: number; down: number; campaign_id: string | null;
}

const WORLD_SIZE = 120;

/**
 * The list is the same for everyone but your own votes, and building it reads every wish: keep it for
 * a few seconds (votes clear it), and add each voter's own votes on top.
 */
const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; items: WorldItem[] }>();
export const clearWorldCache = () => cache.clear();

export function listWorld(voter: string | null, include: string | null): WorldItem[] {
  const key = include ?? "";
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    hit = { at: Date.now(), items: buildWorld(include) };
    cache.set(key, hit);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
  }
  const mine = new Map(
    voter ? (db.prepare("SELECT wish_id, value FROM wish_votes WHERE voter = ?").all(voter) as { wish_id: string; value: number }[]).map((v) => [v.wish_id, v.value]) : [],
  );
  return hit.items.map((it) => {
    const v = mine.get(it.id);
    return { ...it, myVote: v === 1 ? 1 : v === -1 ? -1 : 0 };
  });
}

function buildWorld(include: string | null): WorldItem[] {
  // Searched wishes whose best store listing wasn't "this is it", newest first, plus the asking
  // shopper's own wish even if its search hasn't finished yet.
  const rows = db.prepare(`
    SELECT w.id, w.product_json, CASE WHEN w.thumb IS NULL THEN NULL ELSE length(w.thumb) || substr(w.thumb, length(w.thumb) / 2, 24) END AS thumb_tail, w.created_at,
      (SELECT MAX(score) FROM matches m WHERE m.wish_id = w.id) AS best,
      (SELECT COUNT(*) FROM wish_votes v WHERE v.wish_id = w.id AND v.value > 0) AS up,
      (SELECT COUNT(*) FROM wish_votes v WHERE v.wish_id = w.id AND v.value < 0) AS down,
      (SELECT id FROM campaigns c WHERE c.wish_id = w.id ORDER BY c.created_at DESC LIMIT 1) AS campaign_id
    FROM wishes w
    WHERE w.product_json IS NOT NULL AND (w.status = 'locked' OR w.id = ?) AND (w.thumb IS NOT NULL OR w.id = ?)
    ORDER BY w.created_at DESC
    LIMIT 400
  `).all(include ?? "", include ?? "") as Row[];
  const items: WorldItem[] = [];
  for (const r of rows) {
    if (r.id !== include && r.best != null && r.best >= EXISTS_SCORE) continue;
    // Only the few fields the bubbles show: no full validation of every product on every request.
    let product: { title?: unknown; description?: unknown; category?: unknown; targetPriceUsd?: unknown; rootId?: unknown; parts?: Record<string, { material?: { color?: unknown } }> };
    try {
      product = JSON.parse(r.product_json ?? "null") ?? {};
    } catch {
      continue;
    }
    const parts = product.parts && typeof product.parts === "object" ? product.parts : {};
    if (!Object.keys(parts).length || typeof product.title !== "string") continue;
    const color = typeof product.rootId === "string" ? parts[product.rootId]?.material?.color : undefined;
    items.push({
      id: r.id,
      title: product.title,
      description: typeof product.description === "string" ? product.description : null,
      category: typeof product.category === "string" ? product.category : null,
      priceUsd: typeof product.targetPriceUsd === "number" ? product.targetPriceUsd : null,
      // A cacheable image link (versioned by the picture's own bytes), not the picture inlined.
      thumb: r.thumb_tail ? `/api/wish/${r.id}/thumb?v=${hash(r.thumb_tail).slice(0, 10)}` : null,
      color: typeof color === "string" ? color : null,
      score: r.up - r.down,
      up: r.up,
      down: r.down,
      myVote: 0,
      campaignId: r.campaign_id,
      createdAt: r.created_at,
    });
  }
  // The same idea wished several times only floats once (the most voted, else the newest).
  const seen = new Map<string, WorldItem>();
  for (const it of items) {
    const key = it.title.trim().toLowerCase();
    const prev = seen.get(key);
    if (!prev || it.id === include || (prev.id !== include && it.score > prev.score)) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt).slice(0, WORLD_SIZE);
}

/** Up (1), down (-1) or take back (0) one voter's vote. Returns the wish's new tally. */
export function voteWish(wishId: string, voter: string, value: -1 | 0 | 1): { score: number; up: number; down: number; myVote: -1 | 0 | 1 } | null {
  if (!db.prepare("SELECT 1 FROM wishes WHERE id = ?").get(wishId)) return null;
  if (value === 0) db.prepare("DELETE FROM wish_votes WHERE wish_id = ? AND voter = ?").run(wishId, voter);
  else {
    db.prepare("INSERT INTO wish_votes (wish_id, voter, value, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(wish_id, voter) DO UPDATE SET value = excluded.value")
      .run(wishId, voter, value, Date.now());
  }
  clearWorldCache();
  const t = db.prepare("SELECT SUM(value > 0) AS up, SUM(value < 0) AS down FROM wish_votes WHERE wish_id = ?").get(wishId) as { up: number | null; down: number | null };
  const up = t.up ?? 0, down = t.down ?? 0;
  return { score: up - down, up, down, myVote: value };
}
