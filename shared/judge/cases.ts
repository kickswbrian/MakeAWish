import type { ProductSpec } from "../spec.ts";
import type { JudgeCase } from "./check.ts";

/**
 * Dev corpus: requests a judge might make at the booth. Used while building the parser and prompt,
 * so passing these says little on its own; the blind held-out corpus (written separately, never
 * read while tuning) is the real measure. Run: npm run judge
 */

const dress: ProductSpec = {
  category: "dress", length: "midi", silhouette: "a_line", sleeves: "cap", neckline: "v", color: "#1F8A5B", fabric: "satin",
  features: ["phone_pockets", "converts_to_skirt"],
};
const backpack: ProductSpec = { category: "backpack", color: "#7FB7A4", features: ["laptop_stand", "phone_pockets"] };
const helmet: ProductSpec = { category: "helmet", color: "#F28DB2", features: ["headphones"] };
const top: ProductSpec = { category: "top", sleeves: "short", neckline: "crew", color: "#3A6FD8", fabric: "knit" };
const skirt: ProductSpec = { category: "skirt", length: "knee", silhouette: "wrap", color: "#E2B13C", fabric: "linen" };
const bottle: ProductSpec = { category: "generic", name: "Smart water bottle", body: { shape: "cylinder", width: 0.3, height: 0.8 } };

export const DEV_CASES: JudgeCase[] = [
  // ---- resize a component ----
  { id: "d-pockets-bigger", start: dress, say: "make the pockets bigger", expect: [{ path: "parts.pockets.scale", grew: true }, { unchanged: ["length", "color"] }], tags: ["resize"] },
  { id: "bp-straps-thicker", start: backpack, say: "can the straps be a lot thicker", expect: [{ path: "parts.straps.scale", grew: true }], tags: ["resize"] },
  { id: "h-visor-smaller", start: helmet, say: "make the visor smaller", expect: [{ path: "parts.visor.scale", shrank: true }], tags: ["resize"] },
  { id: "bp-whole-bigger", start: backpack, say: "make the backpack bigger", expect: [{ path: "scale", grew: true }, { unchanged: ["parts"] }], tags: ["resize"] },
  { id: "h-whole-smaller", start: helmet, say: "make it a little smaller", expect: [{ path: "scale", shrank: true }], tags: ["resize"] },
  { id: "d-sleeves-longer", start: dress, say: "make the sleeves longer", expect: [{ path: "sleeves", oneOf: ["short", "puff", "three_quarter", "long"] }, { unchanged: ["length"] }], tags: ["resize", "sleeves"] },
  { id: "d-dress-shorter", start: dress, say: "make the dress shorter", expect: [{ path: "length", oneOf: ["knee", "mini"] }, { unchanged: ["sleeves"] }], tags: ["resize"] },
  { id: "bp-front-pocket-huge", start: backpack, say: "I want a huge front pocket", expect: [{ path: "parts.front_pocket.scale", grew: true }], tags: ["resize"] },

  // ---- recolor a component ----
  { id: "bp-straps-black", start: backpack, say: "make the straps black", expect: [{ path: "parts.straps.color", family: "black" }, { unchanged: ["color"] }], tags: ["recolor"] },
  { id: "h-visor-gold", start: helmet, say: "paint the visor gold", expect: [{ path: "parts.visor.color", family: "yellow" }, { unchanged: ["color"] }], tags: ["recolor"] },
  { id: "d-sleeves-white", start: dress, say: "white sleeves please", expect: [{ path: "parts.sleeves.color", family: "white" }, { unchanged: ["color"] }], tags: ["recolor"] },
  { id: "bp-all-red", start: backpack, say: "make it all red", expect: [{ path: "color", family: "red" }], tags: ["recolor"] },
  { id: "h-zip", start: backpack, say: "give it a silver zipper", expect: [{ path: "parts.zipper.color", family: "gray" }], tags: ["recolor"] },

  // ---- draw / write things ----
  { id: "d-dragon-back", start: dress, say: "draw a dragon on the back", expect: [{ decal: { content: ["dragon", "🐉", "🐲"], placement: "back" } }], tags: ["decal"] },
  { id: "bp-calhacks", start: backpack, say: "write CAL HACKS on the front", expect: [{ decal: { kind: "text", content: ["cal hacks"], placement: "front" } }], tags: ["decal"] },
  { id: "h-lightning-side", start: helmet, say: "put a lightning bolt on the left side", expect: [{ decal: { content: ["lightning", "⚡"], placement: "left" } }], tags: ["decal"] },
  { id: "t-number", start: top, say: "put the number 23 on the back", expect: [{ decal: { kind: "text", content: ["23"], placement: "back" } }], tags: ["decal"] },
  { id: "t-initials", start: top, say: "add my initials S S on the chest", expect: [{ decal: { kind: "text", content: ["ss", "s s", "s.s"], placement: "front" } }], tags: ["decal"] },
  { id: "bp-red-star", start: backpack, say: "add a big red star", expect: [{ decal: { content: ["star", "⭐"], family: "red", sizeGt: 1 } }], tags: ["decal"] },
  { id: "h-cat", start: helmet, say: "can you put a cat on it", expect: [{ decal: { content: ["cat", "🐱", "🐈"] } }], tags: ["decal"] },
  { id: "d-quote", start: dress, say: "write 'wish granted' across the skirt", expect: [{ decal: { kind: "text", content: ["wish granted"] } }], tags: ["decal"] },
  { id: "bp-says", start: backpack, say: "add a patch that says go bears", expect: [{ decal: { kind: "text", content: ["go bears"] } }], tags: ["decal"] },
  { id: "sk-flowers-all-over", start: skirt, say: "hearts all over it", expect: [{ decal: { content: ["heart", "❤", "💖"], placement: "front" } }, { decal: { content: ["heart", "❤", "💖"], placement: "back" } }], tags: ["decal"] },

  // ---- add things ----
  { id: "bp-cup-holder", start: backpack, say: "add a cup holder on the side", expect: [{ addon: { name: ["cup", "holder"], placement: ["left", "right"] } }], tags: ["addon"] },
  { id: "h-light-back", start: helmet, say: "put a light on the back", expect: [{ addon: { name: ["light"], placement: "back", glow: true } }], tags: ["addon"] },
  { id: "d-bow", start: dress, say: "add a bow on the back", expect: [{ addon: { name: ["bow"], shape: ["bow"], placement: "back" } }], tags: ["addon"] },
  { id: "d-belt", start: dress, say: "give it a black belt", expect: [{ addon: { name: ["belt"], placement: "waist", family: "black" } }], tags: ["addon"] },
  { id: "h-horns", start: helmet, say: "add horns", expect: [{ addon: { name: ["horn"], placement: "top" } }], tags: ["addon"] },
  { id: "h-cat-ears", start: helmet, say: "add cat ears on top", expect: [{ addon: { name: ["ear"], placement: "top" } }, { noDecal: {} }], tags: ["addon"] },
  { id: "bp-solar", start: backpack, say: "add a solar panel to the top", expect: [{ addon: { name: ["solar", "panel"], placement: "top" } }], tags: ["addon"] },
  { id: "bp-wings", start: backpack, say: "it needs wings", expect: [{ addon: { name: ["wing"] } }], tags: ["addon"] },
  { id: "bp-pockets", start: { category: "backpack", color: "#7FB7A4" }, say: "add a side pocket for my phone", expect: [{ partShown: "side_pocket" }], tags: ["addon", "feature"] },
  { id: "h-headphones", start: { category: "helmet", color: "#F28DB2" }, say: "can it have built in speakers", expect: [{ path: "features", includes: "headphones" }], tags: ["feature"] },

  // ---- remove / undo / move ----
  { id: "d-no-pockets", start: dress, say: "remove the pockets", expect: [{ partGone: "pockets" }, { path: "features", includes: "converts_to_skirt" }], tags: ["remove"] },
  { id: "h-no-phones", start: helmet, say: "take off the headphones", expect: [{ partGone: "headphones" }], tags: ["remove"] },
  { id: "d-no-sleeves", start: dress, say: "actually no sleeves", expect: [{ path: "sleeves", equals: "none" }], tags: ["remove"] },
  { id: "h-no-visor", start: helmet, say: "get rid of the visor", expect: [{ partGone: "visor" }], tags: ["remove"] },
  { id: "d-remove-star", start: { ...dress, decals: [{ kind: "shape", content: "star", placement: "back" }] }, say: "remove the star", expect: [{ noDecal: { content: ["star"] } }], tags: ["remove", "decal"] },
  { id: "bp-remove-holder", start: { ...backpack, addons: [{ name: "cup holder", shape: "cylinder", placement: "right" }] }, say: "lose the cup holder", expect: [{ noAddon: { name: ["cup"] } }], tags: ["remove", "addon"] },
  { id: "d-undo", start: dress, before: ["make it red"], say: "undo that", expect: [{ path: "color", equals: "#1F8A5B" }], tags: ["undo"] },
  { id: "bp-go-back", start: backpack, before: ["add a cup holder on the side"], say: "actually go back", expect: [{ noAddon: { name: ["cup"] } }], tags: ["undo"] },
  { id: "d-move", start: { ...dress, decals: [{ kind: "emoji", content: "🐉", placement: "back" }] }, say: "move the dragon to the front", expect: [{ decal: { content: ["🐉"], placement: "front" } }, { noDecal: { content: ["🐉"], placement: "back" } }], tags: ["move"] },
  { id: "d-star-bigger", start: { ...dress, decals: [{ kind: "shape", content: "star", placement: "back" }] }, say: "make the star bigger", expect: [{ decal: { content: ["star"], sizeGt: 1 } }, { path: "scale", absent: true }], tags: ["resize", "decal"] },

  // ---- style ----
  { id: "d-plaid", start: dress, say: "make it plaid", expect: [{ path: "pattern", equals: "plaid" }], tags: ["style"] },
  { id: "t-polka", start: top, say: "polka dots", expect: [{ path: "pattern", equals: "polka_dot" }], tags: ["style"] },
  { id: "bp-camo", start: backpack, say: "camo print", expect: [{ path: "pattern", equals: "camo" }], tags: ["style"] },
  { id: "d-leather", start: dress, say: "what about leather", expect: [{ path: "fabric", equals: "leather" }], tags: ["style"] },
  { id: "t-denim", start: top, say: "make it a denim shirt", expect: [{ path: "fabric", equals: "denim" }, { path: "category", equals: "top" }], tags: ["style"] },
  { id: "h-metallic", start: helmet, say: "make it shiny metallic", expect: [{ path: "finish", equals: "metallic" }], tags: ["style"] },
  { id: "bp-glow", start: backpack, say: "make it glow in the dark", expect: [{ path: "finish", equals: "glow" }], tags: ["style"] },
  { id: "t-turtleneck", start: top, say: "turtleneck", expect: [{ path: "neckline", equals: "turtleneck" }], tags: ["style"] },
  { id: "d-offshoulder", start: dress, say: "off the shoulder neckline", expect: [{ path: "neckline", equals: "off_shoulder" }], tags: ["style"] },
  { id: "t-three-quarter", start: top, say: "three quarter sleeves", expect: [{ path: "sleeves", equals: "three_quarter" }], tags: ["style"] },

  // ---- generic products ----
  { id: "g-mug", say: "a coffee mug with a cat on it", expect: [{ path: "category", equals: "generic" }, { path: "body.shape", equals: "cylinder" }, { decal: { content: ["cat", "🐱", "🐈"] } }], tags: ["generic"] },
  { id: "g-bottle-straw", start: bottle, say: "add a straw on top", expect: [{ addon: { name: ["straw"], placement: "top" } }], tags: ["generic", "addon"] },
  { id: "g-bottle-taller", start: bottle, say: "make it taller", expect: [{ path: "body.height", grew: true }], tags: ["generic", "resize"] },
  { id: "g-lamp", say: "I want a lamp shaped like a mushroom", expect: [{ path: "category", equals: "generic" }, { path: "body.shape", oneOf: ["cone", "sphere", "cylinder", "capsule"] }], tags: ["generic"] },

  // ---- multi-edit and noise ----
  { id: "bp-multi", start: backpack, say: "make it black and add a red star on the back", expect: [{ path: "color", family: "black" }, { decal: { content: ["star", "⭐"], placement: "back", family: "red" } }], tags: ["multi"] },
  { id: "d-filler", start: dress, say: "um, could you maybe make the, like, pockets bigger?", expect: [{ path: "parts.pockets.scale", grew: true }, { unchanged: ["length", "color", "sleeves"] }], tags: ["resize", "noise"] },
  { id: "h-bike-helmet", say: "a bike helmet with built-in headphones", expect: [{ path: "category", equals: "helmet" }, { path: "features", includes: "headphones" }, { noDecal: {} }], tags: ["noise"] },
  { id: "d-fresh", say: "I want a midi dress that turns into a skirt, with pockets that actually fit my phone", expect: [{ path: "category", equals: "dress" }, { path: "length", equals: "midi" }, { path: "features", includes: "converts_to_skirt" }, { path: "features", includes: "phone_pockets" }, { noDecal: {} }, { noAddon: {} }], tags: ["noise"] },
  { id: "h-question",start: helmet, say: "how much would this cost to make", expect: [{ unchanged: ["color", "features", "parts", "decals", "addons", "scale"] }], tags: ["noise"] },
];
