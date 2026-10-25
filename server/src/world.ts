import { EXISTS_SCORE, isEmpty, parseProduct, type WorldItem } from "@wishit/shared";
import { db } from "./db.ts";

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

interface Row {
  id: string; product_json: string | null; thumb: string | null; created_at: number;
  best: number | null; up: number; down: number; mine: number | null; campaign_id: string | null;
}

const WORLD_SIZE = 60;

export function listWorld(voter: string | null, include: string | null): WorldItem[] {
  // Searched wishes whose best store listing wasn't "this is it", newest first, plus the asking
  // shopper's own wish even if its search hasn't finished yet.
  const rows = db.prepare(`
    SELECT w.id, w.product_json, w.thumb, w.created_at,
      (SELECT MAX(score) FROM matches m WHERE m.wish_id = w.id) AS best,
      (SELECT COUNT(*) FROM wish_votes v WHERE v.wish_id = w.id AND v.value > 0) AS up,
      (SELECT COUNT(*) FROM wish_votes v WHERE v.wish_id = w.id AND v.value < 0) AS down,
      (SELECT value FROM wish_votes v WHERE v.wish_id = w.id AND v.voter = ?) AS mine,
      (SELECT id FROM campaigns c WHERE c.wish_id = w.id ORDER BY c.created_at DESC LIMIT 1) AS campaign_id
    FROM wishes w
    WHERE w.product_json IS NOT NULL AND (w.status = 'locked' OR w.id = ?)
    ORDER BY w.created_at DESC
    LIMIT 400
  `).all(voter ?? "", include ?? "") as Row[];
  const items: WorldItem[] = [];
  for (const r of rows) {
    if (r.id !== include && r.best != null && r.best >= EXISTS_SCORE) continue;
    const product = r.product_json ? parseProduct(JSON.parse(r.product_json)) : null;
    if (!product || isEmpty(product)) continue;
    items.push({
      id: r.id,
      title: product.title,
      description: product.description ?? null,
      category: product.category ?? null,
      priceUsd: product.targetPriceUsd ?? null,
      thumb: r.thumb,
      score: r.up - r.down,
      up: r.up,
      down: r.down,
      myVote: r.mine === 1 ? 1 : r.mine === -1 ? -1 : 0,
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
  const t = db.prepare("SELECT SUM(value > 0) AS up, SUM(value < 0) AS down FROM wish_votes WHERE wish_id = ?").get(wishId) as { up: number | null; down: number | null };
  const up = t.up ?? 0, down = t.down ?? 0;
  return { score: up - down, up, down, myVote: value };
}
