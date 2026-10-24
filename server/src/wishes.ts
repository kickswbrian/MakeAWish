import { applyPatch, defaultSpec, ProductSpec, type SpecField, type WishDTO, type WishStatus } from "@wishit/shared";
import { db } from "./db.ts";
import { newId } from "./util.ts";

export interface TranscriptTurn { role: "user" | "genie"; text: string; at: number }
interface WishRow {
  id: string; spec_json: string; transcript_json: string; meshy_task_id: string | null;
  model_path: string | null; status: WishStatus; created_at: number;
}

export interface Wish {
  id: string; spec: ProductSpec; transcript: TranscriptTurn[]; meshyTaskId: string | null;
  modelPath: string | null; status: WishStatus; createdAt: number;
}

const toWish = (r: WishRow): Wish => ({
  id: r.id,
  spec: ProductSpec.safeParse(JSON.parse(r.spec_json)).data ?? defaultSpec,
  transcript: JSON.parse(r.transcript_json),
  meshyTaskId: r.meshy_task_id,
  modelPath: r.model_path,
  status: r.status,
  createdAt: r.created_at,
});

export function createWish(spec: ProductSpec = defaultSpec): Wish {
  const id = newId();
  db.prepare("INSERT INTO wishes (id, spec_json, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify(spec), Date.now());
  return getWish(id)!;
}

export function getWish(id: string): Wish | null {
  const r = db.prepare("SELECT * FROM wishes WHERE id = ?").get(id) as WishRow | undefined;
  return r ? toWish(r) : null;
}

const HISTORY_MAX = 30;
const readHistory = (id: string): ProductSpec[] => {
  const r = db.prepare("SELECT history_json FROM wishes WHERE id = ?").get(id) as { history_json: string | null } | undefined;
  return r?.history_json ? JSON.parse(r.history_json) : [];
};

export function patchWish(id: string, patch: unknown): { spec: ProductSpec; changed: SpecField[]; dropped: string[] } {
  const w = getWish(id);
  if (!w) throw new Error("wish not found");
  const res = applyPatch(w.spec, patch);
  if (res.changed.length) {
    // Every change is undoable: keep the spec it replaced.
    const history = [...readHistory(id), w.spec].slice(-HISTORY_MAX);
    db.prepare("UPDATE wishes SET spec_json = ?, history_json = ? WHERE id = ?").run(JSON.stringify(res.spec), JSON.stringify(history), id);
  }
  return res;
}

/** Restore the spec before the last change. Returns the fields that changed (empty if nothing to undo). */
export function undoWish(id: string): { spec: ProductSpec; changed: SpecField[] } {
  const w = getWish(id);
  if (!w) throw new Error("wish not found");
  const history = readHistory(id);
  const prev = history.pop();
  if (!prev) return { spec: w.spec, changed: [] };
  const spec = ProductSpec.safeParse(prev).data ?? w.spec;
  const keys = new Set([...Object.keys(w.spec), ...Object.keys(spec)]) as Set<SpecField>;
  const changed = [...keys].filter((k) => JSON.stringify(w.spec[k]) !== JSON.stringify(spec[k]));
  db.prepare("UPDATE wishes SET spec_json = ?, history_json = ? WHERE id = ?").run(JSON.stringify(spec), JSON.stringify(history), id);
  return { spec, changed };
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

export function setWishModel(id: string, modelPath: string | null, taskId?: string | null) {
  db.prepare("UPDATE wishes SET model_path = COALESCE(?, model_path), meshy_task_id = COALESCE(?, meshy_task_id) WHERE id = ?").run(modelPath, taskId ?? null, id);
}

export const modelUrlFor = (w: Wish) => (w.modelPath ? `/models/${w.modelPath}` : null);

export function toWishDTO(w: Wish): WishDTO {
  const c = db.prepare("SELECT id FROM campaigns WHERE wish_id = ? ORDER BY created_at DESC LIMIT 1").get(w.id) as { id: string } | undefined;
  return { id: w.id, spec: w.spec, status: w.status, modelUrl: modelUrlFor(w), campaignId: c?.id ?? null };
}
