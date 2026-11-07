import Anthropic from "@anthropic-ai/sdk";
import {
  addOrder, applyPatches, childrenOf, emptyProduct, fashionById, fixChildFrame, localOutfit, outfitProduct, floatingParts, groundPart, hangCords, isEmpty, surfaceText, unshear, levelIssues, localBox, movedBy, newCollisions, partBox, stretchUp, partsInOrder, subtreeIds, toPartSpace, toProductSpace, matchTemplate, parseIntent, ProductMetaSchema, setMeta, templateById, templateProduct,
  type FashionState, type FashionTemplate, type LevelIssue, type OutlineEntry, type Part, type Patch, type Product, type ProductMeta, type TurnEvent, type TurnSelection, type TurnTiming, type Vec3,
} from "@wishit/shared";
import { env } from "./env.ts";
import { JsonStreamScanner } from "./jsonstream.ts";
import { systemPrompt } from "./prompt.ts";
import { applyControls, applyMaterials, applyModule, outfitContext, outfitProps, wishStyleLine, type OutfitSink } from "./outfit.ts";
import type { TranscriptTurn } from "./wishes.ts";

/**
 * The genie's brain. Every turn streams patches back as they are written:
 *  - edits: one call with the tapped part's neighborhood, patches only;
 *  - new designs: a planner call (template or root body + part groups) whose groups each start a
 *    parallel builder call the moment the planner finishes writing them.
 * Patches are validated against the working product before they are forwarded.
 */

const client = env.anthropicKey ? new Anthropic({ maxRetries: 0 }) : null;
export const brainKind: "llm" | "rules" = client ? "llm" : "rules";

export interface TurnInput {
  text: string;
  product: Product;
  selection: TurnSelection | null;
  outline: OutlineEntry[];
  transcript: TranscriptTurn[];
  /** The product is this template, freshly shown for a new wish: customize it like a new design. */
  template?: string | null;
}

export interface TurnResult {
  product: Product;
  say: string;
  lock: boolean;
  brain: "llm" | "rules";
  timing: TurnTiming;
  rejected: number;
}

// ---------- Tools (all are sent on every call so the cached prefix is identical) ----------

const partSchema = {
  type: "object",
  description: "A Part (see the system prompt for fields and conventions).",
  properties: {
    id: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["primitive", "kit"] },
    geometry: { type: "object" }, kitAsset: { type: "string" }, kitParams: { type: "object" },
    parent: { type: ["string", "null"] }, transform: { type: "object" }, material: { type: "object" }, csg: { type: "object" }, repeat: { type: "object" },
  },
  required: ["id", "name", "kind", "parent", "material"],
};
const patchSchema = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["add", "update", "remove"] },
    part: partSchema,
    id: { type: "string" },
    changes: { type: "object" },
  },
  required: ["op"],
};
const metaSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short catchy product name, 2-4 words." },
    category: { type: "string", description: "Plain product noun, e.g. 'backpack', 'desk lamp'." },
    description: { type: "string", description: "One sentence a shopper would search for, naming the key features." },
    searchQuery: { type: "string", description: "3-6 words a shopper would type into Amazon to find this: the generic product noun plus its one or two defining features, no invented names or colors (e.g. 'electric kettle tea infuser')." },
    targetPriceUsd: { type: "number" },
  },
};

const TOOLS = [
  {
    name: "plan_design",
    description: "Start a brand-new product. Either pick a template and customize it with patches, or write the root body part and split the rest of the product into 3-5 part groups that are built in parallel.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        template: { type: ["string", "null"], description: "A template id when one fits the wish well, else null." },
        root: { ...partSchema, description: "Only without a template: the main body part (parent null), with real dimensions. Write it FIRST." },
        groups: {
          type: "array",
          description: "Only without a template: 5-8 groups of 3-5 parts each, biggest/most important first. Each group is built in parallel by a separate builder that sees only the root part and your brief, so keep parts that rest on each other in ONE group (a roof and the solar panels on it, a neck and its tuning pegs), and give every group its exact mount coordinates on the root.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short snake_case prefix for the group's part ids." },
              brief: { type: "string", description: "ONE terse sentence, max 30 words: the parts, key sizes in meters, which face/coordinates on the root, material+color. Write fast; builders fill in detail." },
            },
            required: ["id", "brief"],
          },
        },
        patches: { type: "array", items: patchSchema, description: "Only with a template: patches that customize it to the wish (colors, materials, sizes, the wish's special features)." },
        meta: metaSchema,
        say: { type: "string", description: "Max 2 short sentences, spoken aloud." },
        lock: { type: "boolean" },
      },
      required: ["template", "meta", "say", "lock"],
    },
  },
  {
    name: "add_parts",
    description: "Build one group of a new product: add patches only.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { patches: { type: "array", items: patchSchema } },
      required: ["patches"],
    },
  },
  {
    name: "style_outfit",
    description: "Design a new fashion product from its template (already on screen in the default look): set controls, slot materials and detail modules on zones so it matches the wish and its styles.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        ...outfitProps,
        meta: metaSchema,
        say: { type: "string", description: "Max 2 short sentences, spoken aloud." },
        lock: { type: "boolean" },
      },
      required: ["meta", "say", "lock"],
    },
  },
  {
    name: "apply_patches",
    description: "Edit the current product with patches (and, for fashion products, outfit fields), then speak.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        newDesign: { type: "boolean", description: "True only if the shopper wants a different product entirely; then send no patches." },
        ...outfitProps,
        patches: { type: "array", items: patchSchema },
        meta: metaSchema,
        say: { type: "string", description: "Max 2 short sentences, spoken aloud." },
        lock: { type: "boolean" },
      },
      required: ["patches", "say", "lock"],
    },
  },
] as const;

let cachedSystem: string | null = null;
const system = () => (cachedSystem ??= systemPrompt());

/** Model-specific request knobs: forced tool use where allowed, thinking off or low for speed. */
function modelParams(model: string, tool: string): Record<string, unknown> {
  if (model.includes("haiku")) return { tool_choice: { type: "tool", name: tool } };
  if (model.includes("sonnet")) return { tool_choice: { type: "tool", name: tool }, thinking: { type: "disabled" } };
  // Opus 5.5: forced tool use is rejected and thinking can't be disabled; steer with effort,
  // and use fast mode for ~2x output speed.
  return { tool_choice: { type: "auto" }, output_config: { effort: "low" }, ...(env.fastMode && model.includes("opus") ? { speed: "fast" } : {}) };
}

// ---------- Compact product context ----------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Part JSON without defaults, for the prompt. */
function compactPart(p: Part): Record<string, unknown> {
  const out: Record<string, unknown> = { id: p.id, name: p.name, kind: p.kind, parent: p.parent };
  if (p.geometry) out.geometry = p.geometry;
  if (p.kitAsset) out.kitAsset = p.kitAsset;
  if (p.kitParams) out.kitParams = p.kitParams;
  const t: Record<string, unknown> = {};
  if (p.transform.position.some((v) => v !== 0)) t.position = p.transform.position;
  if (p.transform.rotation.some((v) => v !== 0)) t.rotation = p.transform.rotation;
  if (p.transform.scale.some((v) => v !== 1)) t.scale = p.transform.scale;
  if (Object.keys(t).length) out.transform = t;
  out.material = p.material;
  if (p.csg) out.csg = p.csg;
  return out;
}

function outlineLine(p: Part, o?: OutlineEntry): string {
  const what = p.kind === "kit" ? `kit:${p.kitAsset}` : p.geometry?.type ?? "?";
  const box = o ? ` center[${o.center.map(r3).join(",")}] size[${o.size.map(r3).join(",")}]` : "";
  return `${p.id} "${p.name}" ${what} parent=${p.parent ?? "-"} ${p.material.preset} ${p.material.color}${box}`;
}

/** Where a part's faces are in its own frame, so builders can put things on them without guessing. */
function faceGuide(p: Part): string {
  const b = localBox(p);
  if (!b) return "";
  const f = (v: number) => r3(v);
  return `Root's faces in its own frame (your positions are in this frame): top y=${f(b.max[1])}, bottom y=${f(b.min[1])}, front z=${f(b.max[2])}, back z=${f(b.min[2])}, right x=${f(b.max[0])}, left x=${f(b.min[0])}. Center [${[0, 1, 2].map((i) => f((b.min[i] + b.max[i]) / 2)).join(",")}].${p.geometry && ["lathe", "cylinder", "sphere", "capsule"].includes(p.geometry.type) ? " It is round: its side surface is at radius " + f(b.max[0]) + " from the Y axis (less where it tapers)." : ""}`;
}

/** One line per part, so a template can be customized by id without the full JSON. */
function templateOutline(id: string): string {
  const tpl = templateById(id);
  if (!tpl) return "";
  const r = (n: number) => +n.toFixed(3);
  const dims = (p: Part): string => {
    if (p.kind === "kit") return `kit ${p.kitAsset}`;
    const g = p.geometry;
    if (!g) return "";
    const q = g.params as Record<string, unknown>;
    switch (g.type) {
      case "roundedBox": return `box ${r(q.width as number)}x${r(q.height as number)}x${r(q.depth as number)}`;
      case "cylinder": return `cylinder r${r(Math.max(q.radiusTop as number, q.radiusBottom as number))} h${r(q.height as number)}`;
      case "sphere": return `sphere r${r(q.radius as number)}`;
      case "capsule": return `capsule r${r(q.radius as number)} len${r(q.length as number)}`;
      case "torus": return `torus r${r(q.radius as number)} tube${r(q.tube as number)}`;
      case "lathe": {
        const pts = q.points as [number, number][];
        return `lathe r${r(Math.max(...pts.map((v) => v[0])))} y${r(Math.min(...pts.map((v) => v[1])))}..${r(Math.max(...pts.map((v) => v[1])))}`;
      }
      case "extrude": return `extrude depth${r(q.depth as number)}`;
      case "text": return `text "${String(q.text).slice(0, 24)}" size${r(q.size as number)}`;
      default: return g.type;
    }
  };
  const lines = tpl.parts.map((p) => `- ${p.id} "${p.name}" parent=${p.parent ?? "-"} pos=[${p.transform.position.map(r).join(",")}]${p.transform.rotation.some((v) => v) ? ` rot=[${p.transform.rotation.map(r).join(",")}]` : ""} ${dims(p)} ${p.material.preset} ${p.material.color}`);
  return `Template "${tpl.id}" parts (id "name" parent position-in-parent-frame size material):\n${lines.join("\n")}`;
}

function editContext(input: TurnInput): string {
  const { product, selection, outline } = input;
  const byId = new Map(outline.map((o) => [o.id, o]));
  const parts = Object.values(product.parts);
  const lines: string[] = [`Product: ${product.title}${product.description ? ` — ${product.description}` : ""} (${parts.length} parts, root ${product.rootId})`];
  const outfit = outfitContext(product);
  if (outfit) lines.push(outfit);
  const sel = selection ? product.parts[selection.partId] : undefined;
  let detail: Part[];
  if (sel) {
    const parent = sel.parent ? product.parts[sel.parent] : undefined;
    const siblings = sel.parent ? childrenOf(product, sel.parent).filter((p) => p.id !== sel.id) : [];
    detail = [sel, ...(parent ? [parent] : []), ...siblings.slice(0, 12), ...childrenOf(product, sel.id)];
    lines.push(`\nSELECTED PART (the shopper tapped it): ${sel.id}`);
    if (selection?.point) {
      lines.push(`Tap point in ${sel.id}'s frame: [${selection.point.map(r3).join(",")}], surface normal [${selection.normal?.map(r3).join(",") ?? "?"}], mount rotation for kit parts: [${selection.rotation?.join(",") ?? "0,0,0"}]`);
    }
  } else {
    // No selection: global edits need the whole picture, still compact.
    detail = parts.length <= 40 ? parts : [product.parts[product.rootId], ...childrenOf(product, product.rootId)];
  }
  const detailIds = new Set(detail.map((p) => p.id));
  lines.push("\nFull JSON of the relevant parts (productOrigin: where the part's own frame origin sits in product space; a new child's position is in its PARENT's frame, so for a product-space point P on an unrotated parent X, position = (P - X.productOrigin) / X.transform.scale per axis; down: on a tilted part, the direction gravity pulls in its frame, so things hanging from it go along down, not -Y):");
  for (const p of detail) lines.push(JSON.stringify({ ...compactPart(p), productOrigin: toProductSpace(product, p.id, [0, 0, 0]).map(r3), ...downIn(product, p.id) }));
  const rest = parts.filter((p) => !detailIds.has(p.id));
  if (rest.length) {
    lines.push("\nOther parts (id, name, type, parent, material, product-space center/size in meters):");
    for (const p of rest) lines.push(outlineLine(p, byId.get(p.id)));
  }
  if (outline.length) {
    const root = byId.get(product.rootId);
    if (root) lines.push(`\nRoot part bounds in product space: center[${root.center.map(r3).join(",")}] size[${root.size.map(r3).join(",")}]`);
  }
  return lines.join("\n");
}

function historyBlock(transcript: TranscriptTurn[]): string {
  const h = transcript.slice(-8).map((t) => `${t.role === "user" ? "Shopper" : "Genie"}: ${t.text}`).join("\n");
  const genieTurns = transcript.filter((t) => t.role === "genie").length;
  return `${h ? `Conversation so far:\n${h}\n` : "This is the first turn.\n"}Genie turns so far: ${genieTurns}`;
}

// ---------- Streaming one tool call ----------

interface CallHandlers {
  /** Plain text the model wrote instead of (or before) calling the tool. */
  onText?: (text: string, toolCalled: boolean) => void;
  onValue?: (key: string, value: unknown) => void;
  onItem?: (key: string, index: number, value: unknown) => void;
  onFirstToken?: () => void;
}

interface CallStats { input: number; cached: number; output: number; toolCalled?: boolean }

/** Stream one tool call; if the model fails before writing anything, retry once on the fallback model. */
async function streamTool(model: string, tool: string, user: string, h: CallHandlers, signal: AbortSignal, maxTokens: number): Promise<CallStats> {
  let wrote = false;
  const wrapped: CallHandlers = { ...h, onFirstToken: () => { wrote = true; h.onFirstToken?.(); } };
  try {
    const stats = await streamToolOnce(model, tool, user, wrapped, signal, maxTokens);
    // Opus can't be forced to use a tool and now and then answers in prose instead: the turn would
    // silently do nothing. Redo it on the edit model, which can be forced.
    if (stats.toolCalled || signal.aborted || model === env.editModel || !env.editModel.includes("sonnet")) return stats;
    const retry = await streamToolOnce(env.editModel, tool, user, h, signal, maxTokens);
    return { input: stats.input + retry.input, cached: stats.cached + retry.cached, output: stats.output + retry.output, toolCalled: retry.toolCalled };
  } catch (err) {
    if (signal.aborted || wrote || model === env.fallbackModel) throw err;
    console.warn(`[brain] ${model} failed before streaming (${(err as Error).message.slice(0, 120)}), falling back to ${env.fallbackModel}`);
    return streamToolOnce(env.fallbackModel, tool, user, h, signal, maxTokens);
  }
}

async function streamToolOnce(model: string, tool: string, user: string, h: CallHandlers, signal: AbortSignal, maxTokens: number): Promise<CallStats> {
  const scanner = new JsonStreamScanner({
    onValue: (k, raw) => {
      try {
        h.onValue?.(k, JSON.parse(raw));
      } catch {
        /* a malformed value is skipped; validation happens downstream */
      }
    },
    onItem: (k, i, raw) => {
      try {
        h.onItem?.(k, i, JSON.parse(raw));
      } catch {
        /* skip */
      }
    },
  });
  const stats: CallStats = { input: 0, cached: 0, output: 0 };
  const params = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system(), cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    messages: [{ role: "user", content: user }],
    stream: true,
    ...modelParams(model, tool),
  };
  const stream = (await client!.messages.create(params as unknown as Anthropic.MessageCreateParamsStreaming, { signal, timeout: 30_000 })) as AsyncIterable<Anthropic.RawMessageStreamEvent>;
  let first = true;
  let inTool = false;
  let toolSeen = false;
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "message_start") {
      const u = ev.message.usage;
      stats.input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      stats.cached = u.cache_read_input_tokens ?? 0;
    } else if (ev.type === "content_block_start") {
      inTool = ev.content_block.type === "tool_use" && ev.content_block.name === tool;
      if (inTool) toolSeen = true;
    } else if (ev.type === "content_block_delta") {
      // Thinking deltas are not visible output; time-to-first-token means the first tool/text byte.
      if (first && ev.delta.type !== "thinking_delta" && ev.delta.type !== "signature_delta") {
        first = false;
        h.onFirstToken?.();
      }
      if (inTool && ev.delta.type === "input_json_delta") scanner.push(ev.delta.partial_json);
      else if (ev.delta.type === "text_delta") text += ev.delta.text;
    } else if (ev.type === "content_block_stop") {
      if (inTool) scanner.end();
      inTool = false;
    } else if (ev.type === "message_delta") {
      stats.output = ev.usage.output_tokens;
      if (ev.delta.stop_reason === "max_tokens") console.warn(`[brain] ${tool} hit max_tokens`);
    }
  }
  if (text.trim()) h.onText?.(text.trim(), toolSeen);
  if (!toolSeen) console.warn(`[brain] ${model} skipped the ${tool} tool${text.trim() ? `: "${text.trim().slice(0, 160)}"` : ""}`);
  stats.toolCalled = toolSeen;
  return stats;
}

// ---------- The turn ----------

/**
 * Run one turn, streaming events through `emit` as they happen. Resolves with the final product.
 * Never throws for model errors: falls back to the offline genie.
 */
export async function runTurn(input: TurnInput, emit: (ev: TurnEvent) => void, signal: AbortSignal, forceRules = false): Promise<TurnResult> {
  touchBrain();
  const t0 = performance.now();
  const timing: TurnTiming = { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  const at = () => Math.round(performance.now() - t0);
  let product = input.product;
  let rejected = 0;
  let say = "";
  let lock = false;

  /** Start over with an empty product (a different product entirely). */
  // A new design (no "before" to compare collisions against): set again if the turn starts over.
  let fresh = isEmpty(input.product) || !!input.template;
  const reset = () => {
    fresh = true;
    product = emptyProduct(product.id);
    emit({ t: "reset" });
  };
  // Parts added or moved this turn: checked for floating once the turn's patches are all in.
  const touched = new Set<string>();
  const added = new Set<string>();
  const applyAndEmit = (patches: unknown[]) => {
    const r = applyPatches(product, patches);
    product = r.product;
    rejected += r.rejected.length;
    for (const p of r.applied) {
      if (p.op === "add") {
        touched.add(p.part.id);
        added.add(p.part.id);
      }
      else if (p.op === "update" && (p.changes.transform || p.changes.geometry || p.changes.parent !== undefined || p.changes.kitParams)) touched.add(p.id);
    }
    if (r.rejected.length) console.log(`[brain] rejected: ${r.rejected.map((x) => x.reason).join(" | ").slice(0, 300)}`);
    if (r.applied.length) {
      timing.firstPatch ??= at();
      timing.lastPatch = at();
      emit({ t: "patches", patches: r.applied, at: at() });
    }
  };
  const applyMeta = (raw: unknown) => {
    const m = ProductMetaSchema.safeParse(raw);
    if (!m.success) return;
    product = setMeta(product, m.data);
    emit({ t: "meta", meta: m.data });
  };
  const setFashion = (f: FashionState) => {
    product = { ...product, fashion: f };
    emit({ t: "fashion", fashion: f });
  };
  const track = (s: CallStats) => {
    timing.calls! += 1;
    timing.inputTokens! += s.input;
    timing.cachedTokens! += s.cached;
    timing.outputTokens! += s.output;
  };

  // Instant local edits never reach the model (the client normally catches these first).
  const intent = isEmpty(product) || input.template ? null : parseIntent(input.text, { product, selectedId: input.selection?.partId });
  if (intent && intent.patches.length) {
    applyAndEmit(intent.patches);
    emit({ t: "say", text: intent.say });
    timing.done = at();
    return { product, say: intent.say, lock: false, brain: "rules", timing, rejected };
  }

  /**
   * Models misjudge frames and sizes: a part placed in the air (a speaker beside the hood, a brim
   * above the head) reads as broken. Settle every part this turn added or moved onto the product,
   * parents first so children ride along, as one last batch of updates.
   */
  const settle = async (result: TurnResult): Promise<TurnResult> => {
    if (!touched.size) return result;
    // New pull cords and charms hang straight down, whatever the tilt of what they hang from.
    // (Edits only: in a new design a slanted rope, like a balloon basket's, is usually meant.)
    const hung = fresh ? [] : hangCords(product, [...added].filter((id) => product.parts[id]));
    if (hung.length) {
      console.log(`[brain] re-hung ${hung.map((u) => u.id).join(", ")}`);
      applyAndEmit(hung);
    }
    // New parts don't inherit a parent's squash (a flattened flower center shearing its petals).
    // Template parts were made with their squashes in mind: only what the model wrote is lifted.
    const tpl = input.template ? templateById(input.template) : fresh ? matchTemplate(input.text) : null;
    const tplIds = new Set(tpl?.parts.map((x) => x.id) ?? []);
    const lifted = unshear(product, [...added].filter((id) => product.parts[id] && !tplIds.has(id)), (w, u) => applyPatches(w, [u]).product);
    if (lifted.length) {
      console.log(`[brain] unsquashed ${lifted.length} part(s)`);
      applyAndEmit(lifted);
    }
    // New lettering sits on the surface it's written on, not buried inside it.
    const lettered = surfaceText(product, [...added].filter((id) => product.parts[id]));
    if (lettered.length) {
      console.log(`[brain] surfaced text ${lettered.map((u) => u.id).join(", ")}`);
      applyAndEmit(lettered);
    }
    const levels = (await settleLevels()) || hung.length > 0 || lettered.length > 0;
    const fixes: Patch[] = [];
    let work = product;
    // A reshaped part can strand its children (speakers on a hood that got deeper): check them too.
    const check = new Set([...touched].filter((id) => work.parts[id]).flatMap((id) => subtreeIds(work, id)));
    for (const part of partsInOrder(work)) {
      if (!check.has(part.id) || !floatingParts(work, [part.id]).length) continue;
      const position = groundPart(work, part.id);
      if (!position) continue;
      const fix: Patch = { op: "update", id: part.id, changes: { transform: { position } } };
      const r = applyPatches(work, [fix]);
      if (!r.applied.length) continue;
      work = r.product;
      fixes.push(fix);
    }
    if (!fixes.length) return levels ? { ...result, product, timing } : result;
    console.log(`[brain] settled ${fixes.length} floating part(s): ${fixes.map((f) => (f as { id: string }).id).join(", ")}`);
    applyAndEmit(fixes);
    timing.done = at();
    return { ...result, product, timing };
  };

  /**
   * Collision sense for levels (a bunk's upper deck, a shelf, a tabletop): one that slices through
   * the parts below it or hovers above its supports gets one repair call that sees the problem, then
   * a geometric fix for whatever is left: lift it clear, then stretch its posts up to meet it (or
   * drop it onto what's below when there are none). True when anything changed.
   */
  const settleLevels = async (): Promise<boolean> => {
    const issuesNow = () => levelIssues(product, [...touched].filter((id) => product.parts[id]));
    let issues = issuesNow();
    // Edits only: a new design has no "before", and its cushions tuck into each other on purpose.
    const collisions = fresh ? [] : newCollisions(input.product, product, [...touched].filter((id) => product.parts[id]));
    if (!issues.length && !collisions.length) return false;
    const before = product;
    console.log(`[brain] geometry issues: ${[...issues, ...collisions].map(describeIssue).join(" | ")}`);
    if (client && !signal.aborted) {
      try {
        const user = [
          editContext({ ...input, product, selection: null, outline: outlineOf(product) }),
          `\nThe shopper said: "${input.text}". The geometry check found problems in the result:`,
          ...[...issues, ...collisions].map((i) => `- ${describeIssue(i)}`),
          "\nFix only these with apply_patches: move a level up clear of what it cuts through (with real room underneath, e.g. sitting headroom under a bunk's upper deck), resize supports (posts, legs, ladders) so they meet the underside of what they hold, and move colliding parts apart (or resize them) so they don't pass through each other, whichever keeps the shopper's change. Keep everything else as is; say nothing new. Use at most 3 decimals.",
        ].join("\n");
        track(await streamTool(env.editModel, "apply_patches", user, {
          onItem: (k, _i, v) => {
            // Move and resize only: a repair never deletes the shopper's parts.
            if (k === "patches" && (v as { op?: unknown })?.op !== "remove") applyAndEmit([v]);
          },
        }, signal, 2500));
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn("[brain] level repair failed:", (err as Error).message);
      }
      issues = issuesNow();
    }
    for (let round = 0; issues.length && round < 3; round++) {
      const fixes: unknown[] = [];
      for (const i of issues) {
        const box = partBox(product, i.id);
        if (!box) continue;
        if (i.kind === "cuts") {
          const position = movedBy(product, i.id, [0, i.clearY - box.min[1], 0]);
          if (position) fixes.push({ op: "update", id: i.id, changes: { transform: { position } } });
          continue;
        }
        if (i.kind !== "hovers") continue;
        const sink = Math.min(0.2 * (box.max[1] - box.min[1]), 0.01);
        // Posts under it: stretch the ones that can be, and never drop it back (that undoes a "raise").
        const stretched = i.posts.flatMap((id) => stretchUp(product, id, i.gap + sink) ?? []);
        if (i.posts.length) fixes.push(...stretched);
        else {
          const position = movedBy(product, i.id, [0, sink - i.gap, 0]);
          if (position) fixes.push({ op: "update", id: i.id, changes: { transform: { position } } });
        }
      }
      if (!fixes.length) break;
      console.log(`[brain] level fix: ${issues.map(describeIssue).join(" | ")}`);
      applyAndEmit(fixes);
      issues = issuesNow();
    }
    if (product === before) return false;
    timing.done = at();
    return true;
  };

  // A showpiece (shared/templates/demo.ts) is already the finished design: its first build is used as is.
  const showpiece = isEmpty(input.product) || input.template ? (input.template ? templateById(input.template) : matchTemplate(input.text)) : null;
  if (!client || forceRules || showpiece?.match) return ruleTurn(input, applyAndEmit, applyMeta, emit, timing, at, () => product, reset);

  try {
    // A freshly shown template is still a new design: the fast planner customizes it.
    let mode: "create" | "edit" = isEmpty(product) || input.template ? "create" : "edit";
    if (mode === "edit") {
      emit({ t: "start", mode, model: env.editModel });
      let wantsNew = false;
      const user = [historyBlock(input.transcript), editContext(input), `\nShopper just said: "${input.text}"`, "\nCall apply_patches now, with no other text. Use at most 3 decimals."].join("\n");
      const outlineById = new Map(input.outline.map((o) => [o.id, o]));
      // Parts updated earlier in this stream: their outline boxes (from the turn's start) are stale.
      const moved = new Set<string>();
      const sink: OutfitSink = {
        product: () => product,
        apply: (p) => applyAndEmit(p),
        setFashion: (f) => setFashion(f),
      };
      timing.sent = at();
      track(await streamTool(env.editModel, "apply_patches", user, {
        onFirstToken: () => (timing.firstToken ??= at()),
        // If the model answered in words instead of the tool, at least say it.
        onText: (t, called) => {
          if (!called && !say) {
            say = clampSay(t);
            emit({ t: "say", text: say });
          }
        },
        onValue: (k, v) => {
          if (k === "newDesign" && v === true) wantsNew = true;
          else if (k === "controls" && !wantsNew) applyControls(sink, v);
          else if (k === "materials" && !wantsNew) applyMaterials(sink, v);
          else if (k === "meta") applyMeta(v);
          else if (k === "say" && typeof v === "string") {
            say = clampSay(v);
            emit({ t: "say", text: say });
          } else if (k === "lock") lock = v === true;
        },
        onItem: (k, _i, v) => {
          if (wantsNew) return;
          if (k === "modules") {
            const why = applyModule(sink, v);
            if (why) console.log(`[brain] module skipped: ${why}`);
            return;
          }
          if (k === "remove" && typeof v === "string") return applyAndEmit([{ op: "remove", id: v }]);
          if (k !== "patches") return;
          const up = v as { op?: unknown; id?: unknown };
          if (up?.op === "update" && typeof up.id === "string") moved.add(up.id);
          applyAndEmit([fixFrames(product, v, outlineById, moved)]);
        },
      }, signal, 4000));
      if (!wantsNew) {
        timing.done = at();
        return await settle({ product, say, lock, brain: "llm", timing, rejected });
      }
      // A different product entirely: start over.
      reset();
      mode = "create";
      say = "";
    }
    const ctx: CreateCtx = { reset, emit, applyAndEmit, applyMeta, setFashion, track, timing, at, signal, get: () => product, set: (p) => (product = p), setSay: (s) => (say = s), setLock: (l) => (lock = l), getSay: () => say, getLock: () => lock, rejected: () => rejected };
    const shownTpl = input.template ? templateById(input.template) : null;
    const fashion = fashionById(shownTpl?.fashion ?? (isEmpty(product) ? matchTemplate(input.text)?.fashion : undefined));
    if (fashion) return await createOutfit(input, ctx, fashion);
    return await settle(await createDesign(input, ctx));
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn("[brain] LLM failed, using rules:", (err as Error).message);
    return ruleTurn(input, applyAndEmit, applyMeta, emit, timing, at, () => product, reset);
  }
}

interface CreateCtx {
  /** Clear the stage (the client too). */
  reset: () => void;
  emit: (ev: TurnEvent) => void;
  applyAndEmit: (patches: unknown[]) => void;
  applyMeta: (raw: unknown) => void;
  setFashion: (f: FashionState) => void;
  track: (s: CallStats) => void;
  timing: TurnTiming;
  at: () => number;
  signal: AbortSignal;
  get: () => Product;
  set: (p: Product) => void;
  setSay: (s: string) => void;
  setLock: (l: boolean) => void;
  getSay: () => string;
  getLock: () => boolean;
  rejected: () => number;
}

/**
 * A new fashion product: the template (in the look the local style compiler picked) is on screen;
 * one fast call re-styles it with controls, slot materials and detail modules, streamed as patches.
 */
async function createOutfit(input: TurnInput, c: CreateCtx, t: FashionTemplate): Promise<TurnResult> {
  c.emit({ t: "start", mode: "create", model: env.designModel });
  // Not on screen yet (the server matched the wish itself): build the local styled version first.
  if (c.get().fashion?.template !== t.id) {
    const local = outfitProduct(localOutfit(input.text, t.id), c.get().id);
    if (local) {
      if (!isEmpty(c.get())) c.reset();
      c.applyAndEmit(addOrder(Object.values(local.parts), local.rootId).map((part) => ({ op: "add", part })));
      if (local.fashion) c.setFashion(local.fashion);
      c.applyMeta({ title: t.name, category: t.category, description: t.description, targetPriceUsd: t.targetPriceUsd });
    }
  }
  const sink: OutfitSink = { product: c.get, apply: (p) => c.applyAndEmit(p), setFashion: c.setFashion };
  const user = [
    historyBlock(input.transcript),
    `Shopper's wish: "${input.text}"`,
    wishStyleLine(input.text),
    `\nOn screen now (the template in a first local styling):\n${outfitContext(c.get())}`,
    `\nRestyle it to match the wish exactly: change controls and slot materials where the wish or its styles call for it, remove standard details that don't fit (remove), and add detail modules on zones so the result has 8-15 rich, style-specific details in total (count what is already there). Write controls, then materials, then remove, then modules, then meta and say. Use at most 3 decimals. Call style_outfit now, with no other text.`,
  ].filter(Boolean).join("\n");
  c.timing.sent = c.at();
  const stats = await streamTool(env.designModel, "style_outfit", user, {
    onFirstToken: () => (c.timing.firstToken ??= c.at()),
    onValue: (k, v) => {
      if (k === "controls") applyControls(sink, v);
      else if (k === "materials") applyMaterials(sink, v);
      else if (k === "meta") c.applyMeta(v);
      else if (k === "say" && typeof v === "string") {
        c.setSay(clampSay(v));
        c.emit({ t: "say", text: clampSay(v) });
      } else if (k === "lock") c.setLock(v === true);
    },
    onItem: (k, _i, v) => {
      if (k === "remove" && typeof v === "string") c.applyAndEmit([{ op: "remove", id: v }]);
      else if (k === "modules") {
        const why = applyModule(sink, v);
        if (why) console.log(`[brain] module skipped: ${why}`);
      }
    },
  }, c.signal, 2500);
  c.track(stats);
  c.timing.done = c.at();
  return { product: c.get(), say: c.getSay(), lock: c.getLock(), brain: "llm", timing: c.timing, rejected: c.rejected() };
}

async function createDesign(input: TurnInput, outer: CreateCtx): Promise<TurnResult> {
  // Builders share a child abort signal, so a failed planner (or a cancelled turn) stops them too.
  const builderAbort = new AbortController();
  const stop = () => builderAbort.abort();
  outer.signal.addEventListener("abort", stop, { once: true });
  const c: CreateCtx = { ...outer, signal: builderAbort.signal };
  try {
    return await createDesignInner(input, c);
  } catch (err) {
    stop();
    throw err;
  } finally {
    outer.signal.removeEventListener("abort", stop);
  }
}

async function createDesignInner(input: TurnInput, c: CreateCtx): Promise<TurnResult> {
  c.emit({ t: "start", mode: "create", model: env.designModel });
  const builders: Promise<void>[] = [];
  const groups: { id: string; brief: string }[] = [];
  let meta: ProductMeta = {};
  let root: Part | null = null;
  const pendingGroups: { id: string; brief: string }[] = [];

  const startGroup = (g: { id: string; brief: string }) => {
    const rootNow = c.get().parts[c.get().rootId];
    if (!rootNow) {
      pendingGroups.push(g);
      return;
    }
    const user = [
      `You are one of several builders working in parallel on a new product.`,
      `Product: ${meta.title ?? "(untitled)"} — ${meta.description ?? input.text}`,
      `Shopper's wish: "${input.text}"`,
      `Root part (already built):\n${JSON.stringify(compactPart(rootNow))}`,
      faceGuide(rootNow),
      `Other builders are doing these groups (do NOT build them): ${groups.filter((x) => x.id !== g.id).map((x) => `${x.id}: ${x.brief}`).join(" | ") || "(more coming)"}`,
      `\nYOUR GROUP "${g.id}": ${g.brief}`,
      `Use part ids starting with "${g.id}_". Parent your parts to "${rootNow.id}" or to your own parts: a part that sits on another of your parts (a panel on a sloped roof, a lens on a camera) is that part's child, positioned in its frame, so it inherits the tilt. Every part must touch the part it is attached to: compute positions from the face coordinates above, never guess. Add 3-5 detailed parts (bigger pieces first, then hardware and trims). Use at most 3 decimals. Call add_parts now, with no other text.`,
    ].join("\n");
    const t0 = c.at();
    let ttft = 0;
    let n = 0;
    builders.push(
      streamTool(env.designModel, "add_parts", user, {
        onFirstToken: () => {
          ttft = c.at() - t0;
          c.timing.firstToken ??= c.at();
        },
        onItem: (k, _i, v) => {
          if (k === "patches") {
            n++;
            c.applyAndEmit([v]);
          }
        },
      }, c.signal, 3500).then((st) => {
        if (process.env.BRAIN_TRACE) console.log(`[trace] group ${g.id} start ${t0}ms ttft ${ttft}ms end ${c.at()}ms parts ${n} out ${st.output}`);
        c.track(st);
      }),
    );
  };

  const shown = input.template && !isEmpty(c.get()) ? templateById(input.template) : undefined;
  const guess = shown ?? matchTemplate(input.text);
  const user = [
    historyBlock(input.transcript),
    `Shopper's wish: "${input.text}"`,
    shown
      ? `\nThe "${shown.id}" template is already on screen. Set template to "${shown.id}" and customize it, or set template null and write a root if it really doesn't fit.\n${templateOutline(shown.id)}`
      : guess ? `\nThe "${guess.id}" template likely fits.\n${templateOutline(guess.id)}` : "",
    `\nDesign this product. If a template fits, set template and customize it with patches that BUILD every feature the wish names right now (add the parts, attached to the template's parts by id), never just promise them; otherwise write the root body first, then 5-8 terse groups. Use at most 3 decimals. Call plan_design now, with no other text.`,
  ].filter(Boolean).join("\n");
  c.timing.sent = c.at();
  const planStats = await streamTool(env.designModel, "plan_design", user, {
    onFirstToken: () => (c.timing.firstToken ??= c.at()),
    onValue: (k, v) => {
      if (k === "template" && typeof v === "string") {
        const tpl = templateById(v);
        // Unknown id: ignore it (keep what's on screen). Already on screen: nothing to do.
        if (!tpl || tpl === shown) return;
        if (!isEmpty(c.get())) c.reset();
        const p = templateProduct(tpl, c.get().id);
        c.applyAndEmit(addOrder(Object.values(p.parts), p.rootId).map((part) => ({ op: "add", part })));
        c.applyMeta({ title: tpl.name, category: tpl.category, description: tpl.description, targetPriceUsd: tpl.targetPriceUsd });
      } else if (k === "meta") {
        meta = { ...meta, ...(v as ProductMeta) };
        c.applyMeta(v);
      } else if (k === "root" && v && typeof v === "object") {
        root = { ...(v as Part), parent: null };
        if (!isEmpty(c.get())) c.reset();
        c.applyAndEmit([{ op: "add", part: root }]);
        for (const g of pendingGroups.splice(0)) startGroup(g);
      } else if (k === "say" && typeof v === "string") {
        c.setSay(clampSay(v));
        c.emit({ t: "say", text: clampSay(v) });
      } else if (k === "lock") c.setLock(v === true);
    },
    onItem: (k, _i, v) => {
      if (k === "patches") c.applyAndEmit([v]);
      else if (k === "groups" && v && typeof v === "object") {
        const g = v as { id?: string; brief?: string };
        if (!g.brief) return;
        const grp = { id: String(g.id ?? `g${groups.length + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 16), brief: g.brief };
        groups.push(grp);
        startGroup(grp);
      }
    },
  }, c.signal, 6000);
  c.track(planStats);
  if (process.env.BRAIN_TRACE) console.log(`[trace] plan done ${c.at()}ms out ${planStats.output} groups ${groups.length}`);
  await Promise.allSettled(builders);
  c.timing.done = c.at();
  if (isEmpty(c.get())) throw new Error("planner produced no parts");
  // The reply comes last in the plan: a long template customization can run out before it.
  if (!c.getSay()) {
    const s = `Here's your ${(c.get().title || "wish").toLowerCase()}. What would you change?`;
    c.setSay(s);
    c.emit({ t: "say", text: s });
  }
  return { product: c.get(), say: c.getSay(), lock: c.getLock(), brain: "llm", timing: c.timing, rejected: c.rejected() };
}

/**
 * A new part whose position was written in product space instead of its parent's frame lands far
 * from the parent: move it to where the model meant (see fixChildFrame). Raw patches, pre-validation.
 */
function fixFrames(product: Product, raw: unknown, outline: Map<string, OutlineEntry>, moved: Set<string>): unknown {
  const patch = raw as { op?: unknown; part?: { parent?: unknown; transform?: { position?: unknown } } };
  const parent = patch?.op === "add" && typeof patch.part?.parent === "string" ? patch.part.parent : null;
  const pos = patch?.part?.transform?.position;
  const bounds = parent ? outline.get(parent) : undefined;
  if (!parent || !bounds || !Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => typeof n === "number")) return raw;
  for (let id: string | null | undefined = parent, hops = 0; id && hops < 50; id = product.parts[id]?.parent, hops++) if (moved.has(id)) return raw;
  const fixed = fixChildFrame(product, parent, pos as Vec3, bounds);
  if (!fixed) return raw;
  if (process.env.BRAIN_TRACE) console.log(`[trace] frame fix: ${parent} child at [${pos.join(",")}] -> [${fixed.join(",")}]`);
  return { ...patch, part: { ...patch.part, transform: { ...patch.part!.transform, position: fixed } } };
}

/** Gravity in a tilted part's own frame (a unit vector), for hanging things off it; nothing when it's upright. */
function downIn(product: Product, id: string): { down?: Vec3 } {
  const a = toPartSpace(product, id, [0, 0, 0]), b = toPartSpace(product, id, [0, -1, 0]);
  const v = b.map((x, i) => x - a[i]);
  const n = Math.hypot(...v) || 1;
  const down = v.map((x) => r3(x / n)) as Vec3;
  return Math.abs(down[0]) < 0.02 && Math.abs(down[2]) < 0.02 && down[1] < 0 ? {} : { down };
}

/** Product-space boxes for every part, like the client's outline. */
function outlineOf(product: Product): OutlineEntry[] {
  return Object.keys(product.parts).flatMap((id) => {
    const b = partBox(product, id);
    return b ? [{ id, center: b.min.map((v, i) => r3((v + b.max[i]) / 2)) as Vec3, size: b.max.map((v, i) => r3(v - b.min[i])) as Vec3 }] : [];
  });
}

function describeIssue(i: LevelIssue): string {
  if (i.kind === "cuts") return `${i.id} cuts through ${i.others.join(", ")}: its underside must be above y=${r3(i.clearY)}`;
  if (i.kind === "hovers") return `${i.id} hovers ${r3(i.gap)} m above ${i.below.join(", ")}, with nothing holding it up`;
  return `${i.id} runs into ${i.other} (their boxes share ${Math.round(i.share * 100)}% of the smaller one)`;
}

/** The voice rule, enforced: at most two sentences. */
function clampSay(s: string): string {
  const sentences = s.replace(/\s+/g, " ").replace(/[—–]/g, ", ").trim().match(/[^.!?]+[.!?]*/g) ?? [s];
  return sentences.slice(0, 2).join(" ").trim();
}

/** Offline genie: templates for new wishes, the fast path for tweaks, a friendly line otherwise. */
function ruleTurn(
  input: TurnInput,
  applyAndEmit: (p: unknown[]) => void,
  applyMeta: (m: unknown) => void,
  emit: (ev: TurnEvent) => void,
  timing: TurnTiming,
  at: () => number,
  current: () => Product,
  reset: () => void,
): TurnResult {
  const product = current();
  // A template the client already shows (a fresh wish) is still a new design.
  const shown = input.template ? templateById(input.template) : undefined;
  emit({ t: "start", mode: isEmpty(product) || shown ? "create" : "edit", model: "rules" });
  let say: string;
  const lock = /\b(lock it|wish it|make it real|yes,? make)\b/i.test(input.text);
  const tpl = shown ?? matchTemplate(input.text);
  if (tpl && (shown || isEmpty(product) || /\b(instead|actually|new)\b/i.test(input.text))) {
    // Fashion templates come styled for the wish (the client shows the same local styling).
    const p = (tpl.fashion ? outfitProduct(localOutfit(input.text, tpl.fashion), product.id) : null) ?? templateProduct(tpl, product.id);
    // The shown template may already be intact (possibly with some customizations streamed in).
    const intact = shown && product.rootId === p.rootId && Object.keys(p.parts).every((id) => product.parts[id]);
    if (!intact) {
      const adds = addOrder(Object.values(p.parts), p.rootId).map((part) => ({ op: "add", part }));
      // Build the template on an empty stage, on both sides, so ids and parents match exactly.
      if (!isEmpty(product)) reset();
      applyAndEmit(adds);
      applyMeta({ title: tpl.name, category: tpl.category, description: tpl.description, targetPriceUsd: tpl.targetPriceUsd });
      if (p.fashion) emit({ t: "fashion", fashion: p.fashion });
    }
    say = `Your ${tpl.name.toLowerCase()} is taking shape. Tap any part to change it.`;
  } else if (lock) {
    say = "Your wish is sealed. Let's see if anyone has made it already.";
  } else {
    say = isEmpty(product)
      ? "My magic is resting right now, but try a backpack, a lamp, a helmet or a mug."
      : "Tap a part and tell me a color, a material, or bigger or smaller.";
  }
  emit({ t: "say", text: say });
  timing.done = at();
  return { product: current(), say, lock, brain: "rules", timing, rejected: 0 };
}

let lastActivity = Date.now();
/** Mark genie activity (keeps the prompt cache warm while people are around). */
export const touchBrain = () => (lastActivity = Date.now());

/**
 * Keep the cached system prompt alive between wishes: the cache lives 5 minutes, so re-read it
 * every 4.5 minutes, but only within an hour of real activity (a cache read costs a tenth of input).
 */
export function keepWarm(): void {
  setInterval(() => {
    if (Date.now() - lastActivity < 60 * 60_000) void prewarm(true);
  }, 270_000).unref();
}

/** Warm the prompt cache at boot so the first real wish doesn't pay the cold prefill. */
export async function prewarm(quiet = false): Promise<void> {
  if (!client) return;
  // Both models at once: the first wish after a restart shouldn't wait on two round trips in a row.
  await Promise.all([...new Set([env.designModel, env.editModel])].map(async (model) => {
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 0,
        system: [{ type: "text", text: system(), cache_control: { type: "ephemeral" } }],
        tools: TOOLS as unknown as Anthropic.Tool[],
        messages: [{ role: "user", content: "warm" }],
        // max_tokens 0 rejects forced tool use; tool_choice isn't part of the cached prefix anyway.
        tool_choice: { type: "auto" },
        ...(model.includes("sonnet") ? { thinking: { type: "disabled" } } : {}),
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
      if (!quiet) console.log(`[brain] cache warm ${model}: wrote ${r.usage.cache_creation_input_tokens ?? 0}, read ${r.usage.cache_read_input_tokens ?? 0} tokens`);
    } catch (err) {
      console.warn(`[brain] prewarm ${model} failed:`, (err as Error).message);
    }
  }));
}
