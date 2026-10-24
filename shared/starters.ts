import type { ProductSpec } from "./spec.ts";

/**
 * Starter wishes: hand-made specs for the wishes people try first (the example chips and the demo
 * staples). On a blank wish, an opening line that matches one is answered from here in 0 ms with
 * the same model every time, by both brains. Anything else in the sentence (a color, a fabric, a
 * decal) is still applied on top by the caller. Everything else goes to the brain as usual.
 */
export interface Starter {
  id: string;
  /** Every group must match: one of its words or phrases appears in the utterance. */
  match: string[][];
  /** Any of these means it's a different wish ("a backpack with a cat print" isn't a pet carrier). */
  not?: string[];
  spec: ProductSpec;
  say: string;
}

export const STARTERS: Starter[] = [
  {
    id: "headphone-helmet",
    match: [["helmet"], ["headphone", "headphones", "earphone", "earphones", "earbud", "earbuds", "speaker", "speakers", "audio", "music", "sound", "ear cups"]],
    spec: { category: "helmet", name: "Headphone Helmet", color: "#F28DB2", finish: "glossy", features: ["headphones"] },
    say: "Your wish is taking shape: a bike helmet with headphones built right in. What color are you dreaming of?",
  },
  {
    id: "stand-backpack",
    match: [["backpack", "bag", "rucksack", "bookbag", "book bag", "knapsack"], ["laptop stand", "laptop-stand", "stand for my laptop", "kickstand", "laptop desk", "standing desk"]],
    spec: { category: "backpack", name: "Stand-Up Backpack", color: "#7FB7A4", features: ["laptop_stand", "phone_pockets"] },
    say: "Ooh, a backpack whose front folds out into a laptop stand. What color should it be?",
  },
  {
    id: "convertible-dress",
    match: [["dress", "gown", "sundress"], ["skirt", "convert", "converts", "convertible", "turns into", "zip off", "zips off", "detachable", "two in one", "2 in 1"]],
    not: ["backpack", "bag", "skirt that", "skirt which", "top that", "turns into a dress", "into a dress", "becomes a dress"],
    spec: {
      category: "dress", name: "Convertible Midi", length: "midi", silhouette: "a_line", sleeves: "cap", neckline: "v",
      color: "#1F8A5B", fabric: "satin", features: ["converts_to_skirt"],
    },
    say: "Your wish is taking shape: a midi dress whose top zips off into a skirt. Should it have pockets that actually fit a phone?",
  },
  {
    id: "self-watering-planter",
    match: [["planter", "plant pot", "flower pot", "pot for my plants"], ["self watering", "self-watering", "waters itself", "water itself", "reservoir", "never forget to water", "forget to water"]],
    spec: {
      category: "generic", name: "Self-Watering Desk Planter", color: "#9CAF88", finish: "matte", features: ["self_watering"],
      body: { shape: "cylinder", width: 0.55, height: 0.4 },
      addons: [{ name: "water gauge", shape: "capsule", placement: "front", size: 0.7, glow: true }, { name: "fill spout", shape: "cylinder", placement: "top", size: 0.6 }],
    },
    say: "A planter that waters itself, with a little gauge so you know when to top it up. What color should it be?",
  },
  {
    id: "smart-bottle",
    match: [["water bottle", "bottle", "flask", "tumbler"], ["smart", "reminds", "remind", "tracks", "track", "glows", "glow", "led", "lights up", "light up"]],
    spec: {
      category: "generic", name: "Smart Water Bottle", color: "#3A6FD8", finish: "glossy",
      body: { shape: "cylinder", width: 0.28, height: 0.8 },
      addons: [{ name: "cap", shape: "cylinder", placement: "top", size: 0.8 }, { name: "reminder light", shape: "box", placement: "front", glow: true, size: 0.8 }],
    },
    say: "A bottle that glows when it's time to drink. What color are you picturing?",
  },
  {
    id: "led-skateboard",
    match: [["skateboard", "skate board", "longboard"], ["led", "leds", "lights", "light up", "lights up", "lit up", "glow", "glowing", "glows", "neon"]],
    spec: {
      category: "generic", name: "Glow Skateboard", color: "#1A1A1D", finish: "glossy",
      body: { shape: "capsule", width: 1.1, height: 0.06, depth: 0.3 },
      addons: [{ name: "light-up wheels", shape: "cylinder", placement: "bottom", count: 4, glow: true }],
    },
    say: "A skateboard with wheels that light up as you ride. What color should the deck be?",
  },
  {
    id: "cat-backpack",
    match: [["backpack", "bag"], ["cat", "kitten", "pet", "dog", "puppy"], ["carry my", "carrier", "bubble", "window", "for my cat", "for my dog", "for my pet", "for my puppy", "for my kitten", "for cats", "for dogs", "for pets"]],
    not: ["print", "pattern", "design", "picture", "drawing", "logo", "sticker", "embroider"],
    spec: {
      category: "backpack", name: "Pet Bubble Backpack", color: "#F6D44A",
      addons: [{ name: "bubble window", shape: "dome", placement: "back", size: 1.6, color: "#C0C4CC" }, { name: "air vents", shape: "box", placement: "left", size: 0.7 }],
    },
    say: "A backpack with a bubble window so your pet can see the world. What color should it be?",
  },
];

const norm = (s: string) => " " + s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";

/** The starter this opening line asks for, if any. */
export function matchStarter(text: string): Starter | null {
  const t = norm(text);
  // An opening line that's really a question isn't a wish ("do you have a headphone helmet?" still is).
  if (/^ (how|why|who|when|where) /.test(t)) return null;
  let best: Starter | null = null;
  for (const s of STARTERS) {
    if (!s.match.every((group) => group.some((w) => t.includes(norm(w))))) continue;
    if (s.not?.some((w) => t.includes(norm(w)))) continue;
    // Prefer the more specific starter (the pet backpack over the plain stand backpack).
    if (!best || s.match.length > best.match.length) best = s;
  }
  return best;
}
