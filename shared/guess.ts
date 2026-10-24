import { COLOR_NAMES, LENGTHS, type Category, type ProductSpec, type SpecPatch } from "./spec.ts";
import { findColor, GENERIC_WORDS, genericBody, interpretEdits, isUndo, shapeHint } from "./edits.ts";

/**
 * Cheap keyword matcher. Runs on interim captions in the browser (instant guess, so particles
 * start forming before the LLM answers) and powers the rule-based brain when no LLM key is set.
 */
export interface Interpretation {
  patch: SpecPatch;
  /** Short phrases describing the edits, for the spoken reply. */
  did: string[];
  undo: boolean;
}

/**
 * Instant guess for live captions: everything the rule brain would do except new decals and
 * add-ons, which shouldn't flash in from half a sentence ("draw a dra...").
 */
export function guessPatch(text: string, current?: ProductSpec): SpecPatch {
  const { patch } = interpret(text, current);
  delete patch.decals;
  delete patch.addons;
  return patch;
}

/** "A robot vacuum that empties itself" -> "Robot Vacuum" with a body that suits it. */
function freshProduct(t: string): { name: string; body: NonNullable<ProductSpec["body"]> } | null {
  const m = t.match(/\b(?:a|an|some|wish for|want|need)\s+((?:[a-z-]+\s+){0,3}?[a-z-]+?)(?=\s+(?:that|which|with|for|made|in|to|so|shaped|and|but|like|where|who)\b|\s*[.!?]?\s*$)/);
  if (!m) return null;
  const skip = new Set(["big", "small", "little", "tiny", "huge", "cool", "new", "nice", "cute", "really", "very", "super", "kind", "of", "sort", "the", "my", "built-in", "custom"]);
  const words = m[1].split(/\s+/).filter((w) => w && !skip.has(w) && !COLOR_NAMES[w]);
  if (!words.length || /^(it|one|thing|something|product|wish|idea)$/.test(words[words.length - 1])) return null;
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 60);
  const n = words.join(" ");
  const body: NonNullable<ProductSpec["body"]> =
    /\b(vacuum|roomba|puck|coaster|clock|plate|disc|disk|frisbee|pad|scale)\b/.test(n) ? { shape: "cylinder", width: 0.6, height: 0.12 }
      : /\b(tower|tree|post|pole|column|stand|rack)\b/.test(n) ? { shape: "cylinder", width: 0.35, height: 1.0 }
      : /\b(ball|globe|orb|egg|bubble|sphere)\b/.test(n) ? { shape: "sphere", width: 0.55, height: 0.55 }
      : /\b(board|mat|tray|panel|tablet|laptop|book|card)\b/.test(n) ? { shape: "box", width: 0.8, height: 0.06, depth: 0.5 }
      : /\b(pillow|cushion|bed|bag|pouch|purse)\b/.test(n) ? { shape: "capsule", width: 0.8, height: 0.3, depth: 0.5 }
      : { shape: shapeHint(t) ?? "box", width: 0.5, height: 0.55, depth: 0.45 };
  return { name, body };
}

/** Category words. Order matters: "a dress that turns into a skirt" is checked before "skirt". */
const CATEGORY_WORDS: [Category, string][] = [
  ["dress", "dress|gown|sundress|jumpsuit|romper"],
  ["skirt", "skirt"],
  ["top", "top|blouse|shirt|tee|t-shirt|t shirt|tshirt|sweater|cardigan|hoodie|sweatshirt|jacket|jumper|tank top|crop top|tank|polo|vest|camisole|cami"],
  ["backpack", "backpack|rucksack|bag|daypack|bookbag|book bag|knapsack"],
  ["helmet", "helmet"],
];

/** Which product the utterance names. Once a product exists, switching needs framing like "make it a ...". */
function detectCategory(t: string, current: ProductSpec | undefined): { category?: Category; noun?: string; reframe?: boolean } {
  // A blank wish takes any product noun; once something exists, switching needs framing.
  const fresh = !current || (current.category === "generic" && !current.body);
  // Up to three describing words between the framing and the noun, but never a preposition:
  // "a unicorn horn on top" does not frame "top".
  const filler = "(?:(?!on |in |at |to |of |with |for |from |onto |into |by |the |its |my |this |that |his |her |their )[a-z-]+\\s+){0,3}";
  const framed = (words: string, strong = false) =>
    new RegExp(`\\b(?:${strong ? "" : "an?|"}make it(?: into)?(?: an?)?|turn it into(?: an?)?|change it (?:to|into)(?: an?)?|switch (?:it )?to(?: an?)?|(?:i )?want(?: an?)?|how about(?: an?)?|what about(?: an?)?|instead of(?: an?)?|(?:it )?should be(?: an?)?|let'?s do(?: an?)?|actually(?: an?)?)\\s+${filler}(${words})s?\\b(?!\\s+(?:of|half|part|side))`).exec(t);
  const loose = (words: string) => {
    const m = new RegExp(`\\b(${words})s?\\b`).exec(t);
    if (!m) return null;
    // "on top", "the top of", "top half": a place, not a product.
    if (m[1] === "top" && /\b(on|the|to the|at the|on the|from the)\s+top\b|\btop (of|half|part|side)\b/.test(t)) return null;
    return m;
  };
  for (const [cat, words] of CATEGORY_WORDS) {
    const m = fresh ? loose(words) : framed(words);
    if (m) return { category: cat, noun: m[1] };
  }
  const body = genericBody(t);
  // Generic nouns double as parts and add-ons ("a ring grip", "a cup holder"), so switching to one needs strong framing.
  if (body && fresh) return { category: "generic", noun: body.name };
  if (body && framed(GENERIC_WORDS, true)) return { category: "generic", noun: body.name, reframe: true };
  if (fresh && /\b(lamp|planter|chair|desk|gadget|device|toy)\b/.test(t)) return { category: "generic" };
  return {};
}

/** Rule-brain interpretation: targeted edits first (parts, decals, add-ons), keyword guess for the rest. */
export function interpret(text: string, current?: ProductSpec): Interpretation {
  if (isUndo(text)) return { patch: {}, did: [], undo: true };
  const spec = current ?? { category: "generic" as const };
  const full = " " + text.toLowerCase().replace(/[^a-z0-9$#\s.-]/g, " ") + " ";
  const { category: newCat, noun, reframe: framed } = detectCategory(full, current);
  const category = newCat ?? spec.category;
  const switching = !!newCat && newCat !== spec.category;
  // "Make it a lamp" on a mug is a new product; "make it a blue mug" on a mug is not.
  const newName = (genericBody(full)?.name ?? "").toLowerCase(), oldName = (spec.name ?? "").toLowerCase();
  // Same product noun ("desk lamp" -> "touch lamp", "mug" -> "blue mug") keeps what's on it.
  const oldKind = (genericBody(` ${oldName} `)?.name ?? oldName).toLowerCase();
  const head = (n: string) => n.split(/\s+/).pop() ?? n;
  const reframe = !!framed && !!newName && head(newName) !== head(oldKind);
  // A new product starts clean: its parts, decals and add-ons don't carry over (a lamp has no mug handle).
  const base: ProductSpec = switching ? { ...spec, category, parts: {}, decals: [], addons: [] } : reframe ? { ...spec, addons: [] } : spec;
  const edits = interpretEdits(text, base, category);
  const patch: SpecPatch = { ...guessRest(edits.rest, base, category, noun), ...edits.patch };
  if (newCat && newCat !== spec.category) patch.category = newCat;
  if (switching) {
    if (!edits.patch.decals) patch.decals = [];
    if (!edits.patch.addons) patch.addons = [];
    if (!edits.patch.parts && spec.parts && Object.keys(spec.parts).length) patch.parts = Object.fromEntries(Object.keys(spec.parts).map((k) => [k, null])) as never;
    if (spec.scale !== undefined) patch.scale = 1;
  }
  // Generic products get a body so they render instantly; their starter add-ons come along once.
  if (category === "generic") {
    const g = genericBody(full);
    // Mentioning the lamp while editing it keeps its body; "make it a mug instead" swaps it.
    if (g && (switching || !spec.body || reframe)) {
      patch.body = g.body;
      patch.name = g.name;
      const carried = reframe ? edits.patch.addons ?? [] : patch.addons ?? spec.addons ?? [];
      if (g.addons) patch.addons = [...g.addons, ...carried.filter((a) => !g.addons!.some((b) => b.name === a.name))];
      else if (reframe) patch.addons = carried;
    }
    // Any other product on a blank wish still renders: its own name and a simple body.
    if (!g && !spec.body && !patch.body && newCat === "generic") {
      const fresh = freshProduct(full);
      if (fresh) {
        patch.name = fresh.name;
        patch.body = fresh.body;
      }
    }
    const hint = /\b(shaped like|in the shape of|make it|round|cube|boxy|cylinder|cone|pyramid|donut)\b/.test(full) ? shapeHint(full) : null;
    if (hint) patch.body = { ...(patch.body ?? spec.body ?? { width: 0.5, height: 0.6 }), shape: hint };
  }
  // Features: the edit pass may have added or removed some; the keyword pass may have added more.
  const restFeatures = guessFeatures(edits.rest + " " + (switching ? full : ""), category);
  const fromEdits = edits.patch.features ?? (switching ? [] : spec.features ?? []);
  const features = [...new Set([...fromEdits, ...restFeatures])];
  if (/turns? into a skirt|converts? (in)?to a skirt|\bconvertible\b/.test(full) && category === "dress") features.push("converts_to_skirt");
  const uniq = [...new Set(features)];
  if (JSON.stringify(uniq) !== JSON.stringify(spec.features ?? [])) patch.features = uniq;
  else delete patch.features;
  return { patch, did: edits.did, undo: false };
}

function guessFeatures(text: string, category: Category): string[] {
  const t = " " + text.toLowerCase() + " ";
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  const out: string[] = [];
  if (has("pocket", "pockets") && !/\bno pockets?\b|\bwithout pockets?\b/.test(t)) out.push("phone_pockets");
  if (has("laptop stand", "laptop-stand", "stand") && category === "backpack") out.push("laptop_stand");
  if (has("headphones", "headphone", "speakers", "earphones", "audio") && category === "helmet") out.push("headphones");
  return out;
}

/** Keyword guess for whatever the edit pass didn't claim: whole-product color, cut, fabric, price. */
function guessRest(text: string, current: ProductSpec, category: Category, noun?: string): SpecPatch {
  // "Switch the denim for leather", "leather instead of denim": drop the thing being replaced.
  const t = (" " + text.toLowerCase().replace(/[^a-z0-9$#\s.\/-]/g, " ") + " ")
    .replace(/\b(switch|swap|replace|trade|change|ditch)\s+(?:the\s+|its\s+)?(?:[a-z]+\s+){0,2}?([a-z]+)\s+(?:for|with|to|into)\b/g, " ")
    .replace(/\b(?:instead of|rather than|not)\s+(?:the\s+)?[a-z]+\b/g, " ");
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  const patch: SpecPatch = {};
  const clothing = category === "dress" || category === "top" || category === "skirt";

  // What the garment noun implies: a hoodie has long sleeves and a hood, a tank top has none.
  if (noun && category === "top") {
    if (/hoodie|sweatshirt|jacket|sweater|cardigan|jumper/.test(noun)) patch.sleeves = "long";
    if (/tank|cami|vest/.test(noun)) patch.sleeves = "none";
    if (/tee|t-shirt|t shirt|tshirt|polo/.test(noun)) patch.sleeves = "short";
    if (/hoodie/.test(noun)) patch.addons = [{ name: "hood", shape: "dome", placement: "back" }];
  }

  // Color: the first one said ("forest green" beats "green"); "white polka dots" is the pattern's.
  const color = findColor(t);
  if (color) patch.color = color;


  // Sleeve lengths first, then strip them so "full-length sleeves" doesn't also make a maxi.
  if (has("full length sleeves", "full-length sleeves", "wrist length sleeves", "long sleeved", "long-sleeved", "long sleeves", "long sleeve", "full sleeves", "sleeves to the wrist", "sleeves down to the wrist")) patch.sleeves = "long";
  const tl = t.replace(/\b(?:full|floor|wrist|elbow|three quarter|3\/4)[- ]length sleeves?\b/g, " ");
  const hasL = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(tl));
  // Length, by name or by where it ends ("to the floor", "above the knee"), or relative.
  if (hasL("mini", "micro", "above the knee", "above my knees?", "mid thigh", "mid-thigh", "thigh length", "super short")) patch.length = "mini";
  else if (hasL("maxi", "floor-length", "floor length", "full-length", "full length", "ankle length", "ankle-length", "to the floor", "the floor", "to my ankles", "to the ankles", "ankles", "ground", "floor")) patch.length = "maxi";
  else if (hasL("knee", "knee-length", "knee length", "knees")) patch.length = "knee";
  else if (hasL("midi", "mid-length", "calf length", "tea length", "mid calf", "mid-calf", "calf", "calves")) patch.length = "midi";
  else if (clothing && category !== "top" && (has("shorter") || has("longer"))) {
    const i = LENGTHS.indexOf(current.length ?? "midi");
    const j = has("shorter") ? Math.max(0, i - 1) : Math.min(LENGTHS.length - 1, i + 1);
    patch.length = LENGTHS[j];
  }

  if (has("fitted", "bodycon", "tight", "form fitting", "slim fit")) patch.silhouette = "fitted";
  else if (has("a-line", "a line")) patch.silhouette = "a_line";
  else if (has("wrap")) patch.silhouette = "wrap";
  else if (has("flowy", "loose", "billowy", "floaty", "flowing", "swishy")) patch.silhouette = "flowy";

  if (patch.sleeves) { /* set above */ }
  else if (has("sleeveless", "strapless", "no sleeves", "without sleeves")) patch.sleeves = "none";
  else if (has("three quarter", "three-quarter", "3/4", "elbow length", "elbow sleeves")) patch.sleeves = "three_quarter";
  else if (has("puff sleeve", "puff sleeves", "puffy sleeves", "puffed sleeves", "balloon sleeves")) patch.sleeves = "puff";
  else if (has("cap sleeve", "cap sleeves")) patch.sleeves = "cap";
  else if (has("short sleeve", "short sleeves", "short-sleeved", "short sleeved")) patch.sleeves = "short";
  else if (has("long sleeve", "long sleeves", "long-sleeved", "long sleeved", "full sleeves")) patch.sleeves = "long";

  if (has("v-neck", "v neck", "vneck", "v neckline")) patch.neckline = "v";
  else if (has("square neck", "square neckline")) patch.neckline = "square";
  else if (has("halter")) patch.neckline = "halter";
  else if (has("turtleneck", "turtle neck", "mock neck", "high neck", "polo neck", "funnel neck")) patch.neckline = "turtleneck";
  else if (has("off the shoulder", "off-the-shoulder", "off shoulder", "off-shoulder", "bardot")) patch.neckline = "off_shoulder";
  else if (has("sweetheart")) patch.neckline = "sweetheart";
  else if (has("scoop", "scoop neck", "scoop neckline", "u neck")) patch.neckline = "scoop";
  else if (has("crew neck", "crewneck", "round neck")) patch.neckline = "crew";

  if (has("satin", "silk", "silky")) patch.fabric = "satin";
  else if (has("denim", "jean", "jeans", "chambray")) patch.fabric = "denim";
  else if (has("leather", "pleather", "faux leather", "vegan leather", "suede")) patch.fabric = "leather";
  else if (has("velvet", "velour", "crushed velvet")) patch.fabric = "velvet";
  else if (has("sequin", "sequins", "sequined", "sequinned", "sparkly", "glitter", "glittery", "sparkles")) patch.fabric = "sequin";
  else if (has("linen")) patch.fabric = "linen";
  else if (has("knit", "knitted", "wool", "woolen", "jersey", "cashmere", "crochet")) patch.fabric = "knit";
  else if (has("cotton")) patch.fabric = "cotton";

  if (has("polka dot", "polka dots", "polka-dot", "polka dotted", "spotted", "dotted", "spots")) patch.pattern = "polka_dot";
  else if (has("plaid", "tartan", "flannel")) patch.pattern = "plaid";
  else if (has("checkered", "checkerboard", "checked", "gingham", "checks", "check pattern")) patch.pattern = "checkered";
  else if (has("camo", "camouflage")) patch.pattern = "camo";
  else if (has("leopard", "cheetah", "animal print", "jaguar")) patch.pattern = "leopard";
  else if (has("chevron", "zigzag", "zig zag", "zig-zag")) patch.pattern = "chevron";
  else if (has("floral", "flowers", "flowery", "flower print")) patch.pattern = "floral";
  else if (has("stripe", "stripes", "striped", "pinstripe", "pinstripes")) patch.pattern = "stripe";
  else if (has("solid", "plain", "no pattern")) patch.pattern = "solid";

  if (has("metallic", "chrome", "metal", "brushed metal", "mirror finish", "foil")) patch.finish = "metallic";
  else if (has("glow", "glowing", "glow in the dark", "glows", "luminous", "neon", "light up", "lights up", "luminescent")) patch.finish = "glow";
  else if (has("glossy", "shiny", "gloss", "polished", "lacquered", "patent")) patch.finish = "glossy";
  else if (has("matte", "matt", "flat finish")) patch.finish = "matte";

  // Clothing sizes only; "a large star" or "small pockets" are about the model, not the fit.
  const size = t.match(/\bsize (xxs|xs|s|m|l|xl|xxl|small|medium|large|\d{1,2})\b/) ?? t.match(/\b(?:in (?:an? )?|an? )(xxs|xs|xl|xxl|small|medium|large)(?: size)?\b(?!\s+[a-z]+)/);
  if (clothing && size) {
    const s = size[1];
    patch.size = s === "small" ? "S" : s === "medium" ? "M" : s === "large" ? "L" : s.toUpperCase();
  }

  const price = t.match(/\$\s?(\d{2,4})|\b(\d{2,4})\s?(dollars|bucks|usd)\b/);
  if (price) patch.target_price_usd = Number(price[1] ?? price[2]);
  else if (/\beighty\b/.test(t)) patch.target_price_usd = 80;
  else if (/\bfifty\b/.test(t)) patch.target_price_usd = 50;
  else if (/\bhundred\b/.test(t)) patch.target_price_usd = 100;
  else if (/\bthirty\b/.test(t)) patch.target_price_usd = 30;
  else if (/\btwenty\b/.test(t) && /\b(pay|cost|price|bucks|dollars)\b/.test(t)) patch.target_price_usd = 20;

  return patch;
}

export function isAffirmativeLock(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(make it real|wish it|lock it( in)?|yes,? (please|make|do it|let'?s)|let'?s do it|do it|that'?s it|perfect,? (lock|make))\b/.test(t) || /^\s*(yes|yeah|yep|sure)\b[.!]?\s*$/.test(t);
}

/** Human-readable product name built from a spec. */
export function describeSpec(spec: ProductSpec): string {
  const color = spec.color ? colorName(spec.color) : "";
  const bits: string[] = [];
  if (color) bits.push(color);
  if (spec.fabric && ["dress", "top", "skirt"].includes(spec.category)) bits.push(spec.fabric);
  if (spec.length && ["dress", "skirt"].includes(spec.category)) bits.push(spec.length);
  bits.push(spec.category === "generic" ? "wish" : spec.category);
  const f = spec.features ?? [];
  const extras: string[] = [];
  if (f.includes("converts_to_skirt")) extras.push("that converts to a skirt");
  if (f.includes("phone_pockets")) extras.push("with phone pockets");
  if (f.includes("laptop_stand")) extras.push("with a built-in laptop stand");
  if (f.includes("headphones")) extras.push("with built-in headphones");
  return [bits.join(" "), extras.join(", ")].filter(Boolean).join(" ");
}

/** Short catchy product name, e.g. "Convertible Pocket Midi". */
export function shortName(spec: ProductSpec): string {
  const f = spec.features ?? [];
  const words: string[] = [];
  if (f.includes("converts_to_skirt")) words.push("Convertible");
  if (f.includes("phone_pockets")) words.push("Pocket");
  if (f.includes("laptop_stand")) words.push("Stand-Up");
  if (f.includes("headphones")) words.push("Headphone");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (spec.category) {
    case "dress": words.push(spec.length && spec.length !== "knee" ? cap(spec.length) : "Dress"); break;
    case "skirt": words.push(spec.length ? `${cap(spec.length)} Skirt` : "Skirt"); break;
    case "top": words.push("Top"); break;
    case "backpack": words.push("Backpack"); break;
    case "helmet": words.push("Helmet"); break;
    default: words.push("Wish");
  }
  if (words.length === 1 && spec.color) words.unshift(cap(colorName(spec.color)));
  return words.join(" ");
}

export function colorName(hex: string): string {
  const target = hexToRgb(hex);
  let best = "";
  let bestD = Infinity;
  for (const [name, h] of Object.entries(COLOR_NAMES)) {
    const c = hexToRgb(h);
    const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
