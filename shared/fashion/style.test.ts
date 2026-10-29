import { test } from "node:test";
import assert from "node:assert/strict";
import { KIT, kitById, type KitEntry } from "../kit.ts";
import type { Part } from "../product.ts";
import { classifyWish } from "./classify.ts";
import { compileOutfit, fashionById, registerFashion } from "./compile.ts";
import { detailCount, DETAIL_RANGE, styleOutfit } from "./style-compiler.ts";
import { findStyles, mergeStyles, STYLE_ERRORS, STYLE_MODULE_IDS, STYLES, stylePromptBlock, validateStyles } from "./styles.ts";
import raw from "./styles.json";
import type { FashionTemplate, OutfitSpec, V3, Zone } from "./types.ts";

// ---------- Fixtures ----------

/** Kit entries the real family files may not have landed yet: minimal stand-ins with the right shape. */
const PATH_MODULES = new Set([
  "zipper_path", "drawstring", "lacing", "topstitch", "pleats", "seam_welt", "rib_band", "ruffle", "lace_trim", "piping", "ruching", "fringe",
  "scallop_edge", "sherpa_band", "puff_band", "chain_strap", "handle_wrap", "edge_paint",
]);
const FAMILY: [string, string[]][] = [
  ["closure", ["zipper_path", "button", "drawstring", "hook_eye", "lacing", "snap_button", "buckle_belt", "d_ring"]],
  ["construction", ["topstitch", "bar_tack", "jeans_rivet", "dart", "pleats", "seam_welt"]],
  ["trim", ["rib_band", "ruffle", "lace_trim", "bow", "piping", "ruching", "fringe", "scallop_edge", "pompom", "sherpa_band", "puff_band"]],
  ["pocket", ["patch_pocket", "welt_pocket", "cargo_pocket", "coin_pocket", "slash_pocket", "jeans_back_pocket", "flap"]],
  ["label", ["woven_label", "leather_patch", "embroidery", "print_graphic", "hang_tag", "brand_patch"]],
  ["jewelry", ["hoop", "huggie", "stud", "gem", "pearl", "chain", "ear_wire", "drop", "charm", "clasp", "ear_back"]],
  ["bag_hardware", ["turn_lock", "foot_stud", "chain_strap", "handle_wrap", "edge_paint", "swivel_hook", "o_ring", "magnetic_snap", "logo_plate", "tassel", "bag_charm", "strap_keeper", "zip_puller"]],
];
const STUB_PARAMS: Record<string, KitEntry["params"]> = {
  button: { style: { options: ["flat4", "flat2", "shank_dome", "jeans_tack", "toggle", "covered", "pearl_dome", "horn_rim"], default: "flat4", description: "" } },
  topstitch: { rows: { default: 1, min: 1, max: 3, description: "" }, weight: { options: ["fine", "regular", "heavy"], default: "regular", description: "" } },
  patch_pocket: { flap: { options: ["none", "flap", "flap_button"], default: "none", description: "" }, corner: { options: ["square", "rounded", "pointed"], default: "square", description: "" } },
  embroidery: { motif: { options: ["heart", "star", "flower", "cherry", "bow", "smiley", "sparkle", "butterfly"], default: "heart", description: "" } },
};
const stubbed: string[] = [];
for (const [family, ids] of FAMILY) {
  for (const id of ids) {
    if (kitById(id)) continue;
    stubbed.push(id);
    KIT.push({
      id, name: id.replace(/_/g, " "), description: "test stub", size: [0.02, 0.02, 0.004], attach: {}, material: "cotton", family,
      categories: family === "jewelry" ? ["jewelry"] : family === "bag_hardware" ? ["bag"] : ["top", "outerwear", "bottom", "skirt", "dress", "bag"],
      ...(PATH_MODULES.has(id) ? { path: true } : {}), ...(STUB_PARAMS[id] ? { params: STUB_PARAMS[id] } : {}),
    });
  }
}

const loop = (cx: number, cy: number, cz: number, rx: number, rz: number, n = 12): { path: V3[]; normals: V3[] } => {
  const path: V3[] = [], normals: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    path.push([cx + Math.sin(a) * rx, cy, cz + Math.cos(a) * rz]);
    normals.push([Math.sin(a), 0, Math.cos(a)]);
  }
  return { path, normals };
};

/** A jacket-like stand-in template: two chest points, a placket, closed hem and cuffs, a collar. */
const STUB: FashionTemplate = {
  id: "stub_jacket", name: "Test jacket", category: "jacket", kind: "outerwear", keywords: ["jacket", "blazer", "coat"],
  description: "test", targetPriceUsd: 120, display: "form",
  controls: {
    fit: { options: ["fitted", "regular", "oversized"], default: "regular", description: "" },
    length: { options: ["cropped", "regular", "long"], default: "regular", description: "" },
  },
  slots: {
    shell: { description: "body", parts: ["body"], default: { preset: "cotton", color: "#3A6FD8" } },
    trim: { description: "collar", parts: [], default: { preset: "rib_knit", color: "#1A1A1D" } },
    hardware: { description: "metal", parts: [], default: { preset: "metal_polished", color: "#C0C4CC" } },
    thread: { description: "stitching", parts: [], default: { preset: "cotton", color: "#F4F4F2" } },
  },
  build(c): Part[] {
    const h = c.length === "cropped" ? 0.45 : c.length === "long" ? 0.8 : 0.62;
    return [{
      id: "body", name: "Body", kind: "primitive", parent: null,
      geometry: { type: "roundedBox", params: { width: 0.46, height: h, depth: 0.24 } },
      transform: { position: [0, 1.2 - h / 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { preset: "cotton", color: "#3A6FD8" },
    }];
  },
  zones(c): Record<string, Zone> {
    const h = c.length === "cropped" ? 0.45 : c.length === "long" ? 0.8 : 0.62;
    const hem = loop(0, -h / 2, 0, 0.23, 0.12);
    const cuffL = loop(-0.36, -h / 2 + 0.05, 0, 0.05, 0.05), cuffR = loop(0.36, -h / 2 + 0.05, 0, 0.05, 0.05);
    return {
      chest_left: { part: "body", label: "left chest", at: [-0.1, h / 2 - 0.15, 0.121], normal: [0, 0, 1], up: [0, 1, 0], room: [0.12, 0.14] },
      chest_right: { part: "body", label: "right chest", at: [0.1, h / 2 - 0.15, 0.121], normal: [0, 0, 1], up: [0, 1, 0], room: [0.12, 0.14] },
      placket: { part: "body", label: "front placket", path: [[0, h / 2 - 0.05, 0.122], [0, -h / 2 + 0.02, 0.122]], normals: [[0, 0, 1], [0, 0, 1]] },
      hem: { part: "body", label: "hem", ...hem },
      cuff_left: { part: "body", label: "left cuff", ...cuffL },
      cuff_right: { part: "body", label: "right cuff", ...cuffR },
      collar: { part: "body", label: "collar", path: [[-0.09, h / 2, 0.06], [0, h / 2 - 0.02, 0.12], [0.09, h / 2, 0.06]], normals: [[-0.5, 0.3, 0.8], [0, 0.3, 1], [0.5, 0.3, 0.8]] },
    };
  },
  modules: [
    { module: "zipper_path", zone: "placket", material: "hardware" },
    { module: "topstitch", zone: "hem", params: { rows: 1 } },
  ],
};
registerFashion([STUB]);

const design = (wish: string): OutfitSpec => {
  const c = classifyWish(wish);
  return styleOutfit(c.template ?? STUB.id, c);
};
const mods = (s: OutfitSpec) => (s.modules ?? []).map((m) => m.module);

// ---------- Dictionary ----------

test("styles.json validates with no errors and covers the core aesthetics", () => {
  assert.deepEqual(validateStyles(raw).errors, []);
  assert.deepEqual(STYLE_ERRORS, []);
  for (const id of ["cute", "cozy", "clean_girl", "downtown_girl", "pilates_princess", "trendy", "officewear", "coquette", "y2k", "old_money", "streetwear", "boho", "sporty", "minimalist", "grunge", "preppy", "coastal"]) {
    assert.ok(STYLES.some((s) => s.id === id), id);
  }
  const ids = new Set<string>(STYLE_MODULE_IDS);
  for (const s of STYLES) for (const m of s.modules) assert.ok(ids.has(m.module), `${s.id}: ${m.module}`);
});

test("validation rejects bad entries", () => {
  const bad = { styles: [{ ...(raw as { styles: object[] }).styles[0], id: "x", modules: [{ module: "laser", zone: "moon" }] }] };
  const r = validateStyles(bad);
  assert.equal(r.styles.length, 0);
  assert.ok(r.errors.some((e) => e.includes("laser")) && r.errors.some((e) => e.includes("moon")));
});

test("style detection on the acceptance phrases", () => {
  assert.deepEqual(findStyles("cozy oversized cable knit cardigan"), ["cozy"]);
  assert.deepEqual(findStyles("clean girl gold hoop earrings"), ["clean_girl"]);
  assert.deepEqual(findStyles("Downtown-girl baggy jeans"), ["downtown_girl"]);
  assert.deepEqual(findStyles("officewear structured leather tote"), ["officewear"]);
  assert.deepEqual(findStyles("that girl pilates set"), ["clean_girl", "pilates_princess"]);
  assert.deepEqual(findStyles("a business casual blazer for work"), ["officewear"]);
  assert.deepEqual(findStyles("coastal cowgirl jacket"), ["western"]);
  assert.deepEqual(findStyles("cozy officewear blazer"), ["cozy", "officewear"]);
  assert.deepEqual(findStyles("a jacket"), []);
  assert.deepEqual(findStyles("cuteness overload"), []); // whole words only
});

test("merge: the first style wins, later ones add what doesn't clash", () => {
  const a = mergeStyles(["cozy", "officewear"]);
  const b = mergeStyles(["officewear", "cozy"]);
  assert.equal(a.fabrics.outerwear?.[0], "cable_knit");
  assert.equal(b.fabrics.outerwear?.[0], "wool_suiting");
  assert.equal(a.controls.fit[0], "oversized");
  assert.equal(b.controls.fit[0], "fitted");
  assert.equal(a.hardware, "brass");
  assert.equal(b.hardware, "gold");
  // cozy vetoes wool suiting, so it never enters a cozy-first merge; officewear vetoes fleece and sherpa.
  assert.ok(!a.fabrics.outerwear?.includes("wool_suiting"));
  assert.ok(!b.fabrics.outerwear?.includes("fleece") && !b.fabrics.outerwear?.includes("sherpa"));
  // A later style can't veto an earlier one's choices; officewear still adds its welt pocket to cozy.
  assert.ok(a.modules.some((m) => m.module === "welt_pocket" && m.style === "officewear"));
  assert.ok(a.modules.findIndex((m) => m.style === "officewear") > a.modules.findIndex((m) => m.style === "cozy"));
  assert.ok(!b.modules.some((m) => m.module === "pompom")); // officewear vetoes cozy's pompom
  assert.equal(a.palette.main[0].name, "oatmeal");
  assert.equal(b.palette.main[0].name, "navy");
});

test("prompt block is compact and names every style", () => {
  const block = stylePromptBlock();
  for (const s of STYLES) assert.ok(block.includes(`- ${s.id} (`), s.id);
  // ~3.5 chars per token for this text: well under 2500 tokens.
  assert.ok(block.length < 8500, `prompt block is ${block.length} chars`);
});

// ---------- Classification ----------

test("classifyWish reads fabrics, cut, colors, hardware and details", () => {
  const cardigan = classifyWish("cozy oversized cable knit cardigan");
  assert.deepEqual(cardigan.styles, ["cozy"]);
  assert.equal(cardigan.kind, "outerwear");
  assert.deepEqual(cardigan.attributes.materials, ["cable_knit"]);
  assert.deepEqual(cardigan.attributes.controls.fit, ["oversized"]);

  const hoops = classifyWish("clean girl gold hoop earrings");
  assert.equal(hoops.kind, "jewelry");
  assert.equal(hoops.attributes.hardware, "gold");
  assert.deepEqual(hoops.attributes.controls.style, ["hoop"]);
  assert.deepEqual(hoops.attributes.colors, []);

  const jeans = classifyWish("downtown girl baggy jeans");
  assert.equal(jeans.kind, "bottom");
  assert.equal(jeans.attributes.controls.leg[0], "baggy");
  assert.deepEqual(jeans.attributes.fabricHint, ["denim", "denim_light"]);

  const tote = classifyWish("officewear structured leather tote");
  assert.equal(tote.kind, "bag");
  assert.deepEqual(tote.attributes.materials, ["leather"]);
  assert.deepEqual(tote.attributes.controls.shape, ["structured"]);

  const jacket = classifyWish("a cute cropped pink jacket with pearl buttons and a bow, no pockets");
  assert.equal(jacket.template, "stub_jacket");
  assert.deepEqual(jacket.attributes.colors, ["#F28DB2"]);
  assert.deepEqual(jacket.attributes.controls.length, ["cropped", "mini"]);
  assert.ok(jacket.attributes.modules.includes("pearl_buttons") && jacket.attributes.modules.includes("bow"));
  assert.deepEqual(jacket.attributes.without, ["pockets"]);

  const bag = classifyWish("black tote with a gold chain strap and sherpa lining");
  assert.equal(bag.attributes.hardware, "gold");
  assert.ok(bag.attributes.modules.includes("chain"));
  assert.equal(bag.attributes.slotMaterials.lining, "sherpa");
  assert.deepEqual(bag.attributes.colors, ["#1A1A1D"]);
});

test("classifyWish is fast (< 2 ms)", () => {
  const wishes = [
    "cozy oversized cable knit cardigan", "clean girl gold hoop earrings", "downtown girl baggy jeans", "officewear structured leather tote",
    "a cute cropped pink gingham jacket with pearl buttons, puff sleeves and a bow but no pockets", "y2k low rise flare jeans with butterfly embroidery",
  ];
  for (const w of wishes) classifyWish(w); // warm the phrase index
  const n = 300;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) classifyWish(wishes[i % wishes.length]);
  const per = (performance.now() - t0) / n;
  assert.ok(per < 2, `classifyWish took ${per.toFixed(3)} ms`);
});

// ---------- Compilation ----------

test("cute vs downtown girl jacket: different fabric, colors and details", () => {
  const cute = design("cute jacket");
  const down = design("downtown girl jacket");
  assert.equal(cute.template, "stub_jacket");
  assert.notEqual(cute.materials?.shell.preset, down.materials?.shell.preset);
  assert.notEqual(cute.materials?.shell.color, down.materials?.shell.color);
  assert.equal(down.materials?.shell.preset, "leather");
  assert.equal(down.materials?.shell.color, "#1A1A1D");
  assert.equal(down.materials?.hardware.color, "#CDD1D6"); // silver
  assert.equal(cute.materials?.hardware.color, "#D4AF5A"); // gold
  assert.equal(down.controls?.fit, "oversized");
  assert.equal(cute.controls?.fit, "fitted");
  assert.equal(cute.controls?.length, "cropped");
  // Cute: pearl buttons replace the zipper, scalloped edges and a heart; downtown keeps the zip and none of that.
  assert.ok(mods(cute).includes("scallop_edge") && mods(cute).includes("embroidery"));
  const button = cute.modules?.find((m) => m.module === "button");
  assert.equal(button?.params?.style, "pearl_dome");
  assert.ok(cute.without?.includes("zipper_path_placket"));
  for (const m of ["bow", "ruffle", "lace_trim", "scallop_edge", "embroidery"]) assert.ok(!mods(down).includes(m), m);
  assert.ok(!down.without?.includes("zipper_path_placket"));
  assert.ok(mods(down).includes("welt_pocket"));
});

test("explicit attributes beat the style", () => {
  const s = design("cute red leather jacket");
  assert.equal(s.materials?.shell.preset, "leather");
  assert.equal(s.materials?.shell.color, "#D7263D");
  const crop = design("downtown girl cropped jacket");
  assert.equal(crop.controls?.length, "cropped");
  const fitted = design("cozy fitted jacket");
  assert.equal(fitted.controls?.fit, "fitted");
  const plain = design("minimalist jacket with fringe and silver hardware");
  assert.ok(mods(plain).includes("fringe"), "asked-for detail survives the style's avoid list");
  assert.equal(plain.materials?.hardware.color, "#CDD1D6");
  const noBow = design("cute jacket without bows");
  assert.ok(!mods(noBow).includes("bow"));
  const noPockets = design("officewear jacket, no pockets");
  assert.ok(!mods(noPockets).some((m) => m.includes("pocket")));
  const zipKept = design("cute jacket with a zipper");
  assert.ok(!mods(zipKept).includes("button"), "the asked-for zipper isn't replaced by the style's buttons");
  assert.ok(!zipKept.without?.includes("zipper_path_placket") || mods(zipKept).includes("zipper_path"));
});

test("placements land on existing zones, compile cleanly, and carry 8-15 details", () => {
  const [lo, hi] = DETAIL_RANGE.outerwear;
  const wishes = [...STYLES.map((s) => `${s.aliases[0]} jacket`), "jacket", "cozy officewear blazer", "cute pink jacket with pockets, ruffles and a bow"];
  for (const wish of wishes) {
    const spec = design(wish);
    const t = fashionById(spec.template)!;
    const zones = t.zones({ ...Object.fromEntries(Object.entries(t.controls).map(([k, v]) => [k, v.default])), ...spec.controls });
    const compiled = compileOutfit(spec)!;
    assert.deepEqual(compiled.skipped.map((x) => x.reason), [], wish);
    for (const p of compiled.parts.filter((x) => x.kind === "kit")) {
      assert.ok(p.zone && zones[p.zone.split(/[@~]/)[0]], `${wish}: ${p.id} on ${p.zone}`);
      assert.ok(kitById(p.kitAsset ?? ""), `unknown kit ${p.kitAsset}`);
    }
    const n = detailCount(spec);
    assert.ok(n >= lo && n <= hi, `${wish}: ${n} details`);
    // No module twice on one zone, and no bottoms-only hardware on a jacket.
    const seen = new Set<string>();
    for (const p of compiled.parts.filter((x) => x.kind === "kit" && x.kitAsset !== "button" && x.kitAsset !== "snap_button")) {
      const key = `${p.kitAsset}|${p.zone}`;
      assert.ok(!seen.has(key), `${wish}: ${key} twice`);
      seen.add(key);
    }
    assert.ok(!mods(spec).includes("jeans_rivet") && !mods(spec).includes("coin_pocket"), wish);
  }
});

test("a plain wish keeps the template look; a styled one restyles every slot", () => {
  const plain = design("jacket");
  assert.equal(plain.materials, undefined);
  const cozy = design("cozy jacket");
  assert.equal(cozy.materials?.shell.preset, "cable_knit");
  assert.equal(cozy.materials?.hardware.color, "#B08D57"); // brass
  assert.ok(cozy.materials?.thread.color !== STUB.slots.thread.default.color, "tonal thread");
  const work = design("workwear jacket");
  assert.equal(work.materials?.thread.color, "#C8892E"); // contrast topstitching
});

test("deterministic", () => {
  assert.deepEqual(design("cozy officewear blazer"), design("cozy officewear blazer"));
  if (stubbed.length) assert.ok(stubbed.every((id) => kitById(id)));
});
