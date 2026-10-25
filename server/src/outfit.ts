import {
  MaterialSchema, classifyWish, fashionById, fashionTemplates, kitById, placeModules, productZones, refitPatches, resolveControls, resolveSlots, slotPatches, stylePromptBlock,
  type FashionState, type ModulePlacement, type Part, type PartMaterial, type Patch, type Product,
} from "@wishit/shared";

/**
 * The genie's fashion vocabulary: outfit fields on its tools (controls, slot materials, detail
 * modules on zones), the template catalog for the cached system prompt, the per-turn outfit
 * summary, and turning streamed outfit fields into ordinary patches.
 */

const materialSchema = {
  type: "object",
  properties: { preset: { type: "string" }, color: { type: "string" }, roughness: { type: "number" }, metalness: { type: "number" } },
  required: ["preset", "color"],
};

/** Outfit fields shared by style_outfit (new fashion designs) and apply_patches (fashion edits). */
export const outfitProps = {
  controls: { type: "object", description: "Fashion only. Control name -> option, only controls that change (e.g. {\"length\":\"cropped\",\"fit\":\"oversized\"})." },
  materials: { type: "object", description: "Fashion only. Slot name -> material {preset,color}, only slots that change (e.g. {\"shell\":{\"preset\":\"leather\",\"color\":\"#1A1A1D\"},\"hardware\":{\"preset\":\"metal_polished\",\"color\":\"#C0C4CC\"}}).", additionalProperties: materialSchema },
  remove: { type: "array", items: { type: "string" }, description: "Fashion only. Ids of detail parts to take off." },
  modules: {
    type: "array",
    description: "Fashion only. Detail modules to add, each on a template zone.",
    items: {
      type: "object",
      properties: {
        module: { type: "string", description: "Kit id of the module." },
        zone: { type: "string", description: "Zone name, or name@0.3 (point along a path zone), name~0.01,-0.02 (shifted right/up in meters), or a wildcard like pocket_* for both sides." },
        params: { type: "object", description: "Module kitParams (numbers or enum option names). count = copies spread along a path zone." },
        material: { description: "A slot name (\"hardware\", \"thread\", \"accent\"...) or a material {preset,color}." },
        name: { type: "string" },
        id: { type: "string" },
      },
      required: ["module", "zone"],
    },
  },
} as const;

// ---------- Prompt text ----------

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Every fashion template: controls, material slots and zones (for the cached system prompt). */
export function fashionCatalog(): string {
  return fashionTemplates()
    .map((t) => {
      const controls = Object.entries(t.controls).map(([k, c]) => `${k} ${c.options.join("|")} (default ${c.default})`).join("; ");
      const slots = Object.entries(t.slots).map(([k, s]) => `${k} (${s.description}; default ${s.default.preset} ${s.default.color})`).join("; ");
      const zones = Object.entries(t.zones(resolveControls(t)))
        .map(([k, z]) => `${k}${z.path ? " (path)" : ""}${z.room ? ` room ${r3(z.room[0])}x${r3(z.room[1])}` : ""}`)
        .join(", ");
      const standard = t.modules.map((m) => `${m.module}@${m.zone}`).join(", ");
      return `- ${t.id} (${t.category}; kind ${t.kind}): ${t.description}\n  controls: ${controls}\n  slots: ${slots}\n  zones: ${zones}\n  standard details: ${standard || "none"}`;
    })
    .join("\n");
}

/** The current outfit, for the per-turn prompt: controls, slots, and every detail part by zone. */
export function outfitContext(product: Product): string {
  const t = fashionById(product.fashion?.template);
  if (!t || !product.fashion) return "";
  const f = product.fashion;
  const slots = resolveSlots(t, f.slots);
  const lines = [
    `Fashion template "${t.id}". Controls: ${Object.entries(f.controls).map(([k, v]) => `${k}=${v}`).join(", ")}${f.styles?.length ? `. Styles: ${f.styles.join(", ")}` : ""}.`,
    `Slots: ${Object.entries(slots).map(([k, m]) => `${k}=${m.preset} ${m.color}`).join(", ")}.`,
    `Detail parts (id: module on zone):`,
  ];
  for (const p of Object.values(product.parts)) {
    if (p.kind !== "kit" || !p.zone) continue;
    const params = p.kitParams && Object.keys(p.kitParams).length ? ` ${JSON.stringify(p.kitParams)}` : "";
    lines.push(`- ${p.id}: ${p.kitAsset} on ${p.zone}${params} ${p.material.preset} ${p.material.color}`);
  }
  const zones = productZones(product);
  if (zones) lines.push(`Zones now: ${Object.entries(zones).map(([k, z]) => `${k} (${z.label}${z.path ? ", path" : ""}) on ${z.part}`).join("; ")}`);
  return lines.join("\n");
}

// ---------- Applying streamed outfit fields ----------

export interface OutfitSink {
  product: () => Product;
  apply: (patches: Patch[]) => void;
  setFashion: (f: FashionState) => void;
}

const asMaterial = (v: unknown): Partial<PartMaterial> | null => {
  if (!v || typeof v !== "object") return null;
  const m = MaterialSchema.partial().safeParse(v);
  return m.success ? (m.data as Partial<PartMaterial>) : null;
};

/** Control changes: re-cut the garment and move every zone detail with it. */
export function applyControls(sink: OutfitSink, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const controls: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") controls[k] = v;
  const r = refitPatches(sink.product(), controls);
  if (!r) return;
  sink.apply(r.patches);
  sink.setFashion(r.fashion);
}

/** Slot materials: every part in (or still wearing) the slot's material. */
export function applyMaterials(sink: OutfitSink, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  for (const [slot, v] of Object.entries(raw)) {
    const m = asMaterial(v);
    if (!m) continue;
    const r = slotPatches(sink.product(), slot, m);
    if (!r) continue;
    sink.apply(r.patches);
    sink.setFashion(r.fashion);
  }
}

/** One detail module streamed in: placed on its zone and added (as parts) right away. */
export function applyModule(sink: OutfitSink, raw: unknown): string | null {
  const product = sink.product();
  const t = fashionById(product.fashion?.template);
  if (!t || !product.fashion || !raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.module !== "string" || typeof m.zone !== "string" || !kitById(m.module)) return `unknown module ${String(m.module)}`;
  const material = typeof m.material === "string" ? m.material : asMaterial(m.material);
  const placement: ModulePlacement = {
    module: m.module,
    zone: m.zone,
    ...(m.params && typeof m.params === "object" ? { params: m.params as Record<string, number | string> } : {}),
    ...(material && typeof material === "object" && material.preset && material.color ? { material: material as PartMaterial } : typeof material === "string" ? { material } : {}),
    ...(typeof m.name === "string" ? { name: m.name } : {}),
    ...(typeof m.id === "string" ? { id: m.id } : {}),
  };
  const zones = t.zones(product.fashion.controls);
  const slots = resolveSlots(t, product.fashion.slots);
  const { parts, skipped, replaced } = placeModules(t, zones, [placement], slots, new Set(Object.keys(product.parts)), Object.values(product.parts));
  // The same module already on that zone is replaced, not doubled (a new set of placket buttons).
  const patches: Patch[] = [...replaced.map((id): Patch => ({ op: "remove", id })), ...parts.map((part: Part): Patch => ({ op: "add", part }))];
  if (patches.length) sink.apply(patches);
  return skipped.length ? skipped.map((s) => s.reason).join("; ") : null;
}

/** The local classifier's read of the wish (styles, attributes), so the genie starts from it. */
export function wishStyleLine(text: string): string {
  const c = classifyWish(text);
  const attrs = Object.entries(c.attributes)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && v && !Array.isArray(v) && !Object.keys(v).length))
    .map(([k, v]) => `${k} ${JSON.stringify(v)}`)
    .join("; ");
  if (!c.styles.length && !attrs) return "";
  return `Local read of the wish: ${c.styles.length ? `styles ${c.styles.join(" > ")} (first wins)` : "no named style"}${c.template ? `, template ${c.template}` : ""}${attrs ? `; ${attrs}` : ""}.`;
}

/** The aesthetic style dictionary for the system prompt. */
export function styleBlock(): string {
  return stylePromptBlock();
}
