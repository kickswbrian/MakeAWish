import { api } from "./api.ts";

/** Start a new wish from a copy of another one and open it in the editor (keeping ?ui= and friends). */
export async function remixWish(id: string): Promise<void> {
  const src = await api.getWish(id).catch(() => null);
  if (!src) return;
  const w = await api.createWish();
  await api.saveProduct(w.id, { ...src.product, id: w.id }, src.thumb ?? undefined).catch(() => {});
  const q = new URLSearchParams(window.location.search);
  q.set("wish", w.id);
  q.delete("intro");
  window.location.assign(`/?${q}`);
}
