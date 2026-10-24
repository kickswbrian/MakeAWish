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
