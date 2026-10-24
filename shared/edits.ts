import {
  CLOTHING, COLOR_NAMES, DECAL_SHAPES, LENGTHS, PARTS, SLEEVES,
  type Addon, type Body, type Category, type Decal, type PartStyle, type ProductSpec, type SpecPatch,
} from "./spec.ts";

/**
 * Offline interpreter for edit requests ("make the straps black", "draw a dragon on the back",
 * "add a cup holder", "remove the pockets"). Splits the utterance into clauses, works out each
 * clause's operation, target and placement, and returns a patch. Clauses it doesn't understand are
 * left for the keyword guess in guess.ts. The Claude brain doesn't use this; it writes the same
 * spec fields directly.
 */

type Placement = Decal["placement"];

export interface EditResult {
  patch: SpecPatch;
  /** Short phrases for the spoken reply, e.g. "bigger pockets", "a dragon on the back". */
  did: string[];
  /** Clauses nothing here handled; guess.ts reads these. */
  rest: string;
}

// ---------- Vocabularies ----------

/** Part names people use, per category. Longest phrases are tried first. */
const PART_WORDS: Record<Category, Record<string, string>> = {
  dress: {
    skirt: "skirt", "bottom half": "skirt", bodice: "bodice", "top half": "bodice", "top part": "bodice", torso: "bodice",
    sleeve: "sleeves", sleeves: "sleeves", arms: "sleeves", pocket: "pockets", pockets: "pockets", seam: "seam", "waist seam": "seam",
  },
  top: { bodice: "bodice", body: "bodice", torso: "bodice", sleeve: "sleeves", sleeves: "sleeves", arms: "sleeves" },
  skirt: { pocket: "pockets", pockets: "pockets" },
  backpack: {
    "main compartment": "body", "main pocket": "body", body: "body", "front pocket": "front_pocket", "front pouch": "front_pocket",
    pouch: "front_pocket", pocket: "front_pocket", strap: "straps", straps: "straps", "shoulder straps": "straps", "shoulder strap": "straps",
    handle: "handle", "top handle": "handle", "carry handle": "handle", loop: "handle", "side pocket": "side_pocket",
    "side pockets": "side_pocket", "phone pocket": "side_pocket", "bottle pocket": "side_pocket", "laptop stand": "stand", stand: "stand",
    tray: "stand", zipper: "zipper", zippers: "zipper", zip: "zipper", zips: "zipper", "zipper pull": "zipper",
  },
  helmet: {
    shell: "shell", dome: "shell", vent: "vents", vents: "vents", visor: "visor", brim: "visor", peak: "visor", sunshade: "visor",
    rim: "rim", trim: "rim", edge: "rim", headphones: "headphones", headphone: "headphones", "ear cups": "headphones",
    earcups: "headphones", speakers: "headphones",
  },
  generic: { body: "body", base: "body" },
};

/** Parts whose existence is a feature flag, so add/remove toggles the feature. */
const PART_FEATURE: Record<string, string> = {
  pockets: "phone_pockets", side_pocket: "phone_pockets", stand: "laptop_stand", headphones: "headphones", seam: "converts_to_skirt",
};

const SHAPE_WORDS: Record<string, (typeof DECAL_SHAPES)[number]> = {
  star: "star", stars: "star", heart: "heart", hearts: "heart", circle: "circle", circles: "circle", dot: "circle", square: "square",
  triangle: "triangle", diamond: "diamond", diamonds: "diamond", lightning: "lightning", "lightning bolt": "lightning", bolt: "lightning",
  thunderbolt: "lightning", moon: "moon", "crescent moon": "moon", crescent: "moon", sun: "sun", x: "x", cross: "x", check: "check",
  checkmark: "check", "check mark": "check", tick: "check", arrow: "arrow", arrows: "arrow", flower: "flower", flowers: "flower",
  daisy: "flower", smiley: "smiley", "smiley face": "smiley", "smiley faces": "smiley", "happy face": "smiley", smile: "smiley",
  "peace sign": "peace", peace: "peace", paw: "paw", "paw print": "paw", "paw prints": "paw", pawprint: "paw", "music note": "music_note",
  "musical note": "music_note", "music notes": "music_note", cloud: "cloud", clouds: "cloud", crown: "crown", spiral: "spiral", swirl: "spiral",
};

/** Pictures of things. Plurals and close synonyms map to the same emoji. */
const EMOJI_WORDS: Record<string, string> = {
  cat: "🐱", kitten: "🐱", kitty: "🐱", cats: "🐱", dog: "🐶", puppy: "🐶", dogs: "🐶", dragon: "🐉", dragons: "🐉", unicorn: "🦄",
  bear: "🐻", "golden bear": "🐻", bears: "🐻", panda: "🐼", fox: "🦊", lion: "🦁", tiger: "🐯", frog: "🐸", octopus: "🐙", shark: "🦈",
  whale: "🐳", dolphin: "🐬", fish: "🐟", butterfly: "🦋", butterflies: "🦋", bee: "🐝", ladybug: "🐞", bird: "🐦", birds: "🐦",
  eagle: "🦅", owl: "🦉", penguin: "🐧", duck: "🦆", bunny: "🐰", rabbit: "🐰", mouse: "🐭", horse: "🐴", cow: "🐮", pig: "🐷",
  monkey: "🐵", snake: "🐍", turtle: "🐢", dinosaur: "🦖", dino: "🦖", "t rex": "🦖", trex: "🦖", spider: "🕷️", skull: "💀",
  skulls: "💀", ghost: "👻", alien: "👽", robot: "🤖", rocket: "🚀", spaceship: "🚀", "rocket ship": "🚀", planet: "🪐", saturn: "🪐",
  earth: "🌍", globe: "🌍", world: "🌍", rainbow: "🌈", fire: "🔥", flame: "🔥", flames: "🔥", snowflake: "❄️", snowflakes: "❄️",
  tree: "🌲", "palm tree": "🌴", cactus: "🌵", mushroom: "🍄", rose: "🌹", roses: "🌹", sunflower: "🌻", tulip: "🌷",
  "cherry blossom": "🌸", leaf: "🍃", leaves: "🍃", "maple leaf": "🍁", clover: "🍀", shamrock: "🍀", pizza: "🍕", taco: "🌮",
  burger: "🍔", donut: "🍩", doughnut: "🍩", "ice cream": "🍦", cake: "🎂", cherry: "🍒", cherries: "🍒", strawberry: "🍓",
  strawberries: "🍓", apple: "🍎", avocado: "🥑", banana: "🍌", watermelon: "🍉", lemon: "🍋", coffee: "☕", wave: "🌊", waves: "🌊",
  mountain: "⛰️", mountains: "⛰️", volcano: "🌋", eye: "👁️", eyes: "👀", lips: "💋", kiss: "💋", sparkle: "✨", sparkles: "✨",
  umbrella: "☂️", anchor: "⚓", guitar: "🎸", basketball: "🏀", football: "🏈", "soccer ball": "⚽", soccer: "⚽", tennis: "🎾",
  baseball: "⚾", trophy: "🏆", medal: "🏅", camera: "📷", car: "🚗", bike: "🚲", bicycle: "🚲", airplane: "✈️", plane: "✈️",
  gem: "💎", jewel: "💎", crystal: "💎", money: "💰", "dollar sign": "💲", controller: "🎮", "game controller": "🎮", bomb: "💣",
  ninja: "🥷", pirate: "🏴‍☠️", "pirate flag": "🏴‍☠️", ufo: "🛸", key: "🔑", bell: "🔔", "eight ball": "🎱", "8 ball": "🎱",
  "yin yang": "☯️", infinity: "♾️", tornado: "🌪️", sunset: "🌅", palm: "🌴", seashell: "🐚", shell: "🐚", crab: "🦀",
  "golden gate bridge": "🌉", bridge: "🌉", "city skyline": "🏙️", skyline: "🏙️", house: "🏠", castle: "🏰",
};

interface AddonWord { name: string; shape: Addon["shape"]; at: Placement | ((c: Category) => Placement); count?: number; glow?: boolean; size?: number }
const side = (): Placement => "right";
const ADDON_WORDS: Record<string, AddonWord> = {
  "cup holder": { name: "cup holder", shape: "cylinder", at: side }, cupholder: { name: "cup holder", shape: "cylinder", at: side },
  "drink holder": { name: "cup holder", shape: "cylinder", at: side }, "bottle holder": { name: "bottle holder", shape: "cylinder", at: side },
  "water bottle holder": { name: "bottle holder", shape: "cylinder", at: side }, "umbrella holder": { name: "umbrella holder", shape: "cylinder", at: "left" },
  bow: { name: "bow", shape: "bow", at: (c) => (CLOTHING.includes(c) ? "back" : "top") }, ribbon: { name: "bow", shape: "bow", at: (c) => (CLOTHING.includes(c) ? "back" : "top") },
  belt: { name: "belt", shape: "torus", at: "waist" }, sash: { name: "sash", shape: "torus", at: "waist" },
  hood: { name: "hood", shape: "dome", at: (c) => (CLOTHING.includes(c) ? "back" : "top") },
  light: { name: "light", shape: "sphere", at: "front", glow: true }, lights: { name: "lights", shape: "sphere", at: "front", glow: true, count: 3 },
  led: { name: "LED light", shape: "sphere", at: "front", glow: true }, leds: { name: "LED lights", shape: "sphere", at: "front", glow: true, count: 4 },
  "led lights": { name: "LED lights", shape: "sphere", at: "front", glow: true, count: 4 }, "led strip": { name: "LED strip", shape: "box", at: "front", glow: true },
  headlight: { name: "headlight", shape: "sphere", at: "front", glow: true }, headlamp: { name: "headlamp", shape: "sphere", at: "front", glow: true },
  "tail light": { name: "tail light", shape: "sphere", at: "back", glow: true }, taillight: { name: "tail light", shape: "sphere", at: "back", glow: true },
  "brake light": { name: "brake light", shape: "sphere", at: "back", glow: true }, flashlight: { name: "flashlight", shape: "cylinder", at: "front", glow: true },
  horn: { name: "horns", shape: "cone", at: "top", count: 2 }, horns: { name: "horns", shape: "cone", at: "top", count: 2 },
  "cat ears": { name: "cat ears", shape: "cone", at: "top", count: 2 }, "bunny ears": { name: "bunny ears", shape: "capsule", at: "top", count: 2 },
  "bear ears": { name: "bear ears", shape: "sphere", at: "top", count: 2 }, ears: { name: "ears", shape: "cone", at: "top", count: 2 },
  antenna: { name: "antenna", shape: "cylinder", at: "top" }, antennas: { name: "antennas", shape: "cylinder", at: "top", count: 2 },
  antennae: { name: "antennas", shape: "cylinder", at: "top", count: 2 }, spike: { name: "spikes", shape: "spike", at: "top", count: 5 },
  spikes: { name: "spikes", shape: "spike", at: "top", count: 5 }, studs: { name: "studs", shape: "spike", at: "front", count: 5, size: 0.6 },
  wing: { name: "wings", shape: "fin", at: "back", count: 2 }, wings: { name: "wings", shape: "fin", at: "back", count: 2 },
  fin: { name: "fin", shape: "fin", at: "top" }, mohawk: { name: "mohawk", shape: "fin", at: "top" }, crest: { name: "crest", shape: "fin", at: "top" },
  tail: { name: "tail", shape: "cone", at: "back" }, handle: { name: "handle", shape: "torus", at: side },
  wheel: { name: "wheels", shape: "cylinder", at: "bottom", count: 2 }, wheels: { name: "wheels", shape: "cylinder", at: "bottom", count: 2 },
  keychain: { name: "keychain", shape: "torus", at: side, size: 0.6 }, "key chain": { name: "keychain", shape: "torus", at: side, size: 0.6 },
  charm: { name: "charm", shape: "torus", at: side, size: 0.6 }, carabiner: { name: "carabiner", shape: "torus", at: side, size: 0.6 },
  clip: { name: "clip", shape: "box", at: side, size: 0.6 }, "solar panel": { name: "solar panel", shape: "box", at: "top" },
  "solar panels": { name: "solar panels", shape: "box", at: "top" }, camera: { name: "camera", shape: "box", at: (c) => (c === "helmet" ? "top" : "front") },
  gopro: { name: "camera", shape: "box", at: "top" }, "go pro": { name: "camera", shape: "box", at: "top" },
  mirror: { name: "mirror", shape: "capsule", at: "left" }, "rear view mirror": { name: "mirror", shape: "capsule", at: "left" },
  "rearview mirror": { name: "mirror", shape: "capsule", at: "left" }, button: { name: "button", shape: "sphere", at: "front", size: 0.5 },
  buttons: { name: "buttons", shape: "sphere", at: "front", count: 3, size: 0.5 }, "usb port": { name: "USB port", shape: "box", at: side, size: 0.5 },
  "charging port": { name: "charging port", shape: "box", at: side, size: 0.5 }, "usb charger": { name: "USB charger", shape: "box", at: side, size: 0.5 },
  battery: { name: "battery pack", shape: "box", at: "back" }, "battery pack": { name: "battery pack", shape: "box", at: "back" },
  speaker: { name: "speaker", shape: "cylinder", at: "front" }, lock: { name: "lock", shape: "box", at: "front", size: 0.6 },
  padlock: { name: "lock", shape: "box", at: "front", size: 0.6 }, reflector: { name: "reflector", shape: "box", at: "back", glow: true },
  reflectors: { name: "reflectors", shape: "box", at: "back", glow: true, count: 2 }, "reflective strip": { name: "reflective strip", shape: "box", at: "back", glow: true },
  "reflective stripe": { name: "reflective strip", shape: "box", at: "back", glow: true }, "chin strap": { name: "chin strap", shape: "torus", at: "bottom" },
  straw: { name: "straw", shape: "cylinder", at: "top" }, lid: { name: "lid", shape: "cylinder", at: "top" }, cap: { name: "cap", shape: "cylinder", at: "top" },
  legs: { name: "legs", shape: "cylinder", at: "bottom", count: 3 }, feet: { name: "feet", shape: "sphere", at: "bottom", count: 3 },
  collar: { name: "collar", shape: "torus", at: "top" }, cape: { name: "cape", shape: "fin", at: "back" },
  ruffle: { name: "ruffles", shape: "torus", at: "bottom" }, ruffles: { name: "ruffles", shape: "torus", at: "bottom" },
  frill: { name: "ruffles", shape: "torus", at: "bottom" }, frills: { name: "ruffles", shape: "torus", at: "bottom" },
  fringe: { name: "fringe", shape: "cylinder", at: "bottom", count: 6, size: 0.5 }, tassel: { name: "tassels", shape: "cylinder", at: "bottom", count: 3, size: 0.6 },
  tassels: { name: "tassels", shape: "cylinder", at: "bottom", count: 5, size: 0.6 }, "pom pom": { name: "pom pom", shape: "sphere", at: "top" },
  pompom: { name: "pom pom", shape: "sphere", at: "top" }, feather: { name: "feather", shape: "fin", at: "top" }, feathers: { name: "feathers", shape: "fin", at: "top", count: 3 },
  chain: { name: "chain", shape: "torus", at: "front" }, "water bottle": { name: "water bottle", shape: "cylinder", at: side },
  "phone holder": { name: "phone holder", shape: "box", at: side }, "phone mount": { name: "phone mount", shape: "box", at: "front" },
  "laptop sleeve": { name: "laptop sleeve", shape: "box", at: "back" }, hook: { name: "hook", shape: "torus", at: side, size: 0.6 },
  "carry handle": { name: "handle", shape: "torus", at: "top" }, knob: { name: "knob", shape: "sphere", at: "top", size: 0.6 },
  screen: { name: "screen", shape: "box", at: "front", glow: true },
  holder: { name: "holder", shape: "cylinder", at: side }, kickstand: { name: "kickstand", shape: "box", at: "back" },
  "ring grip": { name: "ring grip", shape: "torus", at: "back" }, "grip ring": { name: "ring grip", shape: "torus", at: "back" },
  "finger ring": { name: "ring grip", shape: "torus", at: "back" }, popsocket: { name: "grip", shape: "cylinder", at: "back" },
  "pop socket": { name: "grip", shape: "cylinder", at: "back" }, grip: { name: "grip", shape: "box", at: "back" },
  visor: { name: "visor", shape: "fin", at: "front" }, "bottle opener": { name: "bottle opener", shape: "torus", at: side, size: 0.6 },
  "sun shade": { name: "sun shade", shape: "fin", at: "front" }, pocket: { name: "pocket", shape: "box", at: "front" },
  display: { name: "display", shape: "box", at: "front", glow: true }, "touch screen": { name: "screen", shape: "box", at: "front", glow: true },
  propeller: { name: "propeller", shape: "fin", at: "top" }, "jet pack": { name: "jet pack", shape: "cylinder", at: "back", count: 2 },
  jetpack: { name: "jet pack", shape: "cylinder", at: "back", count: 2 }, rocket: { name: "rockets", shape: "cylinder", at: "back", count: 2 },
  "tissue holder": { name: "tissue holder", shape: "box", at: side }, "pen holder": { name: "pen holder", shape: "cylinder", at: side },
};

/** Generic products: a body shape so the wish renders instantly, plus add-ons that make it read. */
const GENERIC_BODIES: Record<string, { name: string; body: Body; addons?: Addon[] }> = {
  mug: { name: "Mug", body: { shape: "cylinder", width: 0.36, height: 0.4 }, addons: [{ name: "handle", shape: "torus", placement: "right" }] },
  "coffee mug": { name: "Coffee Mug", body: { shape: "cylinder", width: 0.36, height: 0.4 }, addons: [{ name: "handle", shape: "torus", placement: "right" }] },
  cup: { name: "Cup", body: { shape: "cylinder", width: 0.34, height: 0.42 } },
  tumbler: { name: "Tumbler", body: { shape: "cylinder", width: 0.3, height: 0.6 } },
  bottle: { name: "Bottle", body: { shape: "cylinder", width: 0.28, height: 0.8 }, addons: [{ name: "cap", shape: "cylinder", placement: "top", size: 0.8 }] },
  "water bottle": { name: "Water Bottle", body: { shape: "cylinder", width: 0.28, height: 0.8 }, addons: [{ name: "cap", shape: "cylinder", placement: "top", size: 0.8 }] },
  thermos: { name: "Thermos", body: { shape: "cylinder", width: 0.28, height: 0.85 } },
  flask: { name: "Flask", body: { shape: "cylinder", width: 0.28, height: 0.7 } },
  can: { name: "Can", body: { shape: "cylinder", width: 0.28, height: 0.5 } },
  lamp: { name: "Lamp", body: { shape: "cone", width: 0.55, height: 0.4 }, addons: [{ name: "stand", shape: "cylinder", placement: "bottom" }] },
  "desk lamp": { name: "Desk Lamp", body: { shape: "cone", width: 0.5, height: 0.36 }, addons: [{ name: "stand", shape: "cylinder", placement: "bottom" }] },
  vase: { name: "Vase", body: { shape: "cylinder", width: 0.32, height: 0.7 } },
  planter: { name: "Planter", body: { shape: "cylinder", width: 0.55, height: 0.4 } },
  pot: { name: "Pot", body: { shape: "cylinder", width: 0.55, height: 0.4 } },
  "phone case": { name: "Phone Case", body: { shape: "box", width: 0.42, height: 0.82, depth: 0.08 } },
  case: { name: "Case", body: { shape: "box", width: 0.5, height: 0.6, depth: 0.2 } },
  wallet: { name: "Wallet", body: { shape: "box", width: 0.6, height: 0.4, depth: 0.08 } },
  box: { name: "Box", body: { shape: "box", width: 0.6, height: 0.5, depth: 0.6 } },
  "lunch box": { name: "Lunch Box", body: { shape: "box", width: 0.7, height: 0.45, depth: 0.4 } },
  speaker: { name: "Speaker", body: { shape: "cylinder", width: 0.4, height: 0.6 } },
  ball: { name: "Ball", body: { shape: "sphere", width: 0.6, height: 0.6 } },
  globe: { name: "Globe", body: { shape: "sphere", width: 0.6, height: 0.6 } },
  pillow: { name: "Pillow", body: { shape: "capsule", width: 0.8, height: 0.3, depth: 0.5 } },
  cushion: { name: "Cushion", body: { shape: "capsule", width: 0.8, height: 0.3, depth: 0.5 } },
  shoe: { name: "Shoe", body: { shape: "capsule", width: 0.9, height: 0.3, depth: 0.35 } },
  shoes: { name: "Shoes", body: { shape: "capsule", width: 0.9, height: 0.3, depth: 0.35 } },
  sneaker: { name: "Sneaker", body: { shape: "capsule", width: 0.9, height: 0.3, depth: 0.35 } },
  sneakers: { name: "Sneakers", body: { shape: "capsule", width: 0.9, height: 0.3, depth: 0.35 } },
  watch: { name: "Watch", body: { shape: "torus", width: 0.5, height: 0.5 }, addons: [{ name: "face", shape: "cylinder", placement: "front" }] },
  ring: { name: "Ring", body: { shape: "torus", width: 0.45, height: 0.45 } },
  bracelet: { name: "Bracelet", body: { shape: "torus", width: 0.55, height: 0.55 } },
  chair: { name: "Chair", body: { shape: "box", width: 0.6, height: 0.1, depth: 0.6 }, addons: [{ name: "legs", shape: "cylinder", placement: "bottom", count: 4 }, { name: "backrest", shape: "box", placement: "back" }] },
  stool: { name: "Stool", body: { shape: "cylinder", width: 0.5, height: 0.1 }, addons: [{ name: "legs", shape: "cylinder", placement: "bottom", count: 3 }] },
  table: { name: "Table", body: { shape: "box", width: 1, height: 0.08, depth: 0.7 }, addons: [{ name: "legs", shape: "cylinder", placement: "bottom", count: 4 }] },
  desk: { name: "Desk", body: { shape: "box", width: 1.1, height: 0.08, depth: 0.6 }, addons: [{ name: "legs", shape: "cylinder", placement: "bottom", count: 4 }] },
  hat: { name: "Hat", body: { shape: "sphere", width: 0.6, height: 0.45 }, addons: [{ name: "brim", shape: "torus", placement: "bottom" }] },
  cap: { name: "Cap", body: { shape: "sphere", width: 0.6, height: 0.45 }, addons: [{ name: "brim", shape: "fin", placement: "front" }] },
  "beanie": { name: "Beanie", body: { shape: "sphere", width: 0.6, height: 0.5 }, addons: [{ name: "pom pom", shape: "sphere", placement: "top" }] },
  candle: { name: "Candle", body: { shape: "cylinder", width: 0.3, height: 0.6 }, addons: [{ name: "flame", shape: "cone", placement: "top", glow: true, size: 0.6 }] },
  clock: { name: "Clock", body: { shape: "cylinder", width: 0.7, height: 0.12 } },
  headphones: { name: "Headphones", body: { shape: "torus", width: 0.7, height: 0.7 }, addons: [{ name: "ear cups", shape: "cylinder", placement: "bottom", count: 2 }] },
  umbrella: { name: "Umbrella", body: { shape: "cone", width: 1.1, height: 0.35 }, addons: [{ name: "pole", shape: "cylinder", placement: "bottom" }] },
  tent: { name: "Tent", body: { shape: "cone", width: 1, height: 0.8 } },
  skateboard: { name: "Skateboard", body: { shape: "capsule", width: 1.1, height: 0.06, depth: 0.3 }, addons: [{ name: "wheels", shape: "cylinder", placement: "bottom", count: 4 }] },
  drone: { name: "Drone", body: { shape: "box", width: 0.45, height: 0.12, depth: 0.45 }, addons: [{ name: "propellers", shape: "fin", placement: "top", count: 4 }] },
  robot: { name: "Robot", body: { shape: "box", width: 0.5, height: 0.6, depth: 0.4 }, addons: [{ name: "antenna", shape: "cylinder", placement: "top" }] },
  toy: { name: "Toy", body: { shape: "sphere", width: 0.5, height: 0.5 } },
  plushie: { name: "Plushie", body: { shape: "sphere", width: 0.55, height: 0.6 }, addons: [{ name: "ears", shape: "sphere", placement: "top", count: 2 }] },
  "stuffed animal": { name: "Stuffed Animal", body: { shape: "sphere", width: 0.55, height: 0.6 }, addons: [{ name: "ears", shape: "sphere", placement: "top", count: 2 }] },
  "pencil case": { name: "Pencil Case", body: { shape: "capsule", width: 0.8, height: 0.22, depth: 0.25 } },
  notebook: { name: "Notebook", body: { shape: "box", width: 0.5, height: 0.7, depth: 0.06 } },
  "phone stand": { name: "Phone Stand", body: { shape: "box", width: 0.4, height: 0.5, depth: 0.25 } },
  charger: { name: "Charger", body: { shape: "box", width: 0.35, height: 0.12, depth: 0.35 } },
  "power bank": { name: "Power Bank", body: { shape: "box", width: 0.35, height: 0.6, depth: 0.1 } },
  keyboard: { name: "Keyboard", body: { shape: "box", width: 1, height: 0.06, depth: 0.35 } },
  mouse: { name: "Mouse", body: { shape: "capsule", width: 0.3, height: 0.15, depth: 0.45 } },
  "fish tank": { name: "Fish Tank", body: { shape: "box", width: 0.9, height: 0.55, depth: 0.45 } },
  aquarium: { name: "Aquarium", body: { shape: "box", width: 0.9, height: 0.55, depth: 0.45 } },
  "bird feeder": { name: "Bird Feeder", body: { shape: "cylinder", width: 0.35, height: 0.5 }, addons: [{ name: "roof", shape: "cone", placement: "top" }] },
  birdhouse: { name: "Birdhouse", body: { shape: "box", width: 0.45, height: 0.5, depth: 0.45 }, addons: [{ name: "roof", shape: "cone", placement: "top" }] },
};

/** Generic body shape words, for "shaped like a cube" / "make it round". */
const SHAPE_HINT: [RegExp, Body["shape"]][] = [
  [/\b(round|ball|sphere|spherical|orb|globe)\b/, "sphere"], [/\b(cube|square|boxy|rectangular|box)\b/, "box"],
  [/\b(cylinder|cylindrical|tube|tubular)\b/, "cylinder"], [/\b(cone|pyramid|conical)\b/, "cone"],
  [/\b(donut|doughnut|ring)\b/, "torus"], [/\b(pill|capsule|oval)\b/, "capsule"], [/\bmushroom\b/, "cone"],
];

// ---------- Small helpers ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sortedKeys = (o: object) => Object.keys(o).sort((a, b) => b.length - a.length);
const SHAPE_KEYS = sortedKeys(SHAPE_WORDS);
const EMOJI_KEYS = sortedKeys(EMOJI_WORDS);
const ADDON_KEYS = sortedKeys(ADDON_WORDS);
const GENERIC_KEYS = sortedKeys(GENERIC_BODIES);
const COLOR_KEYS = sortedKeys(COLOR_NAMES);

/** First vocabulary phrase found in t (longest phrases win), with its position. */
function findWord(t: string, keys: string[]): { key: string; at: number } | null {
  let best: { key: string; at: number } | null = null;
  for (const k of keys) {
    const m = new RegExp(`(?:^|[^a-z0-9])${esc(k)}(?=$|[^a-z0-9])`).exec(t);
    if (m && (!best || k.length > best.key.length)) best = { key: k, at: m.index };
  }
  return best;
}

/**
 * The color a clause asks for. With several, the one closest to `near` (the target's word) wins,
 * else the first one said. A color right before a pattern word ("white polka dots") is the
 * pattern's, not the product's.
 */
export function findColor(t: string, near?: string): string | null {
  const hexm = t.match(/#[0-9a-f]{6}\b/i);
  if (hexm) return hexm[0].toUpperCase();
  const hits: { at: number; hex: string }[] = [];
  const taken: [number, number][] = [];
  for (const n of COLOR_KEYS) {
    const re = new RegExp(`(?:^|[^a-z])(${esc(n)})(?=$|[^a-z])`, "g");
    for (let m; (m = re.exec(t)); ) {
      const at = m.index + m[0].indexOf(m[1]);
      if (taken.some(([a, b]) => at >= a && at < b)) continue; // "forest green" already claimed "green"
      taken.push([at, at + n.length]);
      const after = t.slice(at + n.length, at + n.length + 16);
      if (/^\s*(polka|dots|spots|stripes|pinstripes|checks|plaid|florals)\b/.test(after)) continue;
      hits.push({ at, hex: COLOR_NAMES[n] });
    }
  }
  if (!hits.length) return null;
  const anchor = near ? t.indexOf(near) : -1;
  hits.sort((a, b) => (anchor >= 0 ? Math.abs(a.at - anchor) - Math.abs(b.at - anchor) : a.at - b.at));
  return hits[0].hex;
}

const PLACEMENT_RES: [RegExp, Placement][] = [
  [/\b(?:on|to|at|across|onto|in) (?:the |its |his |her )?(?:back|rear|backside)\b|\bback of\b|\bbehind\b|\bon the back\b/, "back"],
  [/\b(?:on|to|at|across|onto) (?:the |its )?(?:front|chest)\b|\bfront of\b|\bon the chest\b|\bchest\b/, "front"],
  [/\bleft\b/, "left"],
  [/\bright (?:side|sleeve|strap|pocket)\b|\b(?:on|to|at) (?:the )?right\b/, "right"],
  [/\b(?:on|to|at) (?:the )?sides?\b|\bside\b|\bsleeve\b/, "right"],
  [/\b(?:on|to|at) top\b|\b(?:on|to|at) the top\b|\bon its head\b|\bon the head\b|\bshoulders?\b|\bcollar\b|\bneck\b/, "top"],
  [/\bbottom\b|\bhem\b|\bunderneath\b|\bunder it\b|\bbase\b|\bacross the skirt\b|\bon the skirt\b/, "bottom"],
  [/\bwaist\b|\baround the middle\b|\bmidsection\b/, "waist"],
];

function findPlacement(t: string): Placement | null {
  for (const [re, p] of PLACEMENT_RES) if (re.test(t)) return p;
  return null;
}
const ALL_OVER = /\b(all over|everywhere|covered (?:in|with)|all around|on every side)\b/;

function amount(t: string): number {
  if (/\b(twice|double)\b/.test(t)) return 2;
  if (/\bby half\b/.test(t)) return UP.test(t) ? 1.5 : 2;
  if (/\b(in half|half the size|halve|half as (?:big|large|long|tall|wide|thick|full|high|bulky|heavy looking)|half (?:the|its) (?:size|length|width|height)|half size)\b/.test(t)) return 2;
  if (/\b(a lot|way|much|really|super|very|huge|giant|massive|enormous|tons|extra)\b/.test(t)) return 1.6;
  if (/\b(a little|a bit|slightly|a tad|tiny bit|somewhat|little bit)\b/.test(t)) return 1.15;
  return 1.3;
}

const UP = /\b(bigger|larger|huge|giant|enormous|massive|wider|thicker|chunkier|taller|longer|lengthen|enlarge|grow|scale (?:it |them )?up|double|twice|biggest|beefier|beef (?:it |them )?up|bulk (?:it |them )?up|bulkier|heftier|puffier|fuller|deeper|roomier|more room|more space|spacious|extend|supersize|blow (?:it |them )?up)\b/;
const DOWN = /\b(smaller|tiny|tinier|thinner|narrower|shorter|shorten|shrink|scale (?:it |them )?(?:down|back)|slimmer|slim (?:it |them )?down|in half|half the size|halve|half as (?:big|large|long|tall|wide|thick|full|high|bulky|heavy looking)|half (?:the|its) (?:size|length|width|height)|half size|(?:cut|reduce)(?: \w+){0,3} by half|less bulky|more compact|skinnier|smallest|lower profile|cut (?:it |them )?(?:way )?down|trim (?:it |them )?down|tone (?:it |them )?down|dial (?:it |them )?back|less big|not so big|take (?:it|them) up)\b/;
const REMOVE = /\b(remove|delete|take (?:it |them )?(?:off|away|out)|get rid of|lose|ditch|drop|no more|don'?t (?:want|need)|do not (?:want|need)|never use|won'?t (?:use|need)|no need for|leave (?:off|out)|nix|erase|without|cut (?:off|out)|scrap|kill|skip the)\b/;
const MOVE = /\b(move|shift|relocate|put (?:it|them) on|switch (?:it|them) to|instead|rather have|should be on|would look better on|to the other side)\b/;
// "print" only as a verb: "leopard print" is a pattern.
const DRAW = /\b(draw|paint|write|spell|stamp|embroider|engrave|sketch|doodle|monogram|airbrush|emblazon|scribble|graffiti)\b|\bprint (?:a|an|the|my|our|some|on|out|it|them)\b/;
const ADD = /\b(add|put|attach|stick|place|give (?:it|me)|include|with|needs?|want|like|have|slap|throw on|mount|install|plus|can (?:it|you) (?:have|get)|should have|got|be cool if|be nice if|would love)\b/;
const DECAL_NOUN = /\b(design|decal|drawing|graphic|picture|image|sticker|patch|emblem|icon|symbol|logo|print of|illustration|art|artwork|motif|silhouette)\b/;
const WHOLE = /\b(it|everything|overall|all of it|whole|entire|the (?:thing|product|dress|top|skirt|backpack|bag|helmet|shirt|gown))\b/;
const PRONOUN = /\b(it|them|they|those|that one|this one|that|this)\b/;
/** "the pockets are tiny" asks for bigger pockets; "the visor is huge" for a smaller one. */
const COMPLAINT_SMALL = /\b(?:is|are|'s|'re|looks?|feels?|seems?|kinda|kind of)\s+(?:a (?:bit|little) |kind of |kinda |way |so |really |too |pretty |super |very )*(?:tiny|small|little|short|thin|skinny|narrow|cramped|puny|weak|flimsy)\b|\btoo (?:small|tiny|short|thin|skinny|narrow)\b/;
const COMPLAINT_BIG = /\b(?:is|are|'s|'re|looks?|feels?|seems?|kinda|kind of)\s+(?:a (?:bit|little) |kind of |kinda |way |so |really |too |pretty |super |very )*(?:huge|big|large|long|bulky|thick|wide|massive|giant|enormous|overwhelming)\b|\btoo (?:big|large|long|bulky|thick|wide|much)\b|\bsticks? out\b/;

interface Ctx {
  spec: ProductSpec;
  category: Category;
  features: Set<string>;
  parts: Record<string, PartStyle | null>;
  decals: Decal[];
  addons: Addon[];
  touched: Set<"features" | "parts" | "decals" | "addons" | "scale" | "sleeves" | "length" | "body" | "pattern">;
  patch: SpecPatch;
  did: string[];
}

function findPart(t: string, cat: Category): string | null {
  const words = PART_WORDS[cat];
  const hit = findWord(t, sortedKeys(words));
  return hit ? words[hit.key] : null;
}

/** An existing decal the clause refers to: by its content, the emoji's word, or a generic word like "the logo". */
function findDecal(t: string, decals: Decal[]): number {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    const c = d.content.toLowerCase();
    if (c.length > 1 && t.includes(c)) return i;
    if (d.kind === "shape" && SHAPE_KEYS.some((k) => SHAPE_WORDS[k] === d.content && new RegExp(`\\b${esc(k)}\\b`).test(t))) return i;
    if (d.kind === "emoji" && EMOJI_KEYS.some((k) => EMOJI_WORDS[k] === d.content && new RegExp(`\\b${esc(k)}\\b`).test(t))) return i;
  }
  if (decals.length && /\b(the |that |this )(design|decal|drawing|graphic|picture|image|sticker|patch|logo|text|writing|words|lettering|print|name|number|initials|emblem)\b/.test(t)) {
    const p = findPlacement(t);
    for (let i = decals.length - 1; i >= 0; i--) if (!p || decals[i].placement === p || MOVE.test(t)) return i;
  }
  return -1;
}

function findAddon(t: string, addons: Addon[]): number {
  for (let i = addons.length - 1; i >= 0; i--) {
    const words = addons[i].name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    const stems = words.map((w) => w.replace(/s$/, ""));
    if (stems.some((w) => new RegExp(`\\b${esc(w)}s?\\b`).test(t))) return i;
  }
  return -1;
}

/** What a draw / write / "put X on" clause wants drawn. */
function decalContent(raw: string, t0: string): Pick<Decal, "kind" | "content"> | null {
  // The product's own name isn't a picture: "a coffee mug with a cat on it" draws a cat, not coffee.
  const product = findWord(t0, GENERIC_KEYS);
  const t = product ? t0.slice(0, product.at + 1) + " ".repeat(product.key.length) + t0.slice(product.at + 1 + product.key.length) : t0;
  const quoted = raw.match(/["“”']([^"“”']{1,24})["“”']/);
  if (quoted && /\w/.test(quoted[1]) && !/^(s|re|ll|ve|d|m|t)\b/i.test(quoted[1])) return { kind: "text", content: quoted[1].trim() };
  const says = raw.match(/\b(?:that|which|to|it|so it) (?:says?|reads?|spells?)\s+(.+?)(?=\s+(?:on|across|along|onto|in|at|over)\s+(?:the|it|its|my|big|bold)\b|$)/i)
    ?? raw.match(/\b(?:saying|reading|with the words?|the words?|the text|the phrase|the slogan)\s+(.+?)(?=\s+(?:on|across|along|onto|in|at|over)\s+(?:the|it|its|my|big|bold)\b|$)/i);
  if (says) return { kind: "text", content: says[1].replace(/^["“']|["”']$/g, "").trim().slice(0, 24) };
  const num = t.match(/\b(?:number|no\.?|jersey number|#)\s*(\d{1,3})\b/);
  if (num) return { kind: "text", content: num[1] };
  // A bare number to put on it: "a big 99 on the back". Prices and sizes are not decals.
  const bare = t.match(/\b(?:put|add|print|stick|write|stamp|slap|with|want|have)\s+(?:a |an |the )?(?:big |large |huge |giant |small |little |tiny |bold |red |white |black |gold )*(\d{1,3})\b(?!\s*(?:dollars|bucks|usd|%|percent|inch|inches|cm|mm|pockets?|of|more|x\b))/);
  if (bare && !/\$|\b(pay|price|cost|budget|size)\b/.test(t)) return { kind: "text", content: bare[1] };
  // Words said in capitals ("put CAL HACKS on it") or "in big letters" are text to print.
  const caps = raw.match(/\b([A-Z][A-Z0-9'!&]+(?:\s+[A-Z0-9][A-Z0-9'!&]*){0,3})\b/);
  if (caps && !/^(I|A|LED|LEDS|USB|GPS|UV|XL|XXL|XS|TV|AI|OK|S|M|L|DIY|UFO|USA)$/.test(caps[1]) && caps[1].replace(/[^A-Z]/g, "").length >= 2) return { kind: "text", content: caps[1].slice(0, 24) };
  const lettered = raw.match(/\b(?:put|add|print|write|stick|stamp|with)\s+(?:the (?:word|words|text)\s+)?(.+?)\s+(?:on (?:it|the \w+)\s+)?in (?:big |bold |small |huge |giant |block |bubble |cursive |gold |white |black )*(?:letters|lettering|font|caps|capitals|type)\b/i);
  if (lettered) return { kind: "text", content: lettered[1].replace(/\s+on (?:it|the \w+)$/i, "").replace(/^(a|an|the)\s+/i, "").trim().slice(0, 24) };
  const letter = raw.match(/\bthe letters? ([a-z](?:\s*(?:and\s+)?[a-z]){0,3})\b/i);
  if (letter) return { kind: "text", content: letter[1].replace(/\s|and/gi, "").toUpperCase() };
  const initials = raw.match(/\binitials?\s+(?:are\s+)?((?:[a-z]\.?\s*){1,3})(?=\s|$)/i);
  if (initials && /\binitials?\b/i.test(raw)) return { kind: "text", content: initials[1].replace(/[\s.]/g, "").toUpperCase() };
  if (/\binitials?\b/.test(t)) return { kind: "text", content: "AB" };
  const name = raw.match(/\bmy name(?:,| is|,? which is)?\s+([A-Z][a-z]+|[a-z]+)\b/);
  if (name && !/^(on|in|across|at)$/i.test(name[1])) return { kind: "text", content: name[1] };
  if (/\bmy name\b/.test(t)) return { kind: "text", content: "NAME" };
  const write = raw.match(/\b(?:write|spell(?: out)?|letter|monogram)\s+(?:out\s+)?(?:the (?:word|words|text)\s+)?(.+?)(?=\s+(?:on|across|along|onto|in|at|over|down)\s+(?:the|it|its|my|top|front|back)\b|$)/i);
  if (write) return { kind: "text", content: write[1].replace(/^(a|an|the)\s+/i, "").trim().slice(0, 24) };
  const shape = findWord(t, SHAPE_KEYS);
  const emoji = findWord(t, EMOJI_KEYS);
  // "lightning bolt" beats "bolt"; when both match, the longer, earlier phrase wins.
  if (shape && (!emoji || shape.key.length >= emoji.key.length)) return { kind: "shape", content: SHAPE_WORDS[shape.key] };
  if (emoji) return { kind: "emoji", content: EMOJI_WORDS[emoji.key] };
  // "a logo for Cal Hacks", "a Berkeley logo": draw the name as text.
  const logo = raw.match(/\b(?:an?|the|our|my)\s+([A-Za-z][\w ]{1,20}?)\s+(?:logo|emblem|crest)\b/i) ?? raw.match(/\b(?:logo|emblem) (?:for|of) ([A-Za-z][\w ]{1,20})/i);
  if (logo) return { kind: "text", content: logo[1].trim() };
  return null;
}

function decalSize(t: string): number | undefined {
  if (/\b(huge|giant|massive|enormous|really big|large|big)\b/.test(t)) return /\b(huge|giant|massive|enormous|really big)\b/.test(t) ? 1.8 : 1.45;
  if (/\b(tiny|small|little|mini|subtle)\b/.test(t)) return /\btiny\b/.test(t) ? 0.5 : 0.7;
  return undefined;
}

/** The noun phrase after an add verb, minus articles, sizes and colors: "a big red cup holder" -> "cup holder". */
function nounAfterAdd(t: string): string | null {
  const m = t.match(/\b(?:add|attach|put|stick|give it|include|install|mount|with|needs?|want|have)\s+(?:on\s+)?(?:a|an|some|two|three|four|a pair of|a couple of|the|little|big)?\s*(.+?)(?=\s+(?:on|to|at|onto|in|for|that|which|so|near|by|around|across|under|underneath)\b|$)/);
  if (!m) return null;
  const drop = new Set(["a", "an", "some", "the", "big", "small", "little", "tiny", "huge", "large", "giant", "cool", "nice", "new", "built", "in", "built-in", "builtin", "real", "really", "super", "very", "it", "please", "too", "also", "of", "pair", "couple"]);
  const words = m[1].split(/\s+/).filter((w) => w && !drop.has(w) && !COLOR_NAMES[w] && !/^\d+$/.test(w));
  const phrase = words.slice(-3).join(" ").trim();
  return phrase.length >= 3 ? phrase : null;
}

const NOT_ADDONS = /\b(pockets?|sleeves?|stand|headphones?|speakers?|pattern|stripes?|dots?|plaid|floral|color|colour|fabric|price|size|zipper|neckline|collar line|length|skirt|bodice|feature|option|look|vibe|style|logo|design|text|name|it)\b/;

// ---------- Clause handlers ----------

function setPart(ctx: Ctx, name: string, style: PartStyle | null) {
  ctx.parts[name] = style === null ? null : { ...(ctx.parts[name] ?? ctx.spec.parts?.[name] ?? {}), ...style };
  ctx.touched.add("parts");
}
const partScale = (ctx: Ctx, name: string) => (ctx.parts[name] ?? ctx.spec.parts?.[name])?.scale ?? 1;
const pretty = (s: string) => s.replace(/_/g, " ");

function stepSleeves(ctx: Ctx, dir: 1 | -1) {
  const order = SLEEVES.filter((s) => s !== "puff");
  const cur = ctx.patch.sleeves ?? ctx.spec.sleeves ?? (ctx.category === "top" ? "short" : "none");
  const i = Math.max(0, order.indexOf(cur === "puff" ? "short" : cur));
  ctx.patch.sleeves = order[Math.min(order.length - 1, Math.max(0, i + dir))];
  ctx.did.push(dir > 0 ? "longer sleeves" : "shorter sleeves");
}
function stepLength(ctx: Ctx, dir: 1 | -1) {
  const i = LENGTHS.indexOf(ctx.patch.length ?? ctx.spec.length ?? "midi");
  ctx.patch.length = LENGTHS[Math.min(LENGTHS.length - 1, Math.max(0, i + dir))];
  ctx.did.push(dir > 0 ? "a longer hem" : "a shorter hem");
}

function removeClause(t: string, ctx: Ctx): boolean {
  if (/\b(all|every|the) (decals|designs|drawings|stickers|graphics|text|writing|pictures)\b|\bclear the (?:decals|designs)\b/.test(t)) {
    ctx.decals = [];
    ctx.touched.add("decals");
    ctx.did.push("no more designs");
    return true;
  }
  if (/\b(everything (?:i|we) added|all (?:the )?(?:extras|add ?ons|attachments|accessories))\b/.test(t)) {
    ctx.addons = [];
    ctx.decals = [];
    ctx.touched.add("addons").add("decals");
    ctx.did.push("back to basics");
    return true;
  }
  const di = findDecal(t, ctx.decals);
  if (di >= 0) {
    ctx.did.push(`no ${ctx.decals[di].kind === "text" ? `"${ctx.decals[di].content}"` : "design"}`);
    ctx.decals = ctx.decals.filter((_, i) => i !== di);
    ctx.touched.add("decals");
    return true;
  }
  const ai = findAddon(t, ctx.addons);
  if (ai >= 0) {
    ctx.did.push(`no ${ctx.addons[ai].name}`);
    ctx.addons = ctx.addons.filter((_, i) => i !== ai);
    ctx.touched.add("addons");
    return true;
  }
  const part = findPart(t, ctx.category);
  if (part === "sleeves") {
    ctx.patch.sleeves = "none";
    ctx.did.push("sleeveless");
    return true;
  }
  if (part) {
    const f = PART_FEATURE[part];
    if (f) {
      ctx.features.delete(f);
      ctx.touched.add("features");
    } else setPart(ctx, part, { hidden: true });
    ctx.did.push(`no ${pretty(part)}`);
    return true;
  }
  const feats: [RegExp, string][] = [
    [/\bpockets?\b/, "phone_pockets"], [/\b(laptop )?stand\b/, "laptop_stand"], [/\b(headphones?|speakers?|audio)\b/, "headphones"],
    [/\b(convert|converts|convertible|conversion|zip ?off|detachable)\b/, "converts_to_skirt"],
  ];
  for (const [re, f] of feats)
    if (re.test(t) && ctx.features.has(f)) {
      ctx.features.delete(f);
      ctx.touched.add("features");
      ctx.did.push(`no ${pretty(f)}`);
      return true;
    }
  if (/\b(pattern|print|stripes?|dots|polka|plaid|florals?|flowers|camo|leopard|checks?|chevron)\b/.test(t)) {
    ctx.patch.pattern = "solid";
    ctx.touched.add("pattern");
    ctx.did.push("a solid color");
    return true;
  }
  if (/\b(glow|shine|shiny|gloss)\b/.test(t)) {
    ctx.patch.finish = "matte";
    ctx.did.push("a matte finish");
    return true;
  }
  return false;
}

/** The word for whatever the clause points at (a decal, an add-on or a part), for resolving "it" later. */
function targetWord(t: string, ctx: Ctx): string | null {
  const di = findDecal(t, ctx.decals);
  if (di >= 0) {
    const d = ctx.decals[di];
    if (d.kind === "text") return d.content.toLowerCase();
    const keys = d.kind === "shape" ? SHAPE_KEYS.filter((k) => SHAPE_WORDS[k] === d.content) : EMOJI_KEYS.filter((k) => EMOJI_WORDS[k] === d.content);
    return keys.find((k) => new RegExp(`\\b${esc(k)}\\b`).test(t)) ?? keys[keys.length - 1] ?? null;
  }
  const ai = findAddon(t, ctx.addons);
  if (ai >= 0) return ctx.addons[ai].name.toLowerCase();
  const words = PART_WORDS[ctx.category];
  const hit = findWord(t, sortedKeys(words));
  return hit ? hit.key : null;
}

/** "Change the text to say GO BEARS": rewrite an existing text decal instead of adding another. */
function retextClause(raw: string, t: string, ctx: Ctx): boolean {
  const texts = ctx.decals.map((d, i) => [d, i] as const).filter(([d]) => d.kind === "text");
  if (!texts.length || !/\b(change|replace|swap|edit|update|make|switch|instead)\b/.test(t)) return false;
  if (!/\b(text|words?|writing|lettering|name|says?|slogan|number|letters|initials|it)\b/.test(t)) return false;
  const c = decalContent(raw, t);
  if (!c || c.kind !== "text") return false;
  const [, i] = texts.find(([d]) => t.includes(d.content.toLowerCase())) ?? texts[texts.length - 1];
  if (ctx.decals[i].content === c.content) return false;
  ctx.decals = ctx.decals.map((d, k) => (k === i ? { ...d, content: c.content } : d));
  ctx.touched.add("decals");
  ctx.did.push(`"${c.content}" instead`);
  return true;
}

function moveClause(t: string, ctx: Ctx): boolean {
  let p = findPlacement(t.replace(/^.*?\b(?:to|onto|on)\b/, " on ")) ?? findPlacement(t);
  if (/\bother side\b/.test(t)) p = null;
  let di = findDecal(t, ctx.decals);
  let ai = di < 0 ? findAddon(t, ctx.addons) : -1;
  // "Move it to the side" on a later turn: the newest design, else the newest add-on.
  if (di < 0 && ai < 0 && PRONOUN.test(t)) {
    if (ctx.decals.length) di = ctx.decals.length - 1;
    else if (ctx.addons.length) ai = ctx.addons.length - 1;
  }
  const cur = di >= 0 ? ctx.decals[di].placement : ai >= 0 ? ctx.addons[ai].placement : null;
  const flip: Record<string, Placement> = { left: "right", right: "left", front: "back", back: "front", top: "bottom", bottom: "top", waist: "front" };
  if (!p && /\bother side\b/.test(t) && cur) p = flip[cur];
  // "to the side" from the left/right is the other side; from anywhere else it's the right.
  if (p === "right" && /\bto the side\b/.test(t) && cur === "right") p = "left";
  if (!p) return false;
  if (di >= 0) {
    ctx.decals = ctx.decals.map((d, i) => (i === di ? { ...d, placement: p! } : d));
    ctx.touched.add("decals");
    ctx.did.push(`moved to the ${p}`);
    return true;
  }
  if (ai >= 0) {
    ctx.addons = ctx.addons.map((a, i) => (i === ai ? { ...a, placement: p! } : a));
    ctx.touched.add("addons");
    ctx.did.push(`moved to the ${p}`);
    return true;
  }
  return false;
}

/** +1 bigger, -1 smaller, 0 no size request. Complaints point the other way ("too small" means bigger). */
function sizeDir(t: string): 1 | -1 | 0 {
  const small = COMPLAINT_SMALL.test(t), big = COMPLAINT_BIG.test(t);
  if (small !== big) return small ? 1 : -1;
  const up = UP.test(t), down = DOWN.test(t);
  return up === down ? 0 : up ? 1 : -1;
}
const isComplaint = (t: string) => COMPLAINT_SMALL.test(t) || COMPLAINT_BIG.test(t);

function resizeClause(t: string, ctx: Ctx): boolean {
  const dir = sizeDir(t);
  if (!dir) return false;
  const f = Math.pow(amount(t), dir);
  const lengthy = /\b(longer|shorter|shorten|lengthen|long|short|hem|take (?:it|them) up)\b/.test(t);
  const di = findDecal(t, ctx.decals);
  if (di >= 0 && !/\b(text|writing|letters|font)\b.*\b(longer|shorter)\b/.test(t)) {
    ctx.decals = ctx.decals.map((d, i) => (i === di ? { ...d, size: clamp((d.size ?? 1) * f, 0.3, 3) } : d));
    ctx.touched.add("decals");
    ctx.did.push(dir > 0 ? "a bigger design" : "a smaller design");
    return true;
  }
  const ai = findAddon(t, ctx.addons);
  if (ai >= 0) {
    ctx.addons = ctx.addons.map((a, i) => (i === ai ? { ...a, size: clamp((a.size ?? 1) * f, 0.3, 3) } : a));
    ctx.touched.add("addons");
    ctx.did.push(`${dir > 0 ? "a bigger" : "a smaller"} ${ctx.addons[ai].name}`);
    return true;
  }
  const part = findPart(t, ctx.category);
  if (part === "sleeves" && lengthy) {
    stepSleeves(ctx, dir);
    return true;
  }
  if (part === "skirt" && lengthy && ctx.category !== "top") {
    stepLength(ctx, dir);
    return true;
  }
  if (part) {
    const feat = PART_FEATURE[part];
    if (feat && !ctx.features.has(feat) && dir > 0) {
      ctx.features.add(feat);
      ctx.touched.add("features");
    }
    setPart(ctx, part, { scale: clamp(partScale(ctx, part) * f, 0.3, 3) });
    ctx.did.push(`${dir > 0 ? "bigger" : "smaller"} ${pretty(part)}`);
    return true;
  }
  if (CLOTHING.includes(ctx.category) && lengthy) {
    stepLength(ctx, dir);
    return true;
  }
  // Generic bodies stretch along the axis that was named.
  const body = ctx.patch.body ?? ctx.spec.body;
  if (ctx.category === "generic" && body && /\b(taller|shorter|wider|narrower|thicker|thinner|fatter|skinnier|slimmer)\b/.test(t)) {
    const axis = /\b(taller|shorter)\b/.test(t) ? "height" : /\b(thicker|thinner|fatter)\b/.test(t) && body.depth ? "depth" : "width";
    const max = axis === "height" ? 1.4 : 1.2;
    ctx.patch.body = { ...body, [axis]: clamp((body[axis] ?? 0.5) * f, 0.1, max) };
    ctx.touched.add("body");
    ctx.did.push(`${dir > 0 ? "more" : "less"} ${axis}`);
    return true;
  }
  if (WHOLE.test(t) || !/\b(the|its)\s+\w+/.test(t)) {
    ctx.patch.scale = clamp((ctx.patch.scale ?? ctx.spec.scale ?? 1) * f, 0.5, 1.8);
    ctx.touched.add("scale");
    ctx.did.push(dir > 0 ? "a bigger version" : "a smaller version");
    return true;
  }
  return false;
}

function recolorClause(t: string, ctx: Ctx, color: string): boolean {
  const di = findDecal(t, ctx.decals);
  if (di >= 0) {
    ctx.decals = ctx.decals.map((d, i) => (i === di ? { ...d, color } : d));
    ctx.touched.add("decals");
    ctx.did.push("a new color for the design");
    return true;
  }
  const ai = findAddon(t, ctx.addons);
  if (ai >= 0 && !findWord(t, ADDON_KEYS.filter((k) => ADDON_WORDS[k].name !== ctx.addons[ai].name))) {
    ctx.addons = ctx.addons.map((a, i) => (i === ai ? { ...a, color } : a));
    ctx.touched.add("addons");
    ctx.did.push(`a recolored ${ctx.addons[ai].name}`);
    return true;
  }
  const part = findPart(t, ctx.category);
  if (part) {
    const feat = PART_FEATURE[part];
    if (feat && !ctx.features.has(feat)) {
      ctx.features.add(feat);
      ctx.touched.add("features");
    }
    if (part === "sleeves" && /\blong sleeves?\b/.test(t)) ctx.patch.sleeves = "long";
    setPart(ctx, part, { color });
    ctx.did.push(`recolored ${pretty(part)}`);
    return true;
  }
  return false;
}

function decalClause(raw: string, t: string, ctx: Ctx, color: string | null): boolean {
  const content = decalContent(raw, t);
  const drawy = DRAW.test(t) || DECAL_NOUN.test(t);
  if (!content && !drawy) return false;
  // "add a bow" is an object, "draw a bow" is a picture.
  const addonHit = findWord(t, ADDON_KEYS);
  if (!DRAW.test(t) && addonHit && (!content || content.kind !== "text")) {
    const emojiHit = findWord(t, EMOJI_KEYS), shapeHit = findWord(t, SHAPE_KEYS);
    const contentLen = Math.max(emojiHit?.key.length ?? 0, shapeHit?.key.length ?? 0);
    if (addonHit.key.length >= contentLen) return false;
    // In a compound the last noun is the thing: a "unicorn horn" is a horn, a "coffee cup holder" a holder.
    const pic = [emojiHit, shapeHit].filter((h) => h && h.key.length === contentLen)[0];
    if (pic && addonHit.at > pic.at && addonHit.at - (pic.at + pic.key.length) <= 12) return false;
  }
  if (!content && !DRAW.test(t)) return false;
  const placed = !!findPlacement(t) || ALL_OVER.test(t) || /\bon (it|them)\b/.test(t);
  if (content && !drawy && !ADD.test(t) && !placed) return false;
  // A picture noun alone is usually describing the product ("a bike helmet"), not drawing on it.
  if (content?.kind === "emoji" && !drawy && !placed) return false;
  let c = content;
  if (!c) {
    // Drawing something we have no picture for: write its name.
    const m = raw.match(/\b(?:draw|paint|print|sketch|doodle|airbrush|stamp|embroider|engrave)\s+(?:on\s+)?(?:a|an|the|some)?\s*(.+?)(?=\s+(?:on|across|along|onto|in|at|over)\b|$)/i);
    // "Paint it red" / "paint the whole thing gold" recolor the product; there's nothing to draw.
    const words = m?.[1].split(/\s+/).filter((w) => !COLOR_NAMES[w.toLowerCase()] && !/^(big|small|little|tiny|huge|cool|nice|cute|it|them|this|that|the|whole|entire|thing|everything|all|over|product)$/i.test(w));
    if (!words?.length) return false;
    c = { kind: "text", content: words.join(" ").slice(0, 24) };
  }
  const placements: Placement[] = ALL_OVER.test(t) ? ["front", "back", "left", "right"] : [findPlacement(t) ?? "front"];
  const size = decalSize(t);
  for (const placement of placements) {
    const d: Decal = { kind: c.kind, content: c.content, placement };
    if (color && !(c.kind === "text" && c.content.toLowerCase().includes(Object.keys(COLOR_NAMES).find((k) => COLOR_NAMES[k] === color) ?? "\u0000"))) d.color = color;
    if (size) d.size = size;
    ctx.decals = [...ctx.decals.filter((x) => !(x.placement === placement && x.content === d.content)), d];
  }
  ctx.touched.add("decals");
  ctx.did.push(`${c.kind === "text" ? `"${c.content}"` : c.kind === "shape" ? `a ${pretty(c.content)}` : c.content} on the ${placements.length > 1 ? "whole thing" : placements[0]}`);
  return true;
}

function addonClause(t: string, ctx: Ctx, color: string | null): boolean {
  const hit = findWord(t, ADDON_KEYS);
  // A part that was hidden comes back ("bring back the visor", "add the visor back").
  const part = findPart(t, ctx.category);
  const feat0 = part ? PART_FEATURE[part] : undefined;
  const gone = !!part && part !== "sleeves" && (feat0 ? !ctx.features.has(feat0) : !!(ctx.parts[part] ?? ctx.spec.parts?.[part])?.hidden);
  if (part && gone && (!hit || PART_WORDS[ctx.category][hit.key]) && /\b(add|bring (?:it )?back|put (?:it )?back|restore|give it|want|need|re ?add|with)\b/.test(t)) {
    const feat = PART_FEATURE[part];
    if (feat) {
      ctx.features.add(feat);
      ctx.touched.add("features");
    }
    const style: PartStyle = { hidden: false };
    if (color) style.color = color;
    setPart(ctx, part, style);
    ctx.did.push(pretty(part));
    return true;
  }
  // The model already has this part (a helmet's visor): nothing to add.
  if (hit && PART_WORDS[ctx.category][hit.key] && !gone) return false;
  let entry: AddonWord | null = hit ? ADDON_WORDS[hit.key] : null;
  // "a holder for my coffee cup" -> "cup holder".
  if (entry && hit!.key === "holder") {
    const what = t.match(/\b(cup|coffee|drink|bottle|water|phone|pen|pencil|umbrella|key|keys|card|cards|snack|can)\b/)?.[1];
    if (what) entry = { ...entry, name: `${what === "coffee" || what === "drink" ? "cup" : what} holder`, shape: /phone|card/.test(what) ? "box" : "cylinder" };
  }
  if (!entry) {
    if (!/\b(add|attach|put|stick|give it|install|mount|needs?|include|can (?:it|you) (?:have|get)|should have)\b/.test(t)) return false;
    const noun = nounAfterAdd(t);
    if (!noun || NOT_ADDONS.test(noun) || findColor(noun) || /\b(dress|top|skirt|backpack|helmet|shirt|bag)\b/.test(noun)) return false;
    entry = { name: noun, shape: "box", at: "front" };
  } else if (!ADD.test(t) && !/^\s*(?:a|an|some)?\s*\w+/.test(t)) return false;
  const placement = findPlacement(t) ?? (typeof entry.at === "function" ? entry.at(ctx.category) : entry.at);
  const a: Addon = { name: entry.name, shape: entry.shape, placement };
  if (color) a.color = color;
  if (entry.glow || /\b(glow|glowing|light ?up|lit|neon|led)\b/.test(t)) a.glow = true;
  const count = t.match(/\b(two|three|four|five|six|2|3|4|5|6)\b/);
  const n = count ? ({ two: 2, three: 3, four: 4, five: 5, six: 6 } as Record<string, number>)[count[1]] ?? Number(count[1]) : entry.count;
  if (n && n > 1) a.count = n;
  const size = decalSize(t) ?? entry.size;
  if (size) a.size = size;
  ctx.addons = [...ctx.addons.filter((x) => !(x.name === a.name && x.placement === a.placement)), a].slice(-10);
  ctx.touched.add("addons");
  ctx.did.push(`${a.count ? "" : /^[aeiou]/.test(a.name) ? "an " : "a "}${a.name}${a.placement === "waist" ? "" : ` on the ${a.placement}`}`);
  return true;
}

function featureClause(t: string, ctx: Ctx, color: string | null): boolean {
  if (!ADD.test(t) && !/^\s*(?:and\s+)?(?:with|plus)\b/.test(t)) return false;
  const want: [RegExp, string, string | null][] = [
    [/\bpockets?\b/, "phone_pockets", ctx.category === "backpack" ? "side_pocket" : "pockets"],
    [/\blaptop stand\b/, "laptop_stand", "stand"],
    [/\b(headphones?|speakers?|earbuds|audio)\b/, "headphones", "headphones"],
  ];
  for (const [re, feat, part] of want) {
    if (!re.test(t)) continue;
    if (feat === "laptop_stand" && ctx.category !== "backpack") continue;
    if (feat === "headphones" && ctx.category !== "helmet") continue;
    ctx.features.add(feat);
    ctx.touched.add("features");
    if (part && color && ctx.category !== "generic") setPart(ctx, part, { color });
    const size = decalSize(t);
    if (part && size && ctx.category !== "generic") setPart(ctx, part, { scale: size });
    ctx.did.push(pretty(feat));
    return true;
  }
  return false;
}

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;

// ---------- Entry point ----------

const FILLERS = /\b(um+|uh+|uhm+|erm+|hmm+|you know|i mean|kinda|sort of|maybe|just|actually|basically|please|pls|okay|ok|alright|so|oh|wait|hey genie|genie|hey)\b/gi;
const OP_START = "(?:then\\s+)?(?:make|add|put|draw|paint|write|remove|take|get rid|give|change|turn|move|lose|ditch|drop|stick|print|attach|keep|leave|swap|replace|shrink|i want|i'd like|can you|could you|also|and)\\b";

export function splitClauses(text: string): string[] {
  let s = text.replace(/\s+/g, " ").replace(FILLERS, " ").replace(/,\s*like\s*,/gi, " ").replace(/\blike,\s*/gi, " ");
  s = s.replace(/[;!?]+|\.(?=\s|$)/g, " | ");
  s = s.replace(new RegExp(`,\\s*(?:and\\s+)?(?=${OP_START})`, "gi"), " | ");
  s = s.replace(new RegExp(`\\s+(?:and|but)\\s+(?=${OP_START})`, "gi"), " | ");
  s = s.replace(/\s+(?:and then|then|plus also)\s+/gi, " | ");
  s = s.replace(/,\s*(?=with\b)/gi, " | ");
  return s.split("|").map((c) => c.replace(/,/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

const lower = (raw: string) => " " + raw.toLowerCase().replace(/[^a-z0-9#'\s-]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ") + " ";

/** Interpret edit clauses against the current spec. Category is the one the patch will leave. */
export function interpretEdits(text: string, spec: ProductSpec, category: Category = spec.category): EditResult {
  const ctx: Ctx = {
    spec, category,
    features: new Set(spec.features ?? []), parts: {}, decals: [...(spec.decals ?? [])], addons: [...(spec.addons ?? [])],
    touched: new Set(), patch: {}, did: [],
  };
  const rest: string[] = [];
  const clauses = splitClauses(text);
  // "The pockets are tiny, make them twice as big": the complaint only names the target.
  const explicitSize = clauses.some((c) => !isComplaint(lower(c)) && (UP.test(lower(c)) || DOWN.test(lower(c))));
  let lastRef: string | null = null;
  for (const raw of clauses) {
    let t = lower(raw);
    // "it" / "them" after naming something earlier in the sentence means that thing.
    if (lastRef && !targetWord(t, ctx) && /\b(it|them|they|those)\b/.test(t)) t = t.replace(/\b(it|them|they|those)\b/, `the ${lastRef}`);
    const mention = targetWord(t, ctx);
    const color = findColor(t, mention ?? undefined);
    const draws = DRAW.test(t);
    let done = false;
    // Words inside quotes are text to print, not commands: write "kill bill" on it.
    const unquoted = lower(raw.replace(/["“”][^"“”]*["“”]/g, " "));
    if (REMOVE.test(unquoted) || /\bno (?:more )?\w+|\w+less\b/.test(unquoted)) {
      done = removeClause(t, ctx);
      // "No pull chain" with nothing to remove must not fall through to adding a chain.
      // Only when the remove word leads: "add a hook so I don't lose my keys" still adds the hook.
      const rm = REMOVE.exec(t) ?? /\bno (?:more )?/.exec(t);
      const leads = !!rm && !ADD.test(t.slice(0, rm.index)) && !DRAW.test(t.slice(0, rm.index)) && !/["“”]|(?<![a-z])['‘’]|['‘’](?![a-z])/i.test(raw);
      if (!done && leads && (findWord(t, ADDON_KEYS) || decalContent(raw, t))) done = true;
    }
    if (!done && (MOVE.test(t) || /\b(it|them)\b.*\bto the (front|back|left|right|top|bottom|side|other side)\b/.test(t)) && !draws) done = moveClause(t, ctx);
    if (!done) done = retextClause(raw, t, ctx);
    const sizeAsk = sizeDir(t) !== 0 && !(isComplaint(t) && explicitSize);
    // "Add a big star" is an add with a size; "I want a huge front pocket" resizes a part the model has.
    const newThing = decalContent(raw, t) || findWord(t, ADDON_KEYS.filter((k) => !PART_WORDS[ctx.category][k]));
    if (!done && sizeAsk && !(ADD.test(t) && newThing && !findPart(t, ctx.category) && findDecal(t, ctx.decals) < 0 && findAddon(t, ctx.addons) < 0)) {
      done = resizeClause(t, ctx);
      // "Make the pockets bigger and red", "make it red and taller": the color applies to the same target.
      if (done && color) {
        const tidy = (s: string) => s.trim().replace(/(?:\s+(?:too|as well|now|color|colour|please|instead|then))+$/, "");
        const colorAtEnd = new RegExp(`\\b(${COLOR_KEYS.map(esc).join("|")})$`);
        const seg = t.split(/\band\b/).map(tidy).find((s) => findColor(s) && colorAtEnd.test(s));
        // No "and" part ends in the color: apply it as before, unless it describes something else ("white trim").
        const described = new RegExp(`\\b(${COLOR_KEYS.map(esc).join("|")})\\s+(?!(?:too|as|now|color|colour|please|instead|then)\\b)[a-z]+`).test(t);
        if (!seg && !described && !recolorClause(t, ctx, color)) ctx.patch.color = color;
        // "...and the bag red" names its own target; a bare "...and red" means the one being resized.
        const own = seg ? targetWord(` ${seg} `, ctx) : null;
        // "...and the bag red" / "make it red and..." mean the whole product.
        if (seg && !own && WHOLE.test(` ${seg} `)) ctx.patch.color = color;
        else if (seg && !recolorClause(own ? ` ${seg} ` : t, ctx, color)) ctx.patch.color = color;
      }
    }
    // "Never mind the pockets, make it red": a dismissed thing isn't what "it" means next.
    if (mention) lastRef = /\bnever ?mind\b|(?<!don'?t |do not |never )\bforget(?: about)?\b|\bwhatever\b|\bdon'?t care about\b/.test(t) ? null : mention;
    if (!done && isComplaint(t) && explicitSize) done = !!mention;
    // "paint the visor gold" recolors; "paint a star on the visor" draws.
    const paintsPart = /\b(paint|color|colour|dye|spray|coat)\b/.test(t) && !decalContent(raw, t);
    if (!done && color && (!draws || paintsPart) && !/\b(add|attach|put|stick|draw)\b/.test(t)) done = recolorClause(t, ctx, color);
    if (!done && /\b(make|change|turn|paint|color|colour)\b/.test(t) && color && (findDecal(t, ctx.decals) >= 0 || findAddon(t, ctx.addons) >= 0)) done = recolorClause(t, ctx, color);
    if (!done) done = decalClause(raw, t, ctx, color);
    if (!done && color && findPart(t, ctx.category) && !findWord(t, ADDON_KEYS)) done = recolorClause(t, ctx, color);
    if (!done) done = featureClause(t, ctx, color);
    if (!done) done = addonClause(t, ctx, color);
    if (!done) rest.push(raw);
  }
  const patch = ctx.patch;
  if (ctx.touched.has("features")) patch.features = [...ctx.features];
  if (ctx.touched.has("decals")) patch.decals = ctx.decals;
  if (ctx.touched.has("addons")) patch.addons = ctx.addons;
  if (ctx.touched.has("parts")) patch.parts = ctx.parts as Record<string, PartStyle>;
  return { patch, did: ctx.did, rest: rest.join(", ") };
}

/** A generic product noun ("a coffee mug", "water bottle") -> body + starter add-ons. */
export function genericBody(t: string): (typeof GENERIC_BODIES)[string] | null {
  const hit = findWord(t, GENERIC_KEYS);
  if (hit) return GENERIC_BODIES[hit.key];
  return null;
}

export function shapeHint(t: string): Body["shape"] | null {
  for (const [re, s] of SHAPE_HINT) if (re.test(t)) return s;
  return null;
}

/**
 * A request to undo the last change. Explicit commands count anywhere; "never mind" / "scratch that"
 * only when that is the whole request ("never mind, it's perfect, lock it" is not an undo).
 */
export function isUndo(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(undo|revert|take that back|previous version|cancel that|go back to (?:the )?(?:last|previous|old) (?:one|version|design))\b/.test(t)) return true;
  // "Change it back" is an undo, "change it back to black" is an edit.
  if (/\bchange it back\b(?! to (?!how|what|the way))/.test(t)) return true;
  if (/\b(scrap|scratch|undo|cancel|forget|drop) (that|the) last (thing|change|edit|one)\b/.test(t)) return true;
  // "Can you go back", "never mind, put it back the way it was", "I liked the old shape better, go back":
  // only when the phrase ends the request. "The hem should go back further" and "put it back up top" are edits.
  if (/(?:^|\b(?:you|we|let'?s|just|mind|that|so|ok|okay|no|nope|actually|wait|better|it|back|please)\s+)(?:go back|put it back|change it back|set it back)(?: (?:please|then|now|again|one|a step|one step|actually|the way it was(?: before)?|how it was(?: before)?|like it was(?: before)?|to before|to (?:how|what|the way) it was(?: before)?))*$/.test(t)) return true;
  if (/(?:^|\b(?:back|make it|leave it|keep it|want it|have it|like)\s+)(?:to )?(?:the way|how) it was(?: before)?$/.test(t)) return true;
  // "Never mind" / "scratch that" only when that is the whole request.
  return /^(?:(?:oh|um|uh|wait|actually|no|nah|nope|hmm|ok|okay|ugh|oops|eh) )*(?:never ?mind|scratch that|undo that|i liked it better before)(?: (?:please|then|that|that one|that change|actually|go back|put it back|undo(?: that)?))*$/.test(t);
}

/** Generic product nouns as a regex alternation, longest first. */
export const GENERIC_WORDS = GENERIC_KEYS.map(esc).join("|");

export const PART_LIST = PARTS;
