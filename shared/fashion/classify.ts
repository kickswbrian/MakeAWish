import type { ModuleCategory } from "../kit.ts";
import { COLOR_NAMES, type MaterialPreset } from "../product.ts";
import { fashionTemplates } from "./compile.ts";
import { findStyles, type HardwareFinish, type SlotName } from "./styles.ts";

/**
 * The instant, local reading of a fashion wish: which template, which aesthetics, and the concrete
 * attributes the shopper said out loud (colors, fabrics, cut, details, hardware). Pure keyword
 * matching, no LLM, well under 2 ms, so the first 3D build can appear before Claude answers.
 */

/** Detail requests the style compiler knows how to place ("with pockets", "pearl buttons", "a bow"). */
export const REQUESTS = [
  "pockets", "patch_pocket", "flap_pocket", "welt_pocket", "slash_pocket", "cargo_pocket",
  "zip", "buttons", "pearl_buttons", "horn_buttons", "metal_buttons", "wood_buttons", "covered_buttons", "toggles", "snaps",
  "bow", "ruffle", "lace_trim", "drawstring", "fringe", "tassel", "chain", "embroidery", "logo", "print", "piping", "ruching",
  "puff_band", "pompom", "scallop_edge", "rib_band", "sherpa_band", "lacing", "belt", "d_ring", "hook_eye", "pleats", "topstitch",
  "rivets", "dart", "turn_lock", "charm", "hang_tag", "label", "patch", "pearl", "gem",
  "motif:heart", "motif:star", "motif:flower", "motif:cherry", "motif:bow", "motif:smiley", "motif:sparkle", "motif:butterfly",
] as const;
export type Request = (typeof REQUESTS)[number];

export interface WishAttributes {
  /** Hex colors in the order said: the first is the main color, the second the trim/accent. */
  colors: string[];
  /** Fabric presets in the order said (the first is the shell). */
  materials: MaterialPreset[];
  /** Fabrics said for a specific slot: "sherpa lined" -> lining, "leather straps" -> strap. */
  slotMaterials: Partial<Record<SlotName, MaterialPreset>>;
  /** Fabrics the garment noun implies ("jeans" are denim, a "puffer" is quilted or nylon). */
  fabricHint?: MaterialPreset[];
  /** Control name -> options in preference order (the compiler keeps the first the template has). */
  controls: Record<string, string[]>;
  /** Details asked for, and details explicitly refused ("no logos", "without pockets"). */
  modules: Request[];
  without: Request[];
  hardware?: HardwareFinish;
}

export interface WishClassification {
  template?: string;
  /** Product noun ("cardigan", "jeans", "tote", "earrings"). */
  category?: string;
  kind?: ModuleCategory;
  /** Aesthetic ids in the order said (the first wins conflicts). */
  styles: string[];
  attributes: WishAttributes;
}

// ---------- Phrase table ----------

interface Effect {
  color?: string;
  material?: MaterialPreset | "wool";
  hardware?: HardwareFinish;
  controls?: Record<string, string[]>;
  request?: Request[];
  slot?: [SlotName, MaterialPreset];
}

const E: [string[], Effect][] = [];
const on = (phrases: string, effect: Effect) => E.push([phrases.split("|"), effect]);
const ctl = (controls: Record<string, string[]>): Effect => ({ controls });
const req = (...request: Request[]): Effect => ({ request });

// Metals and hardware finishes ("gold hoops", "silver hardware", "black zipper").
for (const [words, f] of [["gold|golden|gold tone|yellow gold", "gold"], ["silver|sterling|sterling silver|silver tone|chrome", "silver"], ["rose gold", "rose_gold"], ["gunmetal", "gunmetal"], ["brass|antique gold|bronze", "brass"], ["tortoise|tortoiseshell|tortoise shell", "tortoise"]] as const) {
  on(words, { hardware: f });
  for (const w of words.split("|")) {
    on(`${w} hardware|${w} zipper|${w} zip|${w} zips`, { hardware: f });
    on(`${w} button|${w} buttons`, { hardware: f, request: ["metal_buttons"] });
    on(`${w} chain|${w} chains`, { hardware: f, request: ["chain"] });
  }
}
on("black hardware|black zipper|matte black hardware", { hardware: "black" });

// Fabrics.
on("cable knit|chunky knit|fisherman knit|aran|cable", { material: "cable_knit" });
on("rib knit|ribbed knit|ribbed|rib", { material: "rib_knit" });
on("knit|knitted|crochet|crocheted|cashmere|merino|sweater knit", { material: "knit" });
on("wool|woolen|woollen|wool blend", { material: "wool" });
on("suiting|wool suiting|gabardine|crepe|tailored wool", { material: "wool_suiting" });
on("tweed|boucle", { material: "tweed" });
on("corduroy|cords|cord", { material: "corduroy" });
on("sherpa|teddy|shearling|faux fur|fur|fuzzy|fluffy|borg|faux shearling", { material: "sherpa" });
on("fleece|polar fleece|minky", { material: "fleece" });
on("jersey|cotton jersey", { material: "jersey" });
on("cotton|poplin|oxford|chambray", { material: "cotton" });
on("linen", { material: "linen" });
on("satin|silk|silky|charmeuse", { material: "satin" });
on("velvet|velour|velvety|crushed velvet", { material: "velvet" });
on("denim|jean", { material: "denim" });
on("light wash|acid wash|light denim|light wash denim|bleached denim|light blue denim", { material: "denim_light" });
on("dark wash|raw denim|dark denim|indigo", { material: "denim", color: "#243552" });
on("leather|vegan leather|faux leather|pleather|lambskin", { material: "leather" });
on("pebbled leather|grained leather|saffiano|pebbled", { material: "leather_pebbled" });
on("patent|patent leather|vinyl|pvc|glossy leather", { material: "patent_leather" });
on("suede|nubuck|microsuede|faux suede", { material: "suede" });
on("mesh|sheer|fishnet|tulle", { material: "mesh_fabric" });
on("lace|lacy", { material: "lace" });
on("gingham|checkered|check|picnic check", { material: "gingham" });
on("quilted|puffer|padded|quilt", { material: "quilted" });
on("nylon|ripstop|technical", { material: "nylon" });
on("canvas|duck canvas", { material: "canvas" });
// Fabrics for one slot.
on("sherpa lined|fleece lined|fur lined|shearling lined", { slot: ["lining", "sherpa"] });
on("satin lined|silk lined", { slot: ["lining", "satin"] });
on("sherpa collar|fur collar|fur trim|faux fur trim|shearling collar|fur cuffs|sherpa trim", { slot: ["trim", "sherpa"], request: ["sherpa_band"] });
on("leather strap|leather straps|leather handle|leather handles|leather trim", { slot: ["strap", "leather"] });

// Phrases that only look like cut words ("long sleeve" says nothing about length).
on("long sleeve|long sleeved|long sleeves|short sleeve|short sleeved|short sleeves|drop shoulder|sweetheart|top handle|wide brim|belt bag|belt loops|bag charm holder", {});
// Cut and size.
on("cropped|crop|short|shrunken", ctl({ length: ["cropped", "mini"] }));
on("long|longline|full length|floor length|ankle length", ctl({ length: ["long", "maxi"] }));
on("maxi", ctl({ length: ["maxi", "long"] }));
on("midi|knee length|tea length", ctl({ length: ["midi"] }));
on("mini", ctl({ length: ["mini", "cropped"], size: ["mini", "small"] }));
on("oversized|oversize|boyfriend|relaxed|loose|roomy|relaxed fit|loose fit", ctl({ fit: ["oversized"] }));
on("boxy", ctl({ fit: ["oversized"], shape: ["structured"] }));
on("slouchy|slouch", ctl({ fit: ["oversized"], shape: ["slouchy"] }));
on("baggy|super baggy|wide baggy", ctl({ leg: ["baggy", "wide"], fit: ["oversized"] }));
on("fitted|slim|slim fit|tight|bodycon|form fitting|body hugging|second skin", ctl({ fit: ["fitted"] }));
on("tailored|structured|sharp", ctl({ fit: ["fitted"], shape: ["structured"] }));
on("skinny|skinny leg", ctl({ leg: ["skinny"], fit: ["fitted"] }));
on("wide leg|wide|palazzo", ctl({ leg: ["wide"] }));
on("straight leg|straight", ctl({ leg: ["straight"], flare: ["straight"] }));
on("flare|flared|flares|bootcut|boot cut|bell bottom|bell bottoms", ctl({ leg: ["flare"], flare: ["full", "a_line"] }));
on("a line", ctl({ flare: ["a_line"] }));
on("circle|full skirt|skater|twirly", ctl({ flare: ["full"] }));
on("pencil", ctl({ flare: ["straight"], fit: ["fitted"] }));
on("high rise|high waisted|high waist|high rise", ctl({ rise: ["high"] }));
on("mid rise|mid waist", ctl({ rise: ["mid"] }));
on("low rise|low waisted|low waist|hip hugger", ctl({ rise: ["low"] }));
on("chunky|thick|bold|chunkier", ctl({ thickness: ["chunky"] }));
on("thin|dainty|delicate|fine|skinny hoops", ctl({ thickness: ["thin", "fine"] }));
on("huge|big|large|giant|oversized hoops|xl", ctl({ size: ["large"] }));
on("statement", ctl({ size: ["large"] }));
on("small|tiny|little|petite|mini hoops|teeny", ctl({ size: ["small", "mini"] }));
on("medium|mid size|midsize", ctl({ size: ["medium"] }));
on("hoop|hoops", ctl({ style: ["hoop"] }));
on("huggie|huggies", ctl({ style: ["huggie", "hoop"], size: ["small"] }));
on("stud|studs", ctl({ style: ["stud"] }));
on("drop|drops|dangle|dangly|dangling", ctl({ style: ["drop"] }));
on("hobo|bucket", ctl({ shape: ["slouchy"] }));

// Details.
on("pocket|with pockets|pockets", req("pockets"));
on("cargo|cargo pocket|utility pocket", req("cargo_pocket"));
on("patch pocket", req("patch_pocket"));
on("flap pocket", req("flap_pocket"));
on("welt pocket|jetted pocket", req("welt_pocket"));
on("slash pocket|side pocket|side pockets", req("slash_pocket"));
on("zip|zipper|zip up|zipped|full zip|half zip|quarter zip|zip front", req("zip"));
on("button|button up|button down|buttoned|button front|button through", req("buttons"));
on("pearl button|pearl buttons|pearl snaps", req("pearl_buttons"));
on("horn button|horn buttons", req("horn_buttons"));
on("wooden button|wooden buttons|wood button|wood buttons", req("wood_buttons"));
on("covered button|covered buttons|self covered buttons", req("covered_buttons"));
on("toggle|toggles|toggle buttons|duffle", req("toggles"));
on("snap|snaps|snap buttons|press studs|poppers", req("snaps"));
on("bow|bows|ribbon|ribbons", req("bow"));
on("ruffle|ruffled|frill|frills|frilly|tiered", req("ruffle"));
on("lace trim|lace trimmed|lace edge|lace edged", req("lace_trim"));
on("drawstring|drawcord|tie waist|drawstrings", req("drawstring"));
on("fringe|fringed", req("fringe"));
on("tassel|tassels", req("tassel"));
on("chain|chains|chain strap|chain handle|chain link", req("chain"));
on("embroidery|embroidered", req("embroidery"));
on("logo|logos|branding|monogram|monogrammed", req("logo"));
on("graphic|graphics|graphic print|print|printed|slogan", req("print"));
on("piping|piped|contrast piping", req("piping"));
on("ruching|ruched|scrunch|scrunched|smocked|smocking|gathered", req("ruching"));
on("puff sleeve|puff sleeves|puffy sleeves|puffed sleeves|balloon sleeves", req("puff_band"));
on("pom pom|pompom|pom poms|pompoms", req("pompom"));
on("scalloped|scallop|scallops", req("scallop_edge"));
on("rib cuffs|ribbed cuffs|rib trim|ribbed trim|ribbed hem|ribbed collar", req("rib_band"));
on("lace up|corset|laced|lacing|tie up|criss cross", req("lacing"));
on("belt|belted|buckle|belt buckle", req("belt"));
on("d ring|d rings", req("d_ring"));
on("hook and eye|hook and eyes", req("hook_eye"));
on("pleat|pleats|pleated", req("pleats"));
on("topstitching|topstitched|contrast stitching|contrast stitch|stitching|stitched", req("topstitch"));
on("rivet|rivets|riveted", req("rivets"));
on("dart|darts|darted", req("dart"));
on("turn lock|twist lock|turnlock", req("turn_lock"));
on("charm|charms|bag charm|keychain", req("charm"));
on("hang tag|price tag", req("hang_tag"));
on("label|labels", req("label"));
on("patch|patches|leather patch", req("patch"));
on("pearl|pearls|pearly", { request: ["pearl"], slot: ["stone", "pearl"] });
on("crystal|crystals|rhinestone|rhinestones|diamond|diamonds|gem|gems|gemstone|jeweled|bejeweled", { request: ["gem"], slot: ["stone", "gem"] });
on("heart|hearts|heart shaped", req("motif:heart"));
on("star|stars", req("motif:star"));
on("flower|flowers|floral|daisy|daisies", req("motif:flower"));
on("cherry|cherries", req("motif:cherry"));
on("smiley|smiley face|smileys", req("motif:smiley"));
on("sparkle|sparkles|sparkly", req("motif:sparkle"));
on("butterfly|butterflies", req("motif:butterfly"));

/** Fashion colors beyond the shared COLOR_NAMES. */
const EXTRA_COLORS: Record<string, string> = {
  oatmeal: "#D8CBB3", "ballet pink": "#F2D4D7", "butter yellow": "#F6E3A1", butter: "#F6E3A1", espresso: "#3B2418", mocha: "#7A5A45",
  khaki: "#B8A27A", ecru: "#EDE3CF", taupe: "#B9A89A", champagne: "#E9D8B4", nude: "#E3C4A8", bone: "#E8E1D3", "cherry red": "#B0102D",
  cherry: "#B0102D", wine: "#5E1A24", oxblood: "#4A1C22", "sage green": "#9CAF88", "powder blue": "#B6D0E2", "denim blue": "#3E5C82",
  "dusty rose": "#D8A7A7", mauve: "#C99AA4", "baby pink": "#F7C5D5", "heather grey": "#A7A39C", "heather gray": "#A7A39C",
  "kelly green": "#1F7A4A", "hunter green": "#2E4A34", "chocolate brown": "#4E2A1A", "light pink": "#F7C5D5", "dark brown": "#3E2A20",
  "pale pink": "#F7D3DC", "pale yellow": "#F6EBB0", "pale blue": "#C7DDF0", "off-white": "#F1EEE6", stone: "#CFC6BA", latte: "#C8A98B",
  "forest": "#1E5631", "leopard": "#B8874D", "cobalt blue": "#1D4FBF", "pastel blue": "#BFDDF2", "pastel yellow": "#F6E3A1",
  "pastel purple": "#D9C4EC", "pastel green": "#C6E5C9", "seafoam": "#A8D5C2", "pistachio": "#C5D9A4", "neon yellow": "#E8FF3A",
};

/**
 * Garment nouns: kind, plus the fabrics the noun itself implies (jeans are denim). The template
 * keywords take priority; this covers wishes for categories without a template yet.
 */
const NOUNS: Record<string, [ModuleCategory, MaterialPreset[]?]> = {
  jacket: ["outerwear"], coat: ["outerwear"], blazer: ["outerwear", ["wool_suiting", "tweed", "linen", "corduroy", "velvet", "leather", "suede", "denim", "cotton", "satin"]],
  cardigan: ["outerwear", ["knit", "cable_knit", "rib_knit", "fleece"]], vest: ["outerwear"], gilet: ["outerwear"], parka: ["outerwear", ["nylon", "quilted", "canvas"]],
  puffer: ["outerwear", ["quilted", "nylon"]], trench: ["outerwear", ["canvas", "cotton", "leather", "nylon"]], bomber: ["outerwear", ["nylon", "satin", "leather", "suede", "velvet"]],
  shacket: ["outerwear", ["cotton", "corduroy", "canvas", "wool_suiting", "fleece"]], windbreaker: ["outerwear", ["nylon"]], "jean jacket": ["outerwear", ["denim", "denim_light"]],
  hoodie: ["top", ["fleece", "jersey", "knit"]], sweatshirt: ["top", ["fleece", "jersey"]], sweater: ["top", ["knit", "cable_knit", "rib_knit"]], jumper: ["top", ["knit", "cable_knit", "rib_knit"]],
  shirt: ["top"], blouse: ["top"], tee: ["top", ["jersey", "rib_knit", "mesh_fabric", "cotton"]], "t shirt": ["top", ["jersey", "rib_knit", "mesh_fabric", "cotton"]],
  top: ["top"], tank: ["top"], "tank top": ["top"], cami: ["top"], camisole: ["top"], polo: ["top"], corset: ["top"], bodysuit: ["top", ["rib_knit", "jersey", "lace", "mesh_fabric"]],
  jeans: ["bottom", ["denim", "denim_light"]], pants: ["bottom"], trousers: ["bottom"], slacks: ["bottom"], shorts: ["bottom"], joggers: ["bottom", ["fleece", "jersey", "knit"]],
  sweatpants: ["bottom", ["fleece", "jersey", "knit"]], leggings: ["bottom", ["rib_knit", "jersey"]], cargos: ["bottom"], chinos: ["bottom", ["cotton", "canvas"]],
  skirt: ["skirt"], skort: ["skirt"], dress: ["dress"], gown: ["dress"], romper: ["dress"], jumpsuit: ["dress"],
  bag: ["bag"], "belt bag": ["bag"], tote: ["bag"], purse: ["bag"], handbag: ["bag"], clutch: ["bag"], crossbody: ["bag"], satchel: ["bag"], baguette: ["bag"], "shoulder bag": ["bag"],
  earrings: ["jewelry"], earring: ["jewelry"], hoops: ["jewelry"], huggies: ["jewelry"], studs: ["jewelry"], necklace: ["jewelry"], bracelet: ["jewelry"], ring: ["jewelry"], jewelry: ["jewelry"], jewellery: ["jewelry"],
  hat: ["accessory"], beanie: ["accessory"], scarf: ["accessory"], belt: ["accessory"],
};

// ---------- Matching ----------

interface Compiled {
  re: RegExp;
  effects: Map<string, Effect[]>;
}
let compiled: Compiled | null = null;

const plural = (p: string) => (/(s|x|sh|ch)$/.test(p) ? [p] : [p, p + "s"]);

function compile(): Compiled {
  if (compiled) return compiled;
  const effects = new Map<string, Effect[]>();
  const add = (phrase: string, e: Effect) => {
    const list = effects.get(phrase) ?? [];
    list.push(e);
    effects.set(phrase, list);
  };
  for (const [phrases, e] of E) for (const p of phrases) for (const f of e.request ? plural(p) : [p]) add(f, e);
  // Plain color words, unless a richer entry owns the phrase ("gold" is a hardware finish).
  for (const [name, hex] of [...Object.entries(COLOR_NAMES), ...Object.entries(EXTRA_COLORS)]) {
    const p = name.replace(/-/g, " ");
    if (!effects.has(p)) add(p, { color: hex });
  }
  // Longest phrase first: a regex alternation takes the first alternative that matches.
  const phrases = [...effects.keys()].sort((a, b) => b.length - a.length);
  compiled = { re: new RegExp(`(?<![a-z0-9])(?:${phrases.join("|")})(?![a-z0-9])`, "g"), effects };
  return compiled;
}

/** Lowercase words; punctuation becomes "," so a negation never reaches past a clause. */
const normalize = (s: string) =>
  " " + s.toLowerCase().replace(/[’']/g, "").replace(/&/g, " and ").replace(/[-_/]+/g, " ").replace(/[,.;:!?()]+/g, " , ").replace(/[^a-z0-9#, ]+/g, " ").replace(/\s+/g, " ").trim() + " ";

const NEGATION = /\b(?:no|without|not|never|minus|zero|skip|ditch|lose|avoid)\b(?:\s+(?:any|the|a|an|visible|big|more|extra|too|much|many))*\s*$/;
const SLOT_AFTER: Record<string, SlotName> = { lining: "lining", lined: "lining", trim: "trim", trimmed: "trim", collar: "trim", cuffs: "trim", cuff: "trim", straps: "strap", strap: "strap", handles: "handle", handle: "handle" };
/** Words after a product noun that make it a different product ("bag charm", "earring holder"). */
const NOT_PRODUCT = new Set(["charm", "charms", "holder", "rack", "hanger", "stand", "organizer", "box", "pattern", "print", "keychain", "strap", "case", "display", "tree", "storage", "pocket", "pockets", "chain", "handle", "handles", "stitching", "coat"]);
/** Words before a noun that make it a part, not the product ("a d ring", "key ring"). */
const NOT_PRODUCT_BEFORE = new Set(["d", "o", "key", "nose", "belly", "split", "jump"]);

function nounAt(t: string, words: string[]): { word: string; at: number } | null {
  let best: { word: string; at: number } | null = null;
  for (const w of words) {
    for (const f of plural(w)) {
      let at = t.indexOf(` ${f} `);
      while (at >= 0) {
        const next = t.slice(at + f.length + 2).split(" ")[0] ?? "";
        const prev = t.slice(0, at).split(" ").pop() ?? "";
        if (!NOT_PRODUCT.has(next) && !NOT_PRODUCT_BEFORE.has(prev)) break;
        at = t.indexOf(` ${f} `, at + 1);
      }
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && f.length > best.word.length)) best = { word: w, at };
    }
  }
  return best;
}

/** Reads a fashion wish. Pure and synchronous; call it on every keystroke if you like. */
export function classifyWish(text: string): WishClassification {
  const t = normalize(text);
  // The product noun lives before the first "with/for/that..." clause ("a tote with a chain strap").
  const head = t.split(/ (?:with|that|which|for|to|but|plus|having|including|and also) /)[0] + " ";

  // Template: fashion templates register at load, so read them now.
  let template: string | undefined, category: string | undefined, kind: ModuleCategory | undefined;
  let best: { id: string; at: number; len: number; category: string; kind: ModuleCategory } | null = null;
  for (const tpl of fashionTemplates()) {
    for (const scope of [head, t]) {
      const hit = nounAt(scope, tpl.keywords.map((k) => k.toLowerCase().replace(/[-_]+/g, " ")));
      if (!hit) continue;
      const at = scope === head ? hit.at : 10_000 + hit.at;
      if (!best || at < best.at || (at === best.at && hit.word.length > best.len)) best = { id: tpl.id, at, len: hit.word.length, category: tpl.category, kind: tpl.kind };
      break;
    }
  }
  if (best) ({ id: template, category, kind } = best);
  const noun = nounAt(head, Object.keys(NOUNS)) ?? nounAt(t, Object.keys(NOUNS));
  if (!kind && noun) [kind] = NOUNS[noun.word];
  category ??= noun?.word;

  const attributes: WishAttributes = { colors: [], materials: [], slotMaterials: {}, controls: {}, modules: [], without: [] };
  const hexes = t.matchAll(/(?<![a-z0-9])#?([0-9a-f]{6})(?![a-z0-9])/g);
  for (const m of hexes) if (/[0-9]/.test(m[1]) || m[0].startsWith("#")) attributes.colors.push("#" + m[1].toUpperCase());

  const { re, effects } = compile();
  re.lastIndex = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const negated = NEGATION.test(t.slice(Math.max(0, m.index - 40), m.index));
    const next = t.slice(m.index + m[0].length).trim().split(" ")[0] ?? "";
    for (const e of effects.get(m[0]) ?? []) {
      if (negated) {
        for (const r of e.request ?? []) if (!attributes.without.includes(r)) attributes.without.push(r);
        continue;
      }
      if (e.color && !attributes.colors.includes(e.color)) attributes.colors.push(e.color);
      if (e.hardware) attributes.hardware ??= e.hardware;
      for (const r of e.request ?? []) if (!attributes.modules.includes(r)) attributes.modules.push(r);
      for (const [k, opts] of Object.entries(e.controls ?? {})) attributes.controls[k] ??= opts;
      if (e.slot) attributes.slotMaterials[e.slot[0]] ??= e.slot[1];
      if (e.material) {
        const slot = SLOT_AFTER[next];
        const mat: MaterialPreset = e.material === "wool" ? woolFor(kind) : e.material;
        if (slot) attributes.slotMaterials[slot] ??= mat;
        else if (!attributes.materials.includes(mat)) attributes.materials.push(mat);
      }
    }
  }
  // "Lace" said as a detail of a non-lace garment is a trim: "jeans with lace" -> lace trim.
  if (attributes.materials.includes("lace") && / (?:with|and|plus) (?:a |some |\w+ )?lace /.test(t)) {
    attributes.materials = attributes.materials.filter((m) => m !== "lace");
    if (!attributes.modules.includes("lace_trim")) attributes.modules.push("lace_trim");
  }
  // A pearl or gem on a garment means pearl buttons or a sparkle detail, not the shell fabric.
  if (kind && kind !== "jewelry" && attributes.modules.includes("pearl") && !attributes.modules.includes("pearl_buttons")) {
    attributes.modules = attributes.modules.map((r) => (r === "pearl" ? "pearl_buttons" : r));
  }
  if (noun && NOUNS[noun.word][1]) attributes.fabricHint = NOUNS[noun.word][1];
  if (best) templateControls(t, best.id, attributes);

  return { ...(template ? { template } : {}), ...(category ? { category } : {}), ...(kind ? { kind } : {}), styles: findStyles(text.replace(/\btennis (bracelet|necklace|chain)/gi, "$1")), attributes };
}

/** Option words too generic to read as a choice when said ("a regular fit" is the phrase table's job). */
const VAGUE_OPTIONS = new Set(["none", "regular", "standard", "default", "classic", "flap", "form", "round"]);

/**
 * The template's own option words said in the wish ("tennis bracelet", "pearl choker", "paperclip
 * chain") pick that option first. The earliest mention wins within a control; negated words don't count.
 */
function templateControls(t: string, id: string, attributes: WishAttributes): void {
  const tpl = fashionTemplates().find((x) => x.id === id);
  if (!tpl) return;
  for (const [k, spec] of Object.entries(tpl.controls)) {
    let hit: { o: string; at: number } | null = null;
    for (const o of spec.options) {
      if (VAGUE_OPTIONS.has(o)) continue;
      const word = o.replace(/_/g, " ");
      const m = new RegExp(`(?<![a-z0-9])${word}s?(?![a-z0-9])`).exec(t);
      if (!m || NEGATION.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (!hit || m.index < hit.at) hit = { o, at: m.index };
    }
    if (hit) attributes.controls[k] = [hit.o, ...(attributes.controls[k] ?? []).filter((x) => x !== hit!.o)];
  }
}

/** "Wool" means suiting for tailoring and knit for sweaters. */
const woolFor = (kind: ModuleCategory | undefined): MaterialPreset => (kind === "outerwear" || kind === "bottom" || kind === "skirt" || kind === "dress" ? "wool_suiting" : "knit");
