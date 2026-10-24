import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES, FABRICS, LENGTHS, NECKLINES, PATTERNS, SILHOUETTES, SLEEVES, KNOWN_FEATURES,
  shortName, guessPatch, isAffirmativeLock, applyPatch,
  type ProductSpec, type SpecPatch,
} from "@wishit/shared";
import { z } from "zod";
import { env } from "./env.ts";
import type { TranscriptTurn } from "./wishes.ts";

export interface BrainResult { say: string; patch: SpecPatch; lock: boolean; brain: "llm" | "rules" }

const client = env.anthropicKey ? new Anthropic({ maxRetries: 0 }) : null;
export const brainKind: "llm" | "rules" = client ? "llm" : "rules";

const SYSTEM = `You are the Wish it genie. A shopper describes a product they wish existed; you shape it with them and a 3D model updates live from the spec you write.

Voice: warm, witty, brief. Lean on the wish theme ("Your wish is taking shape...") without being cheesy. Your reply is spoken aloud by a TTS voice, so plain words only: no lists, emoji, markdown, or stage directions.

Every turn, call the update_spec tool exactly once. Put in it:
- say: your reply. At most 2 short sentences, at most one question, and if there is a question it is the last thing you say.
- patch: only the spec fields this turn changes. Infer whatever you can, even from a vague first utterance (always set category). Colors are hex, e.g. emerald is #1F8A5B. "Shorter"/"longer" moves length one step along mini, knee, midi, maxi. Keep features you already have unless the shopper removes them; when you set features, send the full list. Give the product a short catchy name once you know what it is.
- lock: true only when the shopper agrees to make the wish real (after you offered), or says "lock it in" / "wish it".

Conversation plan: over 2 to 3 turns, ask about whatever is still missing and matters most (for clothing: length or size, then color, then fabric; then the price they'd pay). Once category, color, and price are known, or after 3 turns, offer: "Shall I make your wish real?"

Categories with instant 3D: dress, top, skirt, backpack, helmet. Anything else is "generic" (a glowing wish orb; an AI model is generated later), and that is fine. Features the 3D model can draw: ${KNOWN_FEATURES.join(", ")}. You may add other short snake_case features too.`;

const patchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    name: { type: "string" },
    length: { type: "string", enum: [...LENGTHS] },
    silhouette: { type: "string", enum: [...SILHOUETTES] },
    sleeves: { type: "string", enum: [...SLEEVES] },
    neckline: { type: "string", enum: [...NECKLINES] },
    color: { type: "string", description: "hex like #1F8A5B" },
    fabric: { type: "string", enum: [...FABRICS] },
    pattern: { type: "string", enum: [...PATTERNS] },
    size: { type: "string" },
    features: { type: "array", items: { type: "string" } },
    target_price_usd: { type: "number" },
    notes: { type: "string" },
  },
} as const;

const tool: Anthropic.Beta.BetaTool = {
  name: "update_spec",
  description: "Update the product spec that drives the live 3D model, and give the spoken reply for this turn.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      say: { type: "string", description: "Spoken reply, max 2 short sentences, max one question (last)." },
      patch: patchSchema,
      lock: { type: "boolean" },
    },
    required: ["say", "patch", "lock"],
  } as Anthropic.Beta.BetaTool.InputSchema,
};

const ToolInput = z.object({ say: z.string().min(1), patch: z.record(z.unknown()).default({}), lock: z.boolean().default(false) });

export async function think(spec: ProductSpec, transcript: TranscriptTurn[], text: string): Promise<BrainResult> {
  if (!client) return ruleBrain(spec, transcript, text);
  try {
    return await llmBrain(spec, transcript, text);
  } catch (err) {
    console.warn("[brain] LLM failed, using rules:", (err as Error).message);
    return ruleBrain(spec, transcript, text);
  }
}

async function llmBrain(spec: ProductSpec, transcript: TranscriptTurn[], text: string): Promise<BrainResult> {
  const history = transcript.slice(-12).map((t) => `${t.role === "user" ? "Shopper" : "Genie"}: ${t.text}`).join("\n");
  const genieTurns = transcript.filter((t) => t.role === "genie").length;
  const user = [
    `Current spec: ${JSON.stringify(spec)}`,
    history ? `Conversation so far:\n${history}` : "This is the first turn.",
    `Genie turns so far: ${genieTurns}`,
    `Shopper just said: "${text}"`,
  ].join("\n\n");

  const response = await client!.beta.messages.create(
    {
      model: env.brainModel,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    },
    { timeout: 8000 },
  );

  if (response.stop_reason === "refusal") throw new Error("refusal");
  const use = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "update_spec");
  const textReply = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
  if (!use) {
    if (textReply) return { say: clampSay(textReply), patch: guessPatch(text, spec), lock: isAffirmativeLock(text), brain: "llm" };
    throw new Error("no tool call");
  }
  const parsed = ToolInput.safeParse(use.input);
  if (!parsed.success) throw new Error("bad tool input");
  return { say: clampSay(parsed.data.say), patch: parsed.data.patch as SpecPatch, lock: parsed.data.lock, brain: "llm" };
}

function clampSay(s: string) {
  const sentences = s.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g) ?? [s];
  return sentences.slice(0, 2).join(" ").trim();
}

/** Offline brain: keyword patch + a scripted follow-up. Keeps the demo alive with no LLM. */
export function ruleBrain(spec: ProductSpec, transcript: TranscriptTurn[], text: string): BrainResult {
  const offered = transcript.some((t) => t.role === "genie" && /make your wish real/i.test(t.text));
  if ((offered && isAffirmativeLock(text)) || /\b(lock it|wish it|make it real)\b/i.test(text)) {
    return { say: "Your wish is sealed. Let's see if anyone has made it already.", patch: {}, lock: true, brain: "rules" };
  }
  const patch = guessPatch(text, spec);
  const next = applyPatch(spec, patch).spec;
  if (next.category !== "generic") patch.name = shortName(next);
  const genieTurns = transcript.filter((t) => t.role === "genie").length;
  const clothing = ["dress", "top", "skirt"].includes(next.category);

  let lead = genieTurns === 0 ? "Ooh, your wish is taking shape." : pick(["Done, look at that.", "Granted.", "Like magic.", "There it is."]);
  if (next.category === "generic" && genieTurns === 0) lead = "A one-of-a-kind wish, I'm conjuring it now.";

  let ask: string;
  if (clothing && !next.length && next.category !== "top") ask = "How long should it be: mini, knee, midi, or maxi?";
  else if (!next.color) ask = "What color are you dreaming of?";
  else if (clothing && !next.fabric) ask = "Cotton, satin, linen, or knit?";
  else if (!next.target_price_usd) ask = "What would you happily pay for it?";
  else if (genieTurns >= 1) ask = "Shall I make your wish real?";
  else ask = "Anything else you'd change?";
  return { say: `${lead} ${ask}`, patch, lock: false, brain: "rules" };
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
