import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProduct, type Product } from "@wishit/shared";

/**
 * The genie's offline workshop: when Claude can't be reached (no network, no credits), a wish that
 * matches no template gets the closest design the genie already built (the Wish World's 29 wishes),
 * by the words they share, instead of "my magic is resting".
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const STOP = new Set([
  "the", "and", "that", "which", "with", "for", "you", "can", "make", "made", "want", "wish", "please", "like", "into", "turns", "turn", "shaped",
  "looks", "look", "built", "has", "its", "this", "from", "one", "some", "really", "just", "little", "tiny", "big", "giant", "cute", "cool", "new",
  "would", "love", "need", "get", "give", "design", "create", "thing", "kind", "sort", "also", "plus", "inside", "top", "side", "front", "back",
]);
const words = (s: string) =>
  [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(?<=[a-z]{3})(es|s)$/, "")))];

let library: { product: Product; strong: Set<string>; weak: Set<string>; nouns: Set<string> }[] | null = null;
function load() {
  if (library) return library;
  library = [];
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(here, "..", "seed", "world.json"), "utf8")) as { product: unknown }[];
    for (const s of seeds) {
      const product = parseProduct(s.product);
      if (!product) continue;
      // What it is: the last word of its category and of its name (a "desk lamp" is a lamp).
      const nouns = new Set([words(product.category ?? "").pop(), words(product.title).pop()].filter((w): w is string => !!w));
      library.push({ product, strong: new Set(words(`${product.title} ${product.category ?? ""}`)), weak: new Set(words(product.description ?? "")), nouns });
    }
  } catch (err) {
    console.warn("[offline] no design library:", (err as Error).message);
  }
  return library;
}

/** The built design closest to a wish, when it shares enough of the wish's words (else null). */
export function closestDesign(text: string): Product | null {
  const want = words(text);
  if (!want.length) return null;
  // The thing being wished for: the last word before "with/that/shaped like..." ("a wooden desk" is a desk).
  const head = words(text.toLowerCase().split(/\b(?:with|that|which|whose|shaped|like|looks|made|for|in|on|of)\b/)[0]).pop();
  let best: { product: Product; score: number; hits: number } | null = null;
  for (const d of load()) {
    let score = 0, hits = 0;
    for (const w of want) {
      if (d.strong.has(w)) (score += 2), hits++;
      else if (d.weak.has(w)) (score += 1), hits++;
    }
    // It has to be the same kind of thing (a desk is not a lamp that mentions desks).
    if (!head || !d.nouns.has(head)) continue;
    if (!best || score > best.score) best = { product: d.product, score, hits };
  }
  // A real overlap: a title/category word plus something more, covering a fair share of the wish.
  return best && best.score >= 3 && best.hits / want.length >= 0.34 ? best.product : null;
}
