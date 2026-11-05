import { emptyProduct, parseProduct, type Product, type WishDTO, type WishStatus } from "@wishit/shared";
import { db } from "./db.ts";
import { newId } from "./util.ts";

/**
 * `adds`: a shopper turn that added parts (a feature like "add Sonic to it"), not a tweak.
 * `fresh`: it started a new design (the first wish, or "actually, make me a lamp").
 */
export interface TranscriptTurn { role: "user" | "genie"; text: string; at: number; adds?: boolean; fresh?: boolean }
interface WishRow {
  id: string; product_json: string | null; transcript_json: string; thumb: string | null;
  status: WishStatus; created_at: number;
}

export interface Wish {
  id: string; product: Product; transcript: TranscriptTurn[]; thumb: string | null; status: WishStatus; createdAt: number;
}

const toWish = (r: WishRow): Wish => ({
  id: r.id,
  product: (r.product_json && parseProduct(JSON.parse(r.product_json))) || emptyProduct(r.id),
  transcript: JSON.parse(r.transcript_json),
  thumb: r.thumb,
  status: r.status,
  createdAt: r.created_at,
});

export function createWish(product?: Product): Wish {
  const id = newId();
  const p = product ? { ...product, id } : emptyProduct(id);
  db.prepare("INSERT INTO wishes (id, spec_json, product_json, created_at) VALUES (?, '{}', ?, ?)").run(id, JSON.stringify(p), Date.now());
  return getWish(id)!;
}

export function getWish(id: string): Wish | null {
  const r = db.prepare("SELECT * FROM wishes WHERE id = ?").get(id) as WishRow | undefined;
  return r ? toWish(r) : null;
}

export function saveProduct(id: string, product: Product) {
  db.prepare("UPDATE wishes SET product_json = ? WHERE id = ?").run(JSON.stringify({ ...product, id }), id);
}

/** Small data-URL snapshot for lists and campaign pages. */
export function saveThumb(id: string, thumb: string) {
  db.prepare("UPDATE wishes SET thumb = ? WHERE id = ?").run(thumb, id);
}

export function appendTranscript(id: string, turns: TranscriptTurn[]) {
  const w = getWish(id);
  if (!w) return;
  const all = [...w.transcript, ...turns].slice(-40);
  db.prepare("UPDATE wishes SET transcript_json = ? WHERE id = ?").run(JSON.stringify(all), id);
}

export function setWishStatus(id: string, status: WishStatus) {
  db.prepare("UPDATE wishes SET status = ? WHERE id = ?").run(status, id);
}

export function toWishDTO(w: Wish): WishDTO {
  const c = db.prepare("SELECT id FROM campaigns WHERE wish_id = ? ORDER BY created_at DESC LIMIT 1").get(w.id) as { id: string } | undefined;
  return { id: w.id, product: w.product, status: w.status, thumb: w.thumb, campaignId: c?.id ?? null };
}
