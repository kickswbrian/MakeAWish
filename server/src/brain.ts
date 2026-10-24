import Anthropic from "@anthropic-ai/sdk";
import {
  addOrder, applyPatches, childrenOf, emptyProduct, fixChildFrame, isEmpty, toProductSpace, matchTemplate, parseIntent, ProductMetaSchema, setMeta, templateById, templateProduct,
  type OutlineEntry, type Part, type Patch, type Product, type ProductMeta, type TurnEvent, type TurnSelection, type TurnTiming, type Vec3,
} from "@wishit/shared";
import { env } from "./env.ts";
import { JsonStreamScanner } from "./jsonstream.ts";
import { systemPrompt } from "./prompt.ts";
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

// ---------- Tools (all three are sent on every call so the cached prefix is identical) ----------

const partSchema = {
  type: "object",
  description: "A Part (see the system prompt for fields and conventions).",
  properties: {
    id: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["primitive", "kit"] },
    geometry: { type: "object" }, kitAsset: { type: "string" }, kitParams: { type: "object" },
    parent: { type: ["string", "null"] }, transform: { type: "object" }, material: { type: "object" }, csg: { type: "object" },
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
          description: "Only without a template: 5-8 groups of 3-5 parts each, biggest/most important first. Each group is built in parallel by a separate builder that sees only the root part and your brief.",
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
    name: "apply_patches",
    description: "Edit the current product with patches, then speak.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        newDesign: { type: "boolean", description: "True only if the shopper wants a different product entirely; then send no patches." },
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
  lines.push("\nFull JSON of the relevant parts (productOrigin: where the part's own frame origin sits in product space; a new child's position is in its PARENT's frame, so for a product-space point P on an unrotated parent X, position = (P - X.productOrigin) / X.transform.scale per axis):");
  for (const p of detail) lines.push(JSON.stringify({ ...compactPart(p), productOrigin: toProductSpace(product, p.id, [0, 0, 0]).map(r3) }));
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

interface CallStats { input: number; cached: number; output: number }

/** Stream one tool call; if the model fails before writing anything, retry once on the fallback model. */
async function streamTool(model: string, tool: string, user: string, h: CallHandlers, signal: AbortSignal, maxTokens: number): Promise<CallStats> {
  let wrote = false;
  const wrapped: CallHandlers = { ...h, onFirstToken: () => { wrote = true; h.onFirstToken?.(); } };
  try {
    return await streamToolOnce(model, tool, user, wrapped, signal, maxTokens);
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
  else if (!toolSeen) console.warn(`[brain] ${model} skipped the ${tool} tool`);
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
  const reset = () => {
    product = emptyProduct(product.id);
    emit({ t: "reset" });
  };
  const applyAndEmit = (patches: unknown[]) => {
    const r = applyPatches(product, patches);
    product = r.product;
    rejected += r.rejected.length;
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

  if (!client || forceRules) return ruleTurn(input, applyAndEmit, applyMeta, emit, timing, at, () => product, reset);

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
          else if (k === "meta") applyMeta(v);
          else if (k === "say" && typeof v === "string") {
            say = clampSay(v);
            emit({ t: "say", text: say });
          } else if (k === "lock") lock = v === true;
        },
        onItem: (k, _i, v) => {
          if (k !== "patches" || wantsNew) return;
          const up = v as { op?: unknown; id?: unknown };
          if (up?.op === "update" && typeof up.id === "string") moved.add(up.id);
          applyAndEmit([fixFrames(product, v, outlineById, moved)]);
        },
      }, signal, 4000));
      if (!wantsNew) {
        timing.done = at();
        return { product, say, lock, brain: "llm", timing, rejected };
      }
      // A different product entirely: start over.
      reset();
      mode = "create";
      say = "";
    }
    return await createDesign(input, { reset, emit, applyAndEmit, applyMeta, track, timing, at, signal, get: () => product, set: (p) => (product = p), setSay: (s) => (say = s), setLock: (l) => (lock = l), getSay: () => say, getLock: () => lock, rejected: () => rejected });
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
      `Other builders are doing these groups (do NOT build them): ${groups.filter((x) => x.id !== g.id).map((x) => `${x.id}: ${x.brief}`).join(" | ") || "(more coming)"}`,
      `\nYOUR GROUP "${g.id}": ${g.brief}`,
      `Use part ids starting with "${g.id}_". Parent your parts to "${rootNow.id}" or to your own parts. Add 3-5 detailed parts (bigger pieces first, then hardware and trims). Use at most 3 decimals. Call add_parts now, with no other text.`,
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
  }, c.signal, 3000);
  c.track(planStats);
  if (process.env.BRAIN_TRACE) console.log(`[trace] plan done ${c.at()}ms out ${planStats.output} groups ${groups.length}`);
  await Promise.allSettled(builders);
  c.timing.done = c.at();
  if (isEmpty(c.get())) throw new Error("planner produced no parts");
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
    const p = templateProduct(tpl, product.id);
    // The shown template may already be intact (possibly with some customizations streamed in).
    const intact = shown && product.rootId === p.rootId && Object.keys(p.parts).every((id) => product.parts[id]);
    if (!intact) {
      const adds = addOrder(Object.values(p.parts), p.rootId).map((part) => ({ op: "add", part }));
      // Build the template on an empty stage, on both sides, so ids and parents match exactly.
      if (!isEmpty(product)) reset();
      applyAndEmit(adds);
      applyMeta({ title: tpl.name, category: tpl.category, description: tpl.description, targetPriceUsd: tpl.targetPriceUsd });
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
  for (const model of new Set([env.designModel, env.editModel])) {
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
  }
}
