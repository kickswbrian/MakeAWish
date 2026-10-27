import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { EVENTS } from "@wishit/shared";
import { db } from "./db.ts";
import { emit } from "./bus.ts";
import { env } from "./env.ts";
import { spend } from "./security.ts";
import { withTimeout } from "./util.ts";
import { getMatches } from "./apify.ts";

/**
 * Visual match: Claude looks at the shopper's 3D render next to each listing's photo and scores how
 * much they look alike (shape, proportions, color, materials, details). Runs after the text-scored
 * matches are on screen and updates them in place, so the grid can rank by look + price.
 * Photos are downloaded here (a store's CDN refusing Anthropic's fetcher would fail the whole call),
 * and any photo that won't load is simply left unscored.
 */

const client = env.anthropicKey ? new Anthropic({ maxRetries: 1 }) : null;
const Visual = z.object({ results: z.array(z.object({ index: z.number().int(), visual: z.number().int() })) });
type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const TYPES = new Set<ImageType>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 3_000_000;

async function download(url: string): Promise<{ media_type: ImageType; data: string } | null> {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const res = await withTimeout(fetch(url, { redirect: "follow" }), 6000, "photo");
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() as ImageType;
    if (!TYPES.has(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_BYTES ? { media_type: type, data: buf.toString("base64") } : null;
  } catch {
    return null;
  }
}

/** The wish's render: a data URL saved when the shopper locked the design. */
function parseThumb(thumb: string | null): { media_type: ImageType; data: string } | null {
  const m = thumb?.match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/);
  return m ? { media_type: m[1] as ImageType, data: m[2] } : null;
}

export async function scoreVisual(wishId: string, thumb: string | null): Promise<void> {
  const render = parseThumb(thumb);
  if (!client || !render) return;
  const rows = db.prepare("SELECT id, title, image FROM matches WHERE wish_id = ? AND image IS NOT NULL AND source != 'sample' ORDER BY score DESC LIMIT 8").all(wishId) as
    { id: number; title: string; image: string }[];
  if (!rows.length || !spend("visualScores")) return;
  const photos = await Promise.all(rows.map((r) => download(r.image)));
  const scored = rows.map((r, i) => ({ ...r, photo: photos[i] })).filter((r) => r.photo);
  if (!scored.length) return;
  try {
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: "This is a 3D render of a product a shopper designed:" },
      { type: "image", source: { type: "base64", ...render } },
      { type: "text", text: "And these are store listing photos:" },
    ];
    scored.forEach((r, i) => {
      content.push({ type: "text", text: `Listing ${i}: ${r.title}` });
      content.push({ type: "image", source: { type: "base64", ...r.photo! } });
    });
    content.push({
      type: "text",
      text: "Score each listing from 0 to 100 for how much the product in its photo LOOKS like the render: overall shape and proportions, colors, materials, and visible details. " +
        "Ignore backgrounds, lighting, packaging and the render's simplified style. 80+ = looks like the same design, 50-79 = same kind of product, clearly different look, under 50 = looks different.",
    });
    const response = await withTimeout(
      client.messages.parse({
        model: env.editModel,
        max_tokens: 2000,
        output_config: { effort: "low", format: zodOutputFormat(Visual) },
        messages: [{ role: "user", content }],
      }),
      45_000,
      "visual",
    );
    const parsed = response.parsed_output;
    if (!parsed) throw new Error(response.stop_reason === "refusal" ? "refusal" : "no parsed output");
    const set = db.prepare("UPDATE matches SET visual = ? WHERE id = ?");
    db.transaction(() => {
      for (const r of parsed.results) {
        const row = scored[r.index];
        if (row) set.run(Math.max(0, Math.min(100, r.visual)), row.id);
      }
    })();
    emit(`wish:${wishId}`, EVENTS.matchesReady, { wishId, ...getMatches(wishId) });
  } catch (err) {
    console.warn(`[visual] scoring failed, ranking by description only: ${(err as Error).message}`);
  }
}
