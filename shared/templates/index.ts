import { applyPatches, emptyProduct, type Part, type Product } from "../product.ts";
import { ALL_TEMPLATES } from "./all.ts";

/**
 * Hand-built starting designs. When a wish matches one, it appears instantly (no LLM wait) and the
 * genie customizes it with patches. Each template is real-world sized in meters.
 */
export interface Template {
  id: string;
  name: string;
  /** Words that select this template ("rucksack" -> backpack). Lowercase, singular. */
  keywords: string[];
  category: string;
  description: string;
  targetPriceUsd: number;
  parts: Part[];
  /** Built from this fashion template (see shared/fashion): controls, zones and detail modules apply. */
  fashion?: string;
  /** Picks this template wherever it matches the whole wish, before the keyword rules (demo showpieces). */
  match?: RegExp;
}

export const TEMPLATES: Template[] = [...ALL_TEMPLATES];

export function registerTemplates(list: Template[]) {
  for (const t of list) {
    const i = TEMPLATES.findIndex((x) => x.id === t.id);
    // Fashion templates replace a hand-built one with the same id; their keywords win too.
    if (i >= 0) TEMPLATES.splice(i, 1);
    if (t.fashion) {
      const words = new Set(t.keywords);
      for (const x of TEMPLATES) if (!x.fashion) x.keywords = x.keywords.filter((k) => !words.has(k));
      TEMPLATES.unshift(t);
    } else TEMPLATES.push(t);
  }
}

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** Build a product from a template (validated through the normal patch path). */
export function templateProduct(t: Template, id = "draft"): Product {
  const base = { ...emptyProduct(id), title: t.name, category: t.category, description: t.description, targetPriceUsd: t.targetPriceUsd };
  const product = applyPatches(base, t.parts.map((part) => ({ op: "add", part }))).product;
  if (t.fashion) product.fashion = { template: t.fashion, controls: fashionDefaults(t.fashion) };
  return product;
}

/** Default control values of a fashion template (set by shared/fashion at load). */
let fashionDefaults: (id: string) => Record<string, string> = () => ({});
export function setFashionDefaults(fn: (id: string) => Record<string, string>): void {
  fashionDefaults = fn;
}

/** Words that may follow the product noun without making it a modifier ("a backpack made of cork", "a mug now"). */
const TRAILING = new Set([
  "made", "in", "of", "from", "and", "or", "like", "please", "built", "designed", "styled", "style", "colored", "coloured",
  "version", "edition", "i", "we", "you", "it", "is", "thats", "one", "idea", "concept", "design",
  "now", "too", "thanks", "thank", "today", "again", "right", "ok", "okay", "yes", "real", "quick", "quickly", "asap", "there", "here",
]);
/**
 * Catch-all words ("plush", "stuffed animal") only mean the teddy when nothing else is named: "a cute
 * plush" is a teddy, "a sonic the hedgehog plush" or "a frog plushie" is its own design, which the
 * teddy's bear ears and muzzle would spoil.
 */
const GENERIC = new Set(["plush", "plushie", "stuffed animal", "soft toy"]);
const PLAIN = new Set([
  "", "|", "a", "an", "the", "my", "some", "one", "two", "three", "cute", "soft", "big", "giant", "huge", "little", "small", "tiny", "mini", "fluffy",
  "cuddly", "squishy", "fuzzy", "plush", "classic", "new", "kids", "baby", "pink", "brown", "white", "black", "blue", "red", "green", "yellow", "purple", "grey", "gray", "cream",
]);
/** Words before a specific keyword that make it a different product ("wine glasses", "table runner"). */
const MODIFIERS: Record<string, string[]> = {
  glasses: ["wine", "drinking", "shot", "beer", "champagne", "cocktail", "magnifying"],
  spectacles: ["wine", "drinking"],
  cup: ["world", "measuring", "suction"],
  shoe: ["horse"],
  runner: ["table", "rug"],
  trainer: ["potty", "dog"],
  bottle: ["hot", "spray", "water"], // "water bottle" is its own keyword (blocked by "hot")
  "water bottle": ["hot"],
  chair: ["wheel", "car"],
  trolley: ["shopping"],
  spinner: ["fidget"],
  cans: ["trash", "paint", "soda", "tin", "beer"],
  watch: ["stop"],
  bike: ["dirt", "exercise", "stationary", "spin", "pit", "quad", "motor", "balance"],
  bicycle: ["exercise", "stationary", "balance"],
  keyboard: ["piano", "midi", "music", "musical", "digital", "synth"],
  // The template is an acoustic: an electric or bass guitar is designed from scratch.
  guitar: ["electric", "bass", "air"],
};

/** The template a wish clearly asks for, by keyword. */
export function matchTemplate(text: string): Template | null {
  const lower = text.toLowerCase();
  const showpiece = TEMPLATES.find((t) => t.match?.test(lower));
  if (showpiece) return showpiece;
  // A shape twist ("a lamp shaped like a mushroom") is a new design, not a stock template.
  if (/\bshaped\b|\bshape of\b|\blooks? like\b|\binspired by\b|\bin the style of\b|\bthemed\b/.test(text.toLowerCase())) return null;
  // Only the product noun counts, not its accessories: "a car with a cup holder" is not a mug.
  // Punctuation ends a phrase ("|"): "a backpack, red and waterproof" still names a backpack.
  const head = text.toLowerCase().replace(/[,.;:!?]+/g, " | ").replace(/[^a-z0-9| ]+/g, " ").split(/\b(?:with|that|which|for|so|but|where|to|plus|has|having|including)\b/)[0];
  const t = " " + head.replace(/\s+/g, " ") + " ";
  let best: { tpl: Template; score: number; at: number } | null = null;
  for (const tpl of TEMPLATES) {
    for (const k of tpl.keywords) {
      const forms = [k, k + "s", k + "es", ...(k.endsWith("y") ? [k.slice(0, -1) + "ies"] : [])];
      for (const f of forms) {
        const at = t.indexOf(` ${f} `);
        if (at < 0) continue;
        // The keyword must be the head noun, not a modifier: "a phone charger", "a board game" and
        // "a wine glasses rack" are other products.
        const before = t.slice(0, at).trim().split(" ").pop() ?? "";
        const after = t.slice(at + f.length + 2).trim().split(" ")[0] ?? "";
        if (after && after !== "|" && !TRAILING.has(after)) continue;
        if (MODIFIERS[k]?.includes(before)) continue;
        if (GENERIC.has(k) && !PLAIN.has(before) && !/ (bear|bears|teddy|teddies) /.test(t)) continue;
        const score = k.length;
        // The noun the shopper says first is usually the product ("a backpack with a water bottle
        // pocket"); at the same spot the longer phrase wins ("desk lamp" over "desk").
        if (!best || at < best.at || (at === best.at && score > best.score)) best = { tpl, score, at };
      }
    }
  }
  return best?.tpl ?? null;
}
