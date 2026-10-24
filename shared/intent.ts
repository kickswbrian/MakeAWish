import { COLOR_NAMES, MATERIAL_PRESETS, colorName, subtreeIds, type MaterialPreset, type Patch, type Part, type Product } from "./product.ts";

/**
 * The local fast path. Short, unambiguous edits ("make it red", "bigger", "leather", "remove this",
 * "make the straps black", "undo") are turned into patches right here, with no LLM call. Anything
 * with a word we don't understand returns null and goes to the genie.
 */

export type IntentKind = "color" | "material" | "finish" | "size" | "remove" | "undo" | "redo" | "view";

/** Camera and display commands, handled by the stage. */
export type ViewCommand = "front" | "back" | "left" | "right" | "top" | "bottom" | "zoom_in" | "zoom_out" | "spin" | "explode" | "assemble" | "reset";

export interface Intent {
  kinds: IntentKind[];
  patches: Patch[];
  /** Ids the edit touched (for sparkles and camera focus). */
  targets: string[];
  /** A short spoken/visible confirmation. */
  say: string;
  view?: ViewCommand;
}

export interface IntentContext {
  product: Product;
  selectedId?: string | null;
}

const FILLER = new Set(
  ("make it its it's the this that these those please a an bit little lot more much way slightly somewhat " +
    "can could would you i want like lets let's let us turn change color colour to be in into of so just now too really very " +
    "out whole thing entire product try go ok okay hey genie um uh and also then maybe kind sort ish all them they one " +
    "should look looks made paint painted have has is are was do give me instead rather actually same")
    .split(" "),
);

const MATERIAL_WORDS: [string, MaterialPreset, string?][] = [
  ["brushed metal", "metal_brushed"], ["brushed steel", "metal_brushed"], ["stainless steel", "metal_brushed"],
  ["polished metal", "metal_polished"], ["shiny metal", "metal_polished"], ["glossy plastic", "plastic_gloss"],
  ["shiny plastic", "plastic_gloss"], ["matte plastic", "plastic_matte"],
  ["leather", "leather"], ["leathery", "leather"], ["vegan leather", "leather"],
  ["wood", "wood"], ["wooden", "wood"], ["bamboo", "wood"], ["oak", "wood", "#B98B57"], ["walnut", "wood", "#5C3A21"],
  ["metal", "metal_brushed"], ["metallic", "metal_brushed"], ["steel", "metal_brushed"], ["aluminum", "metal_brushed"], ["aluminium", "metal_brushed"], ["titanium", "metal_brushed", "#8E9196"],
  ["chrome", "metal_polished", "#D8DCE2"], ["gold", "metal_polished", "#E2B13C"], ["golden", "metal_polished", "#E2B13C"], ["silver", "metal_polished", "#C0C4CC"],
  ["copper", "metal_polished", "#B87333"], ["bronze", "metal_polished", "#A97142"], ["brass", "metal_polished", "#C9A44C"],
  ["glass", "glass"], ["transparent", "glass"], ["clear", "glass"], ["see through", "glass"],
  ["rubber", "rubber"], ["rubbery", "rubber"], ["silicone", "rubber"],
  ["canvas", "canvas"], ["nylon", "nylon"], ["polyester", "nylon"], ["cotton", "cotton"], ["linen", "cotton"],
  ["knit", "knit"], ["knitted", "knit"], ["wool", "knit"], ["woolen", "knit"], ["woollen", "knit"],
  ["satin", "satin"], ["silk", "satin"], ["silky", "satin"], ["denim", "denim"], ["suede", "suede"], ["velvet", "suede"],
  ["concrete", "concrete"], ["cement", "concrete"], ["marble", "marble"], ["cork", "cork"],
  ["ceramic", "ceramic"], ["porcelain", "ceramic"], ["plastic", "plastic_matte"],
];

const FINISH_WORDS: [string, number][] = [
  ["shinier", 0.12], ["shiny", 0.12], ["glossy", 0.12], ["glossier", 0.12], ["polished", 0.1],
  ["matte", 0.85], ["matt", 0.85], ["duller", 0.85], ["dull", 0.85], ["satin finish", 0.4],
];

/** [phrase, x, y, z] scale multipliers. */
const SIZE_WORDS: [string, number, number, number][] = [
  ["twice as big", 2, 2, 2], ["double the size", 2, 2, 2], ["half the size", 0.5, 0.5, 0.5],
  ["bigger", 1.2, 1.2, 1.2], ["larger", 1.2, 1.2, 1.2], ["huge", 1.6, 1.6, 1.6], ["enormous", 1.8, 1.8, 1.8], ["enlarge", 1.2, 1.2, 1.2], ["grow", 1.2, 1.2, 1.2],
  ["smaller", 1 / 1.2, 1 / 1.2, 1 / 1.2], ["tiny", 0.6, 0.6, 0.6], ["shrink", 1 / 1.2, 1 / 1.2, 1 / 1.2], ["smaller", 1 / 1.2, 1 / 1.2, 1 / 1.2],
  ["wider", 1.2, 1, 1], ["broader", 1.2, 1, 1], ["narrower", 1 / 1.2, 1, 1], ["slimmer", 1 / 1.2, 1, 1 / 1.1],
  ["taller", 1, 1.2, 1], ["higher", 1, 1.2, 1], ["longer", 1, 1.2, 1], ["shorter", 1, 1 / 1.2, 1], ["lower", 1, 1 / 1.2, 1],
  ["thicker", 1.15, 1, 1.2], ["deeper", 1, 1, 1.2], ["chunkier", 1.15, 1.1, 1.15], ["thinner", 1 / 1.15, 1, 1 / 1.2], ["flatter", 1, 1 / 1.25, 1],
];
const AMPLIFY = ["much", "way", "lot", "really", "very", "super", "massively"];
const SOFTEN = ["bit", "little", "slightly", "tad", "touch", "somewhat"];

const VIEWS: [RegExp, ViewCommand, string][] = [
  [/^(?:show (?:me )?)?(?:the )?back(?: of it| side| view)?$|^turn it around$|^(?:show|let me see) (?:me )?(?:the )?back/, "back", "Here's the back."],
  [/^(?:show (?:me )?)?(?:the )?front(?: of it| view)?$|^face me$/, "front", "Front and center."],
  [/^(?:show (?:me )?)?(?:the )?left(?: side| view)?$/, "left", "Left side."],
  [/^(?:show (?:me )?)?(?:the )?right(?: side| view)?$|^(?:show (?:me )?)?(?:the |a )?side(?: view)?$/, "right", "Side view."],
  [/^(?:show (?:me )?)?(?:the )?top(?: of it| view)?$|^from above$|^bird'?s eye(?: view)?$/, "top", "From above."],
  [/^(?:show (?:me )?)?(?:the )?(?:bottom|underside)(?: of it)?$/, "bottom", "Underneath."],
  [/^zoom in$|^closer$|^get closer$/, "zoom_in", "Closer."],
  [/^zoom out$|^further$|^back up$/, "zoom_out", "Zooming out."],
  [/^(?:spin|rotate) it(?: around)?$|^give it a spin$|^spin$/, "spin", "Wheee."],
  [/^explode(?: it)?$|^(?:show|open) (?:me )?(?:all )?the parts$|^take it apart$|^exploded view$/, "explode", "Here's every part."],
  [/^(?:put it back together|assemble(?: it)?|close it up)$/, "assemble", "Back together."],
  [/^(?:reset|reset (?:the )?view|show (?:me )?(?:the )?whole thing|full view)$/, "reset", "The whole thing."],
];

const REMOVE_RE = /^(?:please )?(?:remove|delete|get rid of|take off|take away|lose|drop|ditch|no more)\b/;
const UNDO_RE = /^(?:undo|undo that|go back|revert|never ?mind|take that back|put it back)$/;
const REDO_RE = /^(?:redo|redo that|bring it back)$/;

function norm(text: string): string {
  return " " + text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9#' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Words that name each part, from its name and id ("Left shoulder strap", "strap_left"). */
function partWords(p: Part): Set<string> {
  const words = `${p.name} ${p.id.replace(/_/g, " ")}`.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return new Set(words.map(singular));
}

const IGNORED_PART_WORDS = new Set(["left", "right", "top", "bottom", "front", "back", "side", "main", "upper", "lower", "inner", "outer", "part", "piece", "small", "big"]);

export function parseIntent(text: string, ctx: IntentContext): Intent | null {
  const { product } = ctx;
  let t = norm(text);
  const bare = t.trim();
  if (UNDO_RE.test(bare)) return { kinds: ["undo"], patches: [], targets: [], say: "Undone." };
  if (REDO_RE.test(bare)) return { kinds: ["redo"], patches: [], targets: [], say: "Redone." };
  const viewText = bare.replace(/^(?:please |can you |could you |ok |okay |hey genie )+/, "").replace(/ please$/, "");
  for (const [re, view, say] of VIEWS) if (re.test(viewText)) return { kinds: ["view"], patches: [], targets: [], say, view };
  if (!product.rootId || !product.parts[product.rootId]) return null;
  // Long sentences are design requests, not quick tweaks.
  if (bare.split(" ").length > 9) return null;

  const take = (phrase: string): boolean => {
    const re = new RegExp(`\\s${phrase.replace(/ /g, "\\s")}\\s`);
    if (!re.test(t)) return false;
    t = t.replace(re, " ");
    return true;
  };

  const kinds: IntentKind[] = [];
  let remove = false;
  if (REMOVE_RE.test(bare)) {
    remove = true;
    t = " " + bare.replace(REMOVE_RE, "").trim() + " ";
    kinds.push("remove");
  }

  // Color: longest names first so "navy blue" beats "blue". Hex works too.
  let color: string | undefined;
  let preset: MaterialPreset | undefined;
  let finish: number | undefined;
  const hex = t.match(/\s#?([0-9a-f]{6})\s/);
  if (hex) {
    color = "#" + hex[1].toUpperCase();
    t = t.replace(hex[0], " ");
  }
  // Metallic color words imply the material too ("make it gold").
  for (const [w, p, c] of [...MATERIAL_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (take(w)) {
      preset ??= p;
      if (c && !color) color = c;
    }
  }
  if (!color) {
    for (const name of Object.keys(COLOR_NAMES).sort((a, b) => b.length - a.length)) {
      if (take(name)) {
        color = COLOR_NAMES[name];
        break;
      }
    }
  }
  for (const [w, r] of FINISH_WORDS) if (take(w)) finish = r;

  let scale: [number, number, number] | null = null;
  let sizeWord = "";
  for (const [w, x, y, z] of SIZE_WORDS) {
    if (take(w)) {
      scale = [(scale?.[0] ?? 1) * x, (scale?.[1] ?? 1) * y, (scale?.[2] ?? 1) * z];
      sizeWord ||= w;
    }
  }
  if (scale) {
    const amp = AMPLIFY.some((w) => t.includes(` ${w} `)) ? 1.6 : SOFTEN.some((w) => t.includes(` ${w} `)) ? 0.5 : 1;
    scale = scale.map((s) => Math.pow(s, amp)) as [number, number, number];
    for (const w of [...AMPLIFY, ...SOFTEN]) take(w);
  }

  // Named parts: "the straps", "the lid". Every remaining word must be a part word or filler.
  const index = Object.values(product.parts).filter((p) => !p.csg).map((p) => ({ p, words: partWords(p) }));
  const named = new Set<string>();
  const namedWords: string[] = [];
  const leftovers: string[] = [];
  for (const raw of t.trim().split(" ").filter(Boolean)) {
    if (FILLER.has(raw)) continue;
    const w = singular(raw);
    if (IGNORED_PART_WORDS.has(w)) continue;
    const hits = index.filter((x) => x.words.has(w));
    if (hits.length) {
      for (const h of hits) named.add(h.p.id);
      namedWords.push(raw);
    } else leftovers.push(raw);
  }
  // Positional words narrow a match ("left strap") when they appear in a part's name.
  const positional = t.split(" ").filter((w) => IGNORED_PART_WORDS.has(w));
  if (positional.length && !named.size) return null;
  if (named.size > 1 && positional.length) {
    const narrowed = [...named].filter((id) => positional.every((w) => partWords(product.parts[id]).has(w)));
    if (narrowed.length) {
      named.clear();
      for (const id of narrowed) named.add(id);
    }
  }
  if (leftovers.length) return null;
  if (!remove && !color && !preset && finish === undefined && !scale) return null;

  // Targets: named parts, else the selection, else the whole product.
  const selected = ctx.selectedId && product.parts[ctx.selectedId] ? ctx.selectedId : null;
  const whole = !named.size && !selected;
  let targets = named.size ? [...named] : selected ? [selected] : [product.rootId];

  const patches: Patch[] = [];
  if (remove) {
    targets = targets.filter((id) => id !== product.rootId);
    // Removing a parent takes its children; don't double-remove.
    const covered = new Set<string>();
    for (const id of targets) for (const s of subtreeIds(product, id)) if (s !== id) covered.add(s);
    targets = targets.filter((id) => !covered.has(id));
    if (!targets.length) return null;
    for (const id of targets) patches.push({ op: "remove", id });
    const n = targets.length;
    return { kinds, patches, targets, say: n === 1 ? `${product.parts[targets[0]].name} removed.` : `Removed ${n} parts.` };
  }

  // A whole-product recolor/material swap means the body: the root plus every part that shares its look.
  let paintTargets = targets;
  if (whole && (color || preset || finish !== undefined)) {
    const root = product.parts[product.rootId];
    paintTargets = Object.values(product.parts)
      .filter((p) => !p.csg && p.kind === "primitive" && p.material.color.toUpperCase() === root.material.color.toUpperCase() && p.material.preset === root.material.preset)
      .map((p) => p.id);
  }
  if (color || preset || finish !== undefined) {
    for (const id of paintTargets) {
      const material: Record<string, unknown> = {};
      if (color) material.color = color;
      if (preset) {
        material.preset = preset;
        // A material swap resets per-part finish overrides so the preset shows through.
        material.roughness = finish;
        material.metalness = undefined;
      } else if (finish !== undefined) material.roughness = finish;
      patches.push({ op: "update", id, changes: { material } });
    }
    if (color) kinds.push("color");
    if (preset) kinds.push("material");
    if (finish !== undefined) kinds.push("finish");
  }
  if (scale) {
    for (const id of targets) {
      const s = product.parts[id].transform.scale;
      const next = s.map((v, i) => +(v * scale![i]).toFixed(4)) as [number, number, number];
      patches.push({ op: "update", id, changes: { transform: { scale: next } } });
    }
    kinds.push("size");
  }

  // Echo the shopper's own words: "Gold pockets." "Longer." "Matte black strap."
  const noun = namedWords.length ? namedWords.join(" ") : selected ? product.parts[selected].name.toLowerCase() : "";
  const adj: string[] = [];
  if (finish !== undefined) adj.push(finish < 0.5 ? "glossy" : "matte");
  if (color) adj.push(colorName(color));
  // A metallic color word ("gold") already says the material.
  if (preset && !(color && MATERIAL_WORDS.some(([w, p, c]) => p === preset && c && colorName(c) === colorName(color)))) adj.push(PRESET_LABEL[preset] ?? preset);
  const phrases: string[] = [];
  if (adj.length) phrases.push(`${adj.join(" ")}${noun ? ` ${noun}` : ""}`);
  if (scale) phrases.push(`${sizeWord}${noun && !adj.length ? ` ${noun}` : ""}`);
  const say = `${capitalize(phrases.join(", "))}.`;
  return { kinds, patches, targets: color || preset || finish !== undefined ? paintTargets : targets, say };
}

const PRESET_LABEL: Partial<Record<MaterialPreset, string>> = {
  metal_brushed: "brushed metal", metal_polished: "polished metal", plastic_matte: "matte plastic", plastic_gloss: "glossy plastic",
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const MATERIAL_LABELS: Record<MaterialPreset, string> = Object.fromEntries(
  MATERIAL_PRESETS.map((p) => [p, PRESET_LABEL[p] ?? p.replace(/_/g, " ")]),
) as Record<MaterialPreset, string>;
