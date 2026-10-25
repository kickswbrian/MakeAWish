import type { Part } from "../product.ts";
import type { Template } from "./index.ts";
import scootcase from "./demo/scootcase.json";
import flowerLamp from "./demo/flower_lamp.json";

/**
 * Two showpiece wishes, from genie builds that came out right (the Wish World's Scootcase Rider and
 * Blossom Desk Lamp). They appear instantly like any template, so the demo never waits on the API:
 * with the genie up it customizes them, with it down (or slow) they stand on their own. `match`
 * catches how people actually say them, which the head-noun keyword rule can't ("a suitcase that
 * turns into a scooter" is a suitcase by its head noun).
 */
const RIDE = "(scooter|ride|rideable|ride-on|kick ?board)";
const BAG = "(suitcase|luggage|carry[- ]?on|trolley)";
const BLOOM = "(flower|tulip|blossom|petal|rose|lily|daisy|peony|orchid)";

export const DEMO_TEMPLATES: Template[] = [
  {
    ...(scootcase as unknown as Omit<Template, "parts" | "keywords">),
    parts: scootcase.parts as unknown as Part[],
    keywords: ["suitcase scooter", "scooter suitcase", "scootcase", "rideable suitcase", "ride on suitcase", "ride-on suitcase", "luggage scooter"],
    match: new RegExp(`\\b${BAG}\\b.*\\b${RIDE}\\b|\\b${RIDE}\\b.*\\b${BAG}\\b`),
  },
  {
    ...(flowerLamp as unknown as Omit<Template, "parts" | "keywords">),
    parts: flowerLamp.parts as unknown as Part[],
    keywords: ["flower lamp", "flower lampshade", "flower lamp shade", "tulip lamp", "blossom lamp", "flower shade lamp"],
    match: new RegExp(`\\b${BLOOM}s?[- ]?(lamp ?shade|shade|lamp)\\b|\\blamp ?shade\\b.*\\b${BLOOM}\\b|\\b${BLOOM}\\b.*\\b(as|for|into) (an? |the )?lamp ?shade\\b|\\blamp\\b.*\\b(with|whose) (an? |the )?${BLOOM}\\b.*\\bshade\\b|\\blamp\\b.*\\bshade\\b.*\\b${BLOOM}\\b`),
  },
];
