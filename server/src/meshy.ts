import fs from "node:fs";
import path from "node:path";
import { describeSpec, EVENTS, type ProductSpec } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { spend } from "./security.ts";
import { env, MODELS_DIR } from "./env.ts";
import { hash, sleep } from "./util.ts";
import { getWish, setWishModel } from "./wishes.ts";

const API = "https://api.meshy.ai/openapi/v2/text-to-3d";

export function meshyPrompt(spec: ProductSpec): string {
  const bits = [describeSpec(spec)];
  if (spec.silhouette) bits.push(`${spec.silhouette.replace("_", "-")} silhouette`);
  if (spec.sleeves && spec.sleeves !== "none") bits.push(`${spec.sleeves} sleeves`);
  if (spec.sleeves === "none") bits.push("sleeveless");
  if (spec.neckline) bits.push(`${spec.neckline} neckline`);
  if (spec.pattern && spec.pattern !== "solid") bits.push(`${spec.pattern} pattern`);
  const extra = (spec.features ?? []).filter((f) => !["phone_pockets", "converts_to_skirt", "laptop_stand", "headphones"].includes(f));
  if (extra.length) bits.push(extra.map((f) => f.replace(/_/g, " ")).join(", "));
  if (spec.notes) bits.push(spec.notes);
  const isClothing = ["dress", "top", "skirt"].includes(spec.category);
  bits.push(isClothing ? "garment on an invisible mannequin, product shot, clean studio" : "single product, product shot, clean studio");
  return bits.join(", ").slice(0, 600);
}

function cachedFileFor(prompt: string): string | null {
  const row = db.prepare("SELECT file FROM meshy_cache WHERE prompt_hash = ?").get(hash(prompt)) as { file: string } | undefined;
  return row && fs.existsSync(path.join(MODELS_DIR, row.file)) ? row.file : null;
}

/** Fire and forget. Never throws; the parametric model is the fallback. */
export async function startMeshy(wishId: string): Promise<void> {
  const wish = getWish(wishId);
  if (!wish) return;
  const prompt = meshyPrompt(wish.spec);
  const ready = (file: string) => {
    setWishModel(wishId, file);
    emit(`wish:${wishId}`, EVENTS.meshyReady, { wishId, modelUrl: `/models/${file}` });
    console.log(`[meshy] ready ${wishId} -> ${file}`);
  };

  const cached = cachedFileFor(prompt);
  if (cached) return ready(cached);
  // Past the daily cap the parametric model stays on screen.
  if (!env.meshyKey || env.demoMode || !spend("meshyModels")) return;

  try {
    const auth = { Authorization: `Bearer ${env.meshyKey}`, "Content-Type": "application/json" };
    const create = await fetch(API, { method: "POST", headers: auth, body: JSON.stringify({ mode: "preview", prompt, should_remesh: true }) });
    if (!create.ok) throw new Error(`create ${create.status}: ${await create.text()}`);
    const { result: taskId } = (await create.json()) as { result: string };
    setWishModel(wishId, null, taskId);
    console.log(`[meshy] task ${taskId} for ${wishId}: "${prompt}"`);

    const started = Date.now();
    while (Date.now() - started < 6 * 60_000) {
      await sleep(5000);
      const poll = await fetch(`${API}/${taskId}`, { headers: auth });
      if (!poll.ok) continue;
      const task = (await poll.json()) as { status: string; model_urls?: { glb?: string }; task_error?: { message?: string } };
      if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
        const glb = await fetch(task.model_urls.glb);
        if (!glb.ok) throw new Error(`download ${glb.status}`);
        const file = `${hash(prompt)}.glb`;
        fs.writeFileSync(path.join(MODELS_DIR, file), Buffer.from(await glb.arrayBuffer()));
        db.prepare("INSERT OR REPLACE INTO meshy_cache (prompt_hash, prompt, file, created_at) VALUES (?, ?, ?, ?)").run(hash(prompt), prompt, file, Date.now());
        return ready(file);
      }
      if (task.status === "FAILED" || task.status === "CANCELED" || task.status === "EXPIRED") throw new Error(`task ${task.status}: ${task.task_error?.message ?? ""}`);
    }
    throw new Error("timed out");
  } catch (err) {
    console.warn(`[meshy] ${wishId} failed (parametric model stays):`, (err as Error).message);
  }
}
