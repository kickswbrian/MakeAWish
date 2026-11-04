import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatches, emptyProduct, parseIntent, parseProduct, type Part, type Product } from "./index.ts";

const body: Part = {
  id: "body", name: "Main body", kind: "primitive", parent: null,
  geometry: { type: "roundedBox", params: { width: 0.3, height: 0.45, depth: 0.15 } },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  material: { preset: "nylon", color: "#2E9E5B" },
};
const strap = (id: string, x: number): unknown => ({
  id, name: `${x < 0 ? "Left" : "Right"} strap`, kind: "primitive", parent: "body",
  geometry: { type: "tube", params: { points: [[x, 0.2, -0.08], [x, -0.2, -0.1]], radius: 0.004, width: 0.05 } },
  material: { preset: "nylon", color: "#1a1a1d" },
});

function bag(): Product {
  return applyPatches(emptyProduct("t"), [{ op: "add", part: body }, { op: "add", part: strap("strap_left", -0.1) }, { op: "add", part: strap("strap_right", 0.1) }]).product;
}

test("first add becomes the root; defaults fill in", () => {
  const p = bag();
  assert.equal(p.rootId, "body");
  assert.deepEqual(p.parts.strap_left.transform.scale, [1, 1, 1]);
  assert.equal(p.parts.strap_left.material.color, "#1A1A1D");
});

test("invalid patches are rejected, valid ones still apply", () => {
  const { product, rejected } = applyPatches(bag(), [
    { op: "add", part: { id: "x", kind: "kit", kitAsset: "flux_capacitor", material: { preset: "rubber", color: "#000" } } },
    { op: "update", id: "nope", changes: {} },
    { op: "remove", id: "body" },
    { op: "update", id: "body", changes: { material: { color: "red" } } },
    "junk",
  ]);
  assert.equal(rejected.length, 4);
  assert.equal(product.parts.body.material.color, "#D7263D");
});

test("updates merge nested fields and geometry params", () => {
  const { product } = applyPatches(bag(), [{ op: "update", id: "body", changes: { transform: { scale: [2, 2, 2] }, geometry: { params: { height: 0.5 } } } }]);
  const b = product.parts.body;
  assert.deepEqual(b.transform.position, [0, 0, 0]);
  assert.deepEqual(b.transform.scale, [2, 2, 2]);
  assert.equal(b.geometry?.type === "roundedBox" && b.geometry.params.width, 0.3);
  assert.equal(b.geometry?.type === "roundedBox" && b.geometry.params.height, 0.5);
});

test("colliding ids are renamed, missing parents attach to the root, removes take the subtree", () => {
  let { product } = applyPatches(bag(), [{ op: "add", part: { ...(strap("strap_left", 0) as object), parent: "ghost" } }]);
  assert.ok(product.parts.strap_left_2);
  assert.equal(product.parts.strap_left_2.parent, "body");
  ({ product } = applyPatches(product, [
    { op: "add", part: { id: "zip", name: "Zipper", kind: "kit", kitAsset: "zipper", parent: "strap_left", material: { preset: "nylon", color: "#111111" } } },
    { op: "remove", id: "strap_left" },
  ]));
  assert.equal(product.parts.zip, undefined);
  assert.equal(product.parts.strap_left, undefined);
});

test("parseProduct round-trips and drops junk parts", () => {
  const p = bag();
  const raw = JSON.parse(JSON.stringify(p));
  raw.parts.bad = { id: "bad", kind: "primitive" };
  const back = parseProduct(raw)!;
  assert.deepEqual(Object.keys(back.parts).sort(), ["body", "strap_left", "strap_right"]);
  assert.equal(back.rootId, "body");
});

test("fast path: color, material, size, remove, named parts", () => {
  const p = bag();
  const red = parseIntent("make it red", { product: p })!;
  assert.deepEqual(red.targets, ["body"]);
  assert.equal(red.patches.length, 1);
  const straps = parseIntent("make the straps black", { product: p })!;
  assert.deepEqual(straps.targets.sort(), ["strap_left", "strap_right"]);
  const leftOnly = parseIntent("make the left strap red", { product: p })!;
  assert.deepEqual(leftOnly.targets, ["strap_left"]);
  const big = parseIntent("a bit bigger", { product: p, selectedId: "strap_left" })!;
  assert.equal(big.patches[0].op, "update");
  const gold = parseIntent("gold", { product: p, selectedId: "strap_left" })!;
  assert.ok(gold.kinds.includes("material"));
  assert.ok(parseIntent("remove this", { product: p, selectedId: "strap_right" })!.patches[0].op === "remove");
  assert.equal(parseIntent("remove this", { product: p }), null);
  assert.equal(parseIntent("add a zipper here", { product: p }), null);
  assert.equal(parseIntent("make it red and add a cup holder", { product: p }), null);
  assert.ok(parseIntent("undo", { product: p })!.kinds.includes("undo"));
});

test("templates: every part survives validation, keywords pick the product noun", async () => {
  const { TEMPLATES, templateProduct, matchTemplate } = await import("./index.ts");
  assert.ok(TEMPLATES.length >= 12);
  for (const t of TEMPLATES) assert.equal(Object.keys(templateProduct(t).parts).length, t.parts.length, t.id);
  assert.equal(matchTemplate("A backpack with a built-in laptop stand")?.id, "backpack");
  assert.equal(matchTemplate("a bike helmet with built-in headphones")?.id, "bike_helmet");
  assert.equal(matchTemplate("a midi dress that turns into a skirt")?.id, "convertible_dress");
  assert.equal(matchTemplate("a car with a cup holder"), null);
  assert.equal(matchTemplate("a lamp shaped like a mushroom"), null);
  // A keyword used as a modifier names a different product.
  for (const other of ["a phone charger", "a board game", "a wine glasses rack", "a car seat", "a watch winder box"]) assert.equal(matchTemplate(other), null, other);
  assert.equal(matchTemplate("a polar bear plush")?.id, "teddy_bear");
  for (const plain of ["a plush", "a cute plushie", "a giant stuffed animal", "a pink soft toy"]) assert.equal(matchTemplate(plain)?.id, "teddy_bear", plain);
  // A named character or creature is its own design, not a recolored bear.
  for (const named of ["a sonic the hedgehog plush", "a frog plushie", "a kirby plush", "a dinosaur stuffed animal"]) assert.equal(matchTemplate(named), null, named);
  assert.equal(matchTemplate("a backpack made of cork")?.id, "backpack");
  for (const [wish, id] of [["a backpack, red and waterproof", "backpack"], ["a mug now", "mug"], ["a beer mug", "mug"], ["two teddies", "teddy_bear"], ["Hi! I want a backpack with wheels", "backpack"]]) assert.equal(matchTemplate(wish)?.id, id, wish);
  for (const other of ["a hot water bottle", "a table runner", "wine glasses"]) assert.equal(matchTemplate(other), null, other);
});

test("fast path: camera commands", () => {
  const p = bag();
  assert.equal(parseIntent("show me the back", { product: p })?.view, "back");
  assert.equal(parseIntent("zoom in please", { product: p })?.view, "zoom_in");
  assert.equal(parseIntent("take it apart", { product: p })?.view, "explode");
  assert.equal(parseIntent("put it back together", { product: p })?.view, "assemble");
  assert.equal(parseIntent("show me a backpack with wheels", { product: p }), null);
});

test("frames: product-space positions written for a child get converted to the parent frame", async () => {
  const { fixChildFrame, toPartSpace, toProductSpace } = await import("./frames.ts");
  const base = applyPatches(emptyProduct("f"), [
    { op: "add", part: { id: "body", name: "Body", kind: "primitive", parent: null, geometry: { type: "sphere", params: { radius: 0.1 } }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { preset: "suede", color: "#B07A4A" } } },
    { op: "add", part: { id: "head", name: "Head", kind: "primitive", parent: "body", geometry: { type: "sphere", params: { radius: 0.072 } }, transform: { position: [0, 0.236, 0.006], rotation: [0, 30, 0], scale: [1, 1, 1] }, material: { preset: "suede", color: "#B07A4A" } } },
  ]).product;
  const head = { center: [0, 0.236, 0.006] as [number, number, number], size: [0.144, 0.144, 0.144] as [number, number, number] };
  // The hat written at the head's product-space top: converted.
  const fixed = fixChildFrame(base, "head", [0, 0.305, -0.01], head);
  assert.ok(fixed);
  const onTop = toProductSpace(base, "head", fixed!);
  assert.ok(Math.abs(onTop[1] - 0.305) < 0.002 && Math.abs(onTop[2] + 0.01) < 0.002, String(onTop));
  // Already in the head's frame: left alone.
  assert.equal(fixChildFrame(base, "head", [0, 0.07, 0], head), null);
  // Round trip through a rotated, offset parent.
  const p: [number, number, number] = [0.02, -0.03, 0.05];
  const back = toPartSpace(base, "head", toProductSpace(base, "head", p));
  assert.ok(back.every((v, i) => Math.abs(v - p[i]) < 1e-9));
});

test("templates survive a save/reload round trip (parents and cutter links intact)", async () => {
  const { TEMPLATES, templateProduct } = await import("./index.ts");
  for (const t of TEMPLATES) {
    const a = templateProduct(t, "rt");
    const b = parseProduct(JSON.parse(JSON.stringify(a)))!;
    assert.equal(Object.keys(b.parts).length, Object.keys(a.parts).length, t.id);
    for (const [id, p] of Object.entries(a.parts)) {
      assert.deepEqual(b.parts[id]?.csg, p.csg, `${t.id}/${id} csg`);
      assert.equal(b.parts[id]?.parent, p.parent, `${t.id}/${id} parent`);
    }
  }
});

test("addOrder keeps the root first and cutters after their targets", async () => {
  const { addOrder } = await import("./product.ts");
  const order = addOrder([{ id: "a", csg: { withPartId: "b" } }, { id: "b", parent: "a" }], "a").map((p) => p.id);
  assert.deepEqual(order, ["a", "b"]);
  const order2 = addOrder([{ id: "cut", parent: "root", csg: { withPartId: "pocket" } }, { id: "root" }, { id: "pocket", parent: "root" }], "root").map((p) => p.id);
  assert.deepEqual(order2, ["root", "pocket", "cut"]);
});

test("no template has floating parts", async () => {
  const { TEMPLATES, templateProduct, floatingParts } = await import("./index.ts");
  for (const t of TEMPLATES) assert.deepEqual(floatingParts(templateProduct(t, "f")), [], t.id);
});

test("groundPart settles a part placed in the air onto the product", async () => {
  const { floatingParts, groundPart } = await import("./index.ts");
  const knob = (position: [number, number, number]): unknown => ({
    id: "knob", name: "Knob", kind: "primitive", parent: "body", geometry: { type: "sphere", params: { radius: 0.02 } },
    transform: { position }, material: { preset: "plastic_matte", color: "#222222" },
  });
  // A knob 15 cm above the bag's top: slid straight down onto it.
  let p = applyPatches(bag(), [{ op: "add", part: knob([0.05, 0.375, 0]) }]).product;
  assert.deepEqual(floatingParts(p), ["knob"]);
  const pos = groundPart(p, "knob")!;
  assert.equal(pos[0], 0.05);
  assert.ok(pos[1] > 0.2 && pos[1] < 0.245, `y ${pos[1]}`);
  p = applyPatches(p, [{ op: "update", id: "knob", changes: { transform: { position: pos } } }]).product;
  assert.deepEqual(floatingParts(p), []);

  // Written in product space under a moved parent: read it that way instead of sliding.
  const slip = applyPatches(bag(), [
    { op: "add", part: { id: "pocket", name: "Pocket", kind: "primitive", parent: "body", geometry: { type: "roundedBox", params: { width: 0.2, height: 0.15, depth: 0.04 } }, transform: { position: [0, -0.12, 0.09] }, material: { preset: "nylon", color: "#333333" } } },
    { op: "add", part: { ...(knob([0, -0.12, 0.12]) as object), id: "zip", parent: "pocket" } },
  ]).product;
  assert.deepEqual(floatingParts(slip), ["zip"]);
  assert.deepEqual(groundPart(slip, "zip"), [0, 0, 0.03]);
});

test("levels: a bunk deck that hovers gets its posts stretched; one through the cushions is caught", async () => {
  const { levelIssues, stretchUp, TEMPLATES, templateProduct } = await import("./index.ts");
  const box = (id: string, parent: string | null, w: number, h: number, d: number, position: [number, number, number]): unknown => ({
    id, name: id, kind: "primitive", parent, geometry: { type: "roundedBox", params: { width: w, height: h, depth: d } }, transform: { position }, material: { preset: "fabric_knit", color: "#888888" },
  });
  const post = (id: string, x: number, z: number): unknown => ({
    id, name: id, kind: "primitive", parent: "base", geometry: { type: "cylinder", params: { radiusTop: 0.03, radiusBottom: 0.03, height: 0.7 } }, transform: { position: [x, 0.5, z] }, material: { preset: "wood_oak", color: "#7A5230" },
  });
  // A couch base on the floor (y 0..0.3), a back cushion up to 0.75, posts up to 1.0, the deck on them.
  const bunk = (deckBottom: number) => applyPatches(emptyProduct("bunk"), [
    { op: "add", part: box("base", null, 2, 0.3, 0.9, [0, 0.15, 0]) },
    { op: "add", part: box("cushion", "base", 0.6, 0.45, 0.3, [0, 0.375, -0.25]) },
    ...[[-0.95, 0.4], [0.95, 0.4], [-0.95, -0.4], [0.95, -0.4]].map(([x, z], i) => ({ op: "add", part: post(`post${i}`, x, z) })),
    { op: "add", part: box("deck", "base", 2, 0.05, 0.9, [0, deckBottom + 0.025 - 0.15, 0]) },
  ]).product;
  assert.deepEqual(levelIssues(bunk(1)), []);

  const raised = bunk(1.2);
  const [hover] = levelIssues(raised);
  assert.equal(hover?.kind, "hovers");
  assert.ok(hover.kind === "hovers" && Math.abs(hover.gap - 0.2) < 1e-6 && hover.posts.length === 4, JSON.stringify(hover));
  const fixed = applyPatches(raised, hover.kind === "hovers" ? hover.posts.flatMap((id) => stretchUp(raised, id, hover.gap)!) : []).product;
  assert.deepEqual(levelIssues(fixed), []);
  assert.equal(fixed.parts.post0.geometry?.type === "cylinder" && fixed.parts.post0.geometry.params.height, 0.9);

  const [cut] = levelIssues(bunk(0.5));
  assert.ok(cut?.kind === "cuts" && cut.others.includes("cushion") && Math.abs(cut.clearY - 0.75) < 1e-6, JSON.stringify(cut));

  for (const t of TEMPLATES) assert.deepEqual(levelIssues(templateProduct(t, "l")), [], t.id);
});

test("svg extrudes: pieces, holes and arcs parse; the part gets a fallback outline and a real box", async () => {
  const { svgOutline, parsePart, localBox } = await import("./index.ts");
  const ring = svgOutline("M50 10 A40 40 0 1 1 49.9 10 Z M50 30 a20 20 0 1 0 0.1 0z M120 10 h30 v30 h-30 z", 0.1)!;
  assert.equal(ring.shapes.length, 2);
  assert.deepEqual(ring.shapes.map((s) => s.holes.length).sort(), [0, 1]);
  assert.ok(Math.abs(ring.width - 0.1) < 1e-6);
  const r = parsePart({ id: "eagle", name: "Eagle", kind: "primitive", parent: "plate", geometry: { type: "extrude", params: { svg: "M0 0 L40 0 L40 20 C30 30 10 30 0 20 Z", width: 0.04, depth: 0.004 } }, material: { preset: "metal_polished", color: "#cccccc" } });
  assert.ok("part" in r, JSON.stringify(r));
  const box = localBox(r.part)!;
  assert.ok(Math.abs(box.max[0] - 0.02) < 1e-6 && box.max[1] > 0.01, JSON.stringify(box));
});

test("hangCords: a pull cord under a tilted shade hangs straight down, its charm below it", async () => {
  const { hangCords, toProductSpace } = await import("./index.ts");
  const p = applyPatches(emptyProduct("lamp"), [
    { op: "add", part: { id: "base", name: "Base", kind: "primitive", parent: null, geometry: { type: "cylinder", params: { radiusTop: 0.08, radiusBottom: 0.08, height: 0.02 } }, material: { preset: "metal_brushed", color: "#888888" } } },
    { op: "add", part: { id: "shade", name: "Shade", kind: "primitive", parent: "base", geometry: { type: "cylinder", params: { radiusTop: 0.03, radiusBottom: 0.07, height: 0.1, open: true } }, transform: { position: [0, 0.4, 0], rotation: [-55, 0, 30] }, material: { preset: "metal_brushed", color: "#C0603A" } } },
    { op: "add", part: { id: "pull_cord", name: "Pull cord", kind: "primitive", parent: "shade", geometry: { type: "tube", params: { points: [[0, 0.03, 0], [0, -0.03, 0], [0, -0.09, 0]], radius: 0.0012 } }, material: { preset: "cotton", color: "#eeeeee" } } },
    { op: "add", part: { id: "bird", name: "Bird charm", kind: "primitive", parent: "pull_cord", geometry: { type: "sphere", params: { radius: 0.012 } }, transform: { position: [0, -0.1, 0] }, material: { preset: "plastic_gloss", color: "#3A7CA5" } } },
  ]).product;
  const fixed = applyPatches(p, hangCords(p, ["pull_cord", "bird"])).product;
  const g = fixed.parts.pull_cord.geometry as { params: { points: [number, number, number][] } };
  const pts = g.params.points.map((q) => toProductSpace(fixed, "pull_cord", q));
  for (const q of pts) assert.ok(Math.abs(q[0] - pts[0][0]) < 2e-3 && Math.abs(q[2] - pts[0][2]) < 2e-3, `cord not vertical: ${JSON.stringify(pts)}`);
  const bird = toProductSpace(fixed, "bird", [0, 0, 0]);
  assert.ok(Math.abs(bird[0] - pts[0][0]) < 2e-3 && bird[1] < Math.min(...pts.map((q) => q[1])), `bird not below: ${bird}`);
  // Hanging already: nothing to do.
  assert.deepEqual(hangCords(fixed, ["pull_cord", "bird"]), []);
});
