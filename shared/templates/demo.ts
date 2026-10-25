import type { Part } from "../product.ts";
import type { Template } from "./index.ts";
import scootcase from "./demo/scootcase.json";
import flowerLamp from "./demo/flower_lamp.json";

/**
 * Two showpiece wishes, from genie builds that came out right (the Wish World's Scootcase Rider and
 * Blossom Desk Lamp). They appear instantly like any template, so the demo never waits on the API.
 * `match` catches how people actually say them, which the head-noun keyword rule can't ("a suitcase
 * that turns into a scooter" is a suitcase by its head noun), and nothing looser: "ride" the noun,
 * rose the color and a scooter's luggage rack are other wishes.
 */
const BAG = "(?:suitcase|luggage|carry[- ]?on)";
const SCOOTER = "(?:(?:kick |electric |ride[- ]?on )?scooter)";
const BLOOM = "(?:flower|tulip|blossom|petal|lily|daisy|peony|orchid|rose(?! ?(?:gold|pink|quartz|colou?red|tinted)))";
const SHADE = "(?:lamp ?shade|shade)";

export const DEMO_TEMPLATES: Template[] = [
  {
    ...(scootcase as unknown as Omit<Template, "parts" | "keywords">),
    parts: scootcase.parts as unknown as Part[],
    keywords: ["suitcase scooter", "scooter suitcase", "scootcase", "rideable suitcase", "ride on suitcase", "ride-on suitcase", "luggage scooter"],
    match: new RegExp(
      [
        `\\b${BAG}s? ?${SCOOTER}\\b`, // a suitcase scooter
        `\\b${SCOOTER} ?${BAG}\\b`, // a scooter suitcase
        `\\b(?:rideable|ride[- ]?on) ${BAG}\\b`, // a ride-on suitcase
        `\\b${BAG}\\b.{0,30}\\b(?:turns? into|converts? (?:in)?to|becomes|doubles as|folds? into|transforms? into) (?:an? )?${SCOOTER}\\b`,
        `\\b${BAG}\\b.{0,20}\\b(?:you|i|we|kids) can ride\\b`,
      ].join("|"),
    ),
  },
  {
    ...(flowerLamp as unknown as Omit<Template, "parts" | "keywords">),
    parts: flowerLamp.parts as unknown as Part[],
    keywords: ["flower lamp", "flower lampshade", "flower lamp shade", "tulip lamp", "blossom lamp", "flower shade lamp"],
    match: new RegExp(
      [
        `\\b${BLOOM}s? ?(?:lamp ?shade|shade|lamp)\\b`, // a flower lampshade, a tulip lamp
        `\\b${BLOOM}s? (?:as|for|into) (?:an? |the )?${SHADE}\\b`, // a flower as a lampshade
        `\\bshade (?:is|as|like|shaped like|made (?:of|from|like)) (?:an? |the )?(?:(?:giant|big|huge|single|upside[- ]down|blooming|open) )*${BLOOM}\\b`, // whose shade is a giant tulip
      ].join("|"),
    ),
  },
];

/** What's left of a wish once its showpiece phrase and filler are gone: details the genie should add. */
export function showpieceExtras(t: Template, text: string): string {
  const lower = text.toLowerCase();
  return lower
    .replace(t.match ?? /$^/, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w))
    .join(" ");
}
const FILLER = new Set([
  "the", "and", "that", "which", "who", "can", "you", "for", "with", "make", "made", "want", "wish", "please", "like", "into", "turns", "turn",
  "would", "love", "need", "get", "give", "build", "design", "create", "some", "one", "kind", "sort", "thing", "really", "just", "cute", "cool",
  "awesome", "little", "nice", "desk", "table", "bedside",
  "lamp", "lamps", "light", "whose", "shade", "lampshade", "giant", "big", "huge", "single", "upside", "down", "suitcase", "luggage", "scooter",
  "ride", "rideable", "carry", "kick", "electric",
]);
