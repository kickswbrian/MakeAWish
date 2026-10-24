import { COLOR_NAMES, LENGTHS, type ProductSpec, type SpecPatch } from "./spec.ts";

/**
 * Cheap keyword matcher. Runs on interim captions in the browser (instant guess, so particles
 * start forming before the LLM answers) and powers the rule-based brain when no LLM key is set.
 */
export function guessPatch(text: string, current?: ProductSpec): SpecPatch {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9$#\s.-]/g, " ") + " ";
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  const patch: SpecPatch = {};
  const features = new Set(current?.features ?? []);

  if (has("dress", "gown", "sundress")) patch.category = "dress";
  else if (has("skirt")) patch.category = "skirt";
  else if (has("top", "blouse", "shirt", "tee", "t-shirt", "sweater", "cardigan")) patch.category = "top";
  else if (has("backpack", "rucksack", "bag", "daypack")) patch.category = "backpack";
  else if (has("helmet")) patch.category = "helmet";
  else if (!current || current.category === "generic") {
    if (has("lamp", "planter", "mug", "bottle", "chair", "desk", "shoe", "shoes", "sneaker", "watch", "gadget")) patch.category = "generic";
  }
  // "a dress that turns into a skirt" is still a dress.
  if (has("turns into a skirt", "converts", "convertible") || /turns? into a skirt|converts? (in)?to a skirt/.test(t)) {
    if (patch.category === "skirt") patch.category = "dress";
    features.add("converts_to_skirt");
  }

  // Colors: longest name first so "forest green" beats "green".
  const names = Object.keys(COLOR_NAMES).sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (t.includes(` ${n} `) || t.includes(` ${n}.`) || t.includes(` ${n},`)) {
      patch.color = COLOR_NAMES[n];
      break;
    }
  }
  const hex = t.match(/#[0-9a-f]{6}\b/);
  if (hex) patch.color = hex[0].toUpperCase();

  // Length, including relative "shorter"/"longer".
  if (has("mini")) patch.length = "mini";
  else if (has("knee", "knee-length")) patch.length = "knee";
  else if (has("midi")) patch.length = "midi";
  else if (has("maxi", "floor-length", "full-length")) patch.length = "maxi";
  else if (current && (has("shorter") || has("longer"))) {
    const i = LENGTHS.indexOf(current.length ?? "midi");
    const j = has("shorter") ? Math.max(0, i - 1) : Math.min(LENGTHS.length - 1, i + 1);
    patch.length = LENGTHS[j];
  }

  if (has("fitted", "bodycon", "tight")) patch.silhouette = "fitted";
  else if (has("a-line", "a line")) patch.silhouette = "a_line";
  else if (has("wrap")) patch.silhouette = "wrap";
  else if (has("flowy", "loose", "billowy", "floaty")) patch.silhouette = "flowy";

  if (has("sleeveless", "strapless", "no sleeves")) patch.sleeves = "none";
  else if (has("cap sleeve", "cap sleeves")) patch.sleeves = "cap";
  else if (has("short sleeve", "short sleeves", "short-sleeved")) patch.sleeves = "short";
  else if (has("long sleeve", "long sleeves", "long-sleeved")) patch.sleeves = "long";

  if (has("v-neck", "v neck")) patch.neckline = "v";
  else if (has("square neck", "square neckline")) patch.neckline = "square";
  else if (has("halter")) patch.neckline = "halter";
  else if (has("crew neck", "crewneck", "round neck")) patch.neckline = "crew";

  if (has("satin", "silk", "silky")) patch.fabric = "satin";
  else if (has("linen")) patch.fabric = "linen";
  else if (has("knit", "knitted", "wool", "jersey")) patch.fabric = "knit";
  else if (has("cotton", "denim")) patch.fabric = "cotton";

  if (has("floral", "flowers", "flowery")) patch.pattern = "floral";
  else if (has("stripe", "stripes", "striped")) patch.pattern = "stripe";
  else if (has("solid", "plain")) patch.pattern = "solid";

  if (has("pocket", "pockets")) features.add("phone_pockets");
  if (has("laptop stand", "laptop-stand", "stand") && (patch.category === "backpack" || current?.category === "backpack")) features.add("laptop_stand");
  if (has("headphones", "headphone", "speakers", "earphones", "audio") && (patch.category === "helmet" || current?.category === "helmet")) features.add("headphones");
  if (features.size !== (current?.features?.length ?? 0)) patch.features = [...features];

  const size = t.match(/\bsize (xxs|xs|s|m|l|xl|xxl|small|medium|large|\d{1,2})\b/);
  if (size) patch.size = size[1].toUpperCase();
  else if (has("small", "medium", "large") && !has("pocket")) patch.size = has("small") ? "S" : has("medium") ? "M" : "L";

  const price = t.match(/\$\s?(\d{2,4})|\b(\d{2,4})\s?(dollars|bucks|usd)\b/);
  if (price) patch.target_price_usd = Number(price[1] ?? price[2]);
  else if (/\beighty\b/.test(t)) patch.target_price_usd = 80;
  else if (/\bfifty\b/.test(t)) patch.target_price_usd = 50;
  else if (/\bhundred\b/.test(t)) patch.target_price_usd = 100;

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
