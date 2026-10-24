import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES, FABRICS, LENGTHS, NECKLINES, PATTERNS, SILHOUETTES, SLEEVES, KNOWN_FEATURES, FINISHES, PLACEMENTS,
  DECAL_KINDS, DECAL_SHAPES, ADDON_SHAPES, BODY_SHAPES, PARTS,
  shortName, guessPatch, interpret, isAffirmativeLock, isUndo, applyPatch,
  type ProductSpec, type SpecPatch,
} from "@wishit/shared";
import { z } from "zod";
import { cliBrainOn, env } from "./env.ts";
import { cliBrain } from "./brainCli.ts";
import type { TranscriptTurn } from "./wishes.ts";

export interface BrainResult { say: string; patch: SpecPatch; lock: boolean; brain: "llm" | "rules"; undo?: boolean }

const client = env.anthropicKey ? new Anthropic({ maxRetries: 0 }) : null;
// Local testing without an API key: BRAIN_CLI=1 routes turns through your `claude` login (never in production).
const useCli = !client && cliBrainOn;
export const brainKind: "llm" | "rules" = client || useCli ? "llm" : "rules";

export const SYSTEM = `You are the Wish it genie. A shopper describes a product they wish existed; you shape it with them and a 3D model updates live from the spec you write.

Voice: warm, witty, brief. Lean on the wish theme ("Your wish is taking shape...") without being cheesy. Your reply is spoken aloud by a TTS voice, so plain words only: no lists, emoji, markdown, or stage directions.

Every turn, call the update_spec tool exactly once. Put in it:
- say: your reply. At most 2 short sentences, at most one question, and if there is a question it is the last thing you say.
- patch: only the spec fields this turn changes. Infer whatever you can, even from a vague first utterance (always set category). Colors are hex, e.g. emerald is #1F8A5B. "Shorter"/"longer" moves length one step along mini, knee, midi, maxi. Keep features you already have unless the shopper removes them; when you set features, send the full list. Give the product a short catchy name once you know what it is.
- lock: true only when the shopper agrees to make the wish real (after you offered), or says "lock it in" / "wish it".

Conversation plan: over 2 to 3 turns, ask about whatever is still missing and matters most (for clothing: length or size, then color, then fabric; then the price they'd pay). Once category, color, and price are known, or after 3 turns, offer: "Shall I make your wish real?"

Categories with instant 3D: dress, top, skirt, backpack, helmet. Anything else is "generic": give it a body (a simple shape with width/height/depth in scene units, e.g. a mug is a cylinder 0.36 wide, 0.4 tall, plus a torus "handle" add-on on the right) so it renders instantly; an AI model is generated later. Features the 3D model can draw: ${KNOWN_FEATURES.join(", ")}. You may add other short snake_case features too.

Shoppers (often hackathon judges) will ask for any change at all, and every request must change the model visibly. Use the spec's edit fields:
- Named parts per category: ${Object.entries(PARTS).map(([c, p]) => `${c}: ${p.join(", ")}`).join("; ")}. "Make the straps black" -> parts.straps.color; "bigger pockets" -> parts.pockets.scale (a factor, 1 = default: multiply the current factor by about 1.3, 1.6 for "much", 1.15 for "a little"); "remove the visor" -> parts.visor.hidden true. parts merges one part at a time, so send only the parts you change; null clears a part's overrides. Pockets, side_pocket, stand, headphones and seam come and go with their feature (phone_pockets, laptop_stand, headphones, converts_to_skirt): to remove them, drop the feature.
- Overall size: scale (0.5 to 1.8, 1 = default). "Make it bigger" multiplies it. For a generic body, "taller"/"wider" changes body.height/body.width instead.
- Pictures, words and symbols ON the surface are decals: kind "shape" for ${DECAL_SHAPES.join(", ")}; kind "emoji" with one emoji for any other picture (a dragon is 🐉, a cat is 🐱); kind "text" for words, names, numbers and initials, exactly as said. placement is one of ${PLACEMENTS.join(", ")}; size is a factor (1 = default); color is hex. "All over" means one decal per side (front, back, left, right).
- Physical things attached to the product are addons, built from one primitive: ${ADDON_SHAPES.join(", ")} (bow, spike, fin and dome are small composites). Pick the closest shape (a cup holder is a cylinder on the right, a belt is a torus at the waist, horns are cones on top with count 2, a hood is a dome on the back, wings are fins on the back with count 2), set glow true for lights and screens, and keep the shopper's name for it.
- decals and addons are full lists, like features: to add one, send all existing ones plus the new one; to remove or move one, send the list without it or with its new placement.
- Changes to one part never touch the whole-product fields: "longer sleeves" changes sleeves, not length; "black straps" changes parts.straps.color, not color.
- undo: true (with an empty patch) when the shopper wants the previous version back ("undo", "go back", "never mind, change it back").
- If something truly can't be drawn, still make the closest visible change and say so in a few words. Never answer an edit request with only a question.
- If the shopper is just chatting or asking you something (your favorite color, how it works, what it costs), answer and send an empty patch: only change the product when they ask for a change.`;

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
    finish: { type: "string", enum: [...FINISHES] },
    scale: { type: "number", description: "overall size factor, 0.5 to 1.8, 1 = default" },
    parts: {
      type: "object",
      description: "per-part overrides, merged per part; null clears a part",
      additionalProperties: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: { scale: { type: "number" }, color: { type: "string" }, hidden: { type: "boolean" } },
      },
    },
    decals: {
      type: "array",
      description: "full list of surface designs",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: [...DECAL_KINDS] },
          content: { type: "string", description: "text, one emoji, or a shape name" },
          placement: { type: "string", enum: [...PLACEMENTS] },
          color: { type: "string" },
          size: { type: "number" },
        },
        required: ["kind", "content", "placement"],
      },
    },
    addons: {
      type: "array",
      description: "full list of attached physical things",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          shape: { type: "string", enum: [...ADDON_SHAPES] },
          placement: { type: "string", enum: [...PLACEMENTS] },
          size: { type: "number" },
          color: { type: "string" },
          glow: { type: "boolean" },
          count: { type: "integer" },
        },
        required: ["name", "shape", "placement"],
      },
    },
    body: {
      type: "object",
      description: "generic products only",
      additionalProperties: false,
      properties: {
        shape: { type: "string", enum: [...BODY_SHAPES] },
        width: { type: "number" },
        height: { type: "number" },
        depth: { type: "number" },
      },
      required: ["shape"],
    },
  },
} as const;

export const tool: Anthropic.Beta.BetaTool = {
  name: "update_spec",
  description: "Update the product spec that drives the live 3D model, and give the spoken reply for this turn.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      say: { type: "string", description: "Spoken reply, max 2 short sentences, max one question (last)." },
      patch: patchSchema,
      lock: { type: "boolean" },
      undo: { type: "boolean", description: "true to restore the previous version of the spec (send an empty patch)" },
    },
    required: ["say", "patch", "lock"],
  } as Anthropic.Beta.BetaTool.InputSchema,
};

export const ToolInput = z.object({ say: z.string().min(1), patch: z.record(z.unknown()).default({}), lock: z.boolean().default(false), undo: z.boolean().default(false) });

export async function think(spec: ProductSpec, transcript: TranscriptTurn[], text: string): Promise<BrainResult> {
  if (!client && !useCli) return ruleBrain(spec, transcript, text);
  try {
    return useCli ? await cliBrain(spec, transcript, text, { model: env.brainModel }) : await llmBrain(spec, transcript, text);
  } catch (err) {
    console.warn("[brain] LLM failed, using rules:", (err as Error).message);
    return ruleBrain(spec, transcript, text);
  }
}

/** The per-turn user message (shared with scripts/judge-eval.ts, which replays it through the claude CLI). */
export function turnMessage(spec: ProductSpec, transcript: TranscriptTurn[], text: string): string {
  const history = transcript.slice(-12).map((t) => `${t.role === "user" ? "Shopper" : "Genie"}: ${t.text}`).join("\n");
  const genieTurns = transcript.filter((t) => t.role === "genie").length;
  return [
    `Current spec: ${JSON.stringify(spec)}`,
    history ? `Conversation so far:\n${history}` : "This is the first turn.",
    `Genie turns so far: ${genieTurns}`,
    `Shopper just said: "${text}"`,
  ].join("\n\n");
}

async function llmBrain(spec: ProductSpec, transcript: TranscriptTurn[], text: string): Promise<BrainResult> {
  const user = turnMessage(spec, transcript, text);

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
  return { say: clampSay(parsed.data.say), patch: parsed.data.undo ? {} : (parsed.data.patch as SpecPatch), lock: parsed.data.lock, undo: undoOf(parsed.data, text), brain: "llm" };
}

/** Trust the model's undo flag; also catch a plain "undo" it answered with an empty patch. */
export const undoOf = (d: { undo: boolean; patch: Record<string, unknown> }, text: string) => d.undo || (isUndo(text) && Object.keys(d.patch).length === 0);

export function clampSay(s: string) {
  const sentences = s.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g) ?? [s];
  return sentences.slice(0, 2).join(" ").trim();
}

/** Offline brain: keyword patch + a scripted follow-up. Keeps the demo alive with no LLM. */
export function ruleBrain(spec: ProductSpec, transcript: TranscriptTurn[], text: string): BrainResult {
  const offered = transcript.some((t) => t.role === "genie" && /make your wish real/i.test(t.text));
  if ((offered && isAffirmativeLock(text)) || /\b(lock it|wish it|make it real)\b/i.test(text)) {
    return { say: "Your wish is sealed. Let's see if anyone has made it already.", patch: {}, lock: true, brain: "rules" };
  }
  const { patch, did, undo } = interpret(text, spec);
  if (undo) return { say: pick(["Poof, back the way it was.", "Undone, like it never happened."]), patch: {}, lock: false, undo: true, brain: "rules" };
  const next = applyPatch(spec, patch).spec;
  if (next.category !== "generic") patch.name = shortName(next);
  const genieTurns = transcript.filter((t) => t.role === "genie").length;
  const clothing = ["dress", "top", "skirt"].includes(next.category);

  let lead = genieTurns === 0 ? "Ooh, your wish is taking shape." : pick(["Done, look at that.", "Granted.", "Like magic.", "There it is."]);
  if (next.category === "generic" && genieTurns === 0) lead = "A one-of-a-kind wish, I'm conjuring it now.";
  // An edit request gets a reply about the edit, not the next scripted question.
  if (did.length && genieTurns > 0) {
    const list = did.length > 1 ? `${did.slice(0, -1).join(", ")} and ${did[did.length - 1]}` : did[0];
    return { say: `${pick(["Granted", "Done", "Wish granted"])}: ${list}. Anything else?`, patch, lock: false, brain: "rules" };
  }

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
