import { test } from "node:test";
import assert from "node:assert/strict";
import { KIT, KIT_IDS } from "../kit.ts";
import { parseProduct, type Part } from "../product.ts";
import { compileOutfit, outfitProduct, placeModules, placeOnZone, refitPatches, registerFashion, slotPatches } from "./compile.ts";
import { deformNormal, deformPoint } from "./deform.ts";
import type { FashionTemplate, Zone } from "./types.ts";

// A tiny box "jacket": its body grows taller when long, and its zones follow.
const H = { cropped: 0.4, regular: 0.6, long: 0.8 } as Record<string, number>;
const stub: FashionTemplate = {
  id: "test_jacket",
  name: "Test jacket",
  category: "jacket",
  kind: "outerwear",
  keywords: ["test jacket"],
  description: "A test jacket",
  targetPriceUsd: 50,
  controls: { length: { options: ["cropped", "regular", "long"], default: "regular", description: "length" } },
  slots: {
    shell: { description: "body", parts: ["body"], default: { preset: "denim", color: "#2F4F7F" } },
    hardware: { description: "metal", parts: [], default: { preset: "metal_polished", color: "#C9A657" } },
    thread: { description: "stitching", parts: [], default: { preset: "cotton", color: "#D9A441" } },
  },
  build: (c) => [{
    id: "body", name: "Body", kind: "primitive", parent: null,
    geometry: { type: "roundedBox", params: { width: 0.5, height: H[c.length], depth: 0.2 } },
    transform: { position: [0, H[c.length] / 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: { preset: "denim", color: "#2F4F7F" },
  }],
  zones: (c): Record<string, Zone> => {
    const h = H[c.length];
    return {
      chest_left: { part: "body", label: "left chest", at: [-0.12, h / 2 - 0.12, 0.1], normal: [0, 0, 1], room: [0.1, 0.12] },
      chest_right: { part: "body", label: "right chest", at: [0.12, h / 2 - 0.12, 0.1], normal: [0, 0, 1], room: [0.1, 0.12] },
      placket: { part: "body", label: "front placket", path: [[0, h / 2 - 0.02, 0.101], [0, -h / 2 + 0.02, 0.101]], normals: [[0, 0, 1], [0, 0, 1]] },
      side: { part: "body", label: "right side", at: [0.25, 0, 0], normal: [1, 0, 0] },
    };
  },
  modules: [{ module: "stitching", zone: "chest_left" }],
  display: "form",
};
registerFashion([stub]);

// A path kit for the tests (real path modules come from the module families).
if (!KIT.some((k) => k.id === "test_path")) {
  KIT.push({ id: "test_path", name: "Test path", description: "", size: [0.1, 0.002, 0.002], attach: {}, material: "cotton", path: true, family: "construction" });
  KIT_IDS.add("test_path");
}

const near = (a: number[], b: number[], eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test("point placement: on the surface, +Z along the normal", () => {
  const side = stub.zones({ length: "regular" }).side;
  const kit = KIT.find((k) => k.id === "button_sewn")!;
  const p = placeOnZone(kit, side, "side")!;
  assert.deepEqual(p.transform.position, [0.25, 0, 0]);
  // Rotation maps +Z to +X: Ry(90).
  assert.ok(near(p.transform.rotation, [0, 90, 0], 0.01), String(p.transform.rotation));
});

test("compile: base + standard + extra modules, wildcard zones, counts along paths", () => {
  const c = compileOutfit({
    template: "test_jacket",
    materials: { shell: { preset: "leather", color: "#1A1A1D" } },
    modules: [
      { module: "snap_button", zone: "chest_*" },
      { module: "button_sewn", zone: "placket", params: { count: 4 } },
      { module: "test_path", zone: "placket" },
      { module: "nope", zone: "placket" },
    ],
  })!;
  const ids = c.parts.map((p) => p.id);
  assert.ok(ids.includes("body") && ids.includes("stitching_chest_left"));
  assert.equal(c.parts.filter((p) => p.kitAsset === "snap_button").length, 2);
  const buttons = c.parts.filter((p) => p.kitAsset === "button_sewn");
  assert.equal(buttons.length, 4);
  assert.ok(buttons[0].zone!.startsWith("placket@"));
  assert.ok(buttons[0].transform.position[1] > buttons[3].transform.position[1]);
  const path = c.parts.find((p) => p.kitAsset === "test_path")!;
  assert.equal(path.kitPath!.length, 2);
  assert.equal(path.material.preset, "cotton"); // construction -> thread slot
  assert.equal(c.parts.find((p) => p.id === "body")!.material.preset, "leather");
  assert.equal(c.skipped.length, 1);
  assert.equal(c.fashion.slots!.shell.preset, "leather");
});

test("outfit product survives a save/load round trip with its fashion state", () => {
  const p = outfitProduct({ template: "test_jacket", controls: { length: "cropped" }, modules: [{ module: "test_path", zone: "placket" }] }, "x")!;
  const back = parseProduct(JSON.parse(JSON.stringify(p)))!;
  assert.deepEqual(back.fashion?.controls, { length: "cropped" });
  assert.equal(back.fashion?.slots?.shell.preset, "denim");
  const path = Object.values(back.parts).find((q: Part) => q.kitAsset === "test_path")!;
  assert.ok(path.kitPath && path.kitNormals && path.zone === "placket");
});

test("refit: re-cutting moves zone details and reshapes the base", () => {
  const p = outfitProduct({ template: "test_jacket", modules: [{ module: "button_sewn", zone: "placket", params: { count: 3 } }] })!;
  const r = refitPatches(p, { length: "long" })!;
  assert.equal(r.fashion.controls.length, "long");
  const body = r.patches.find((x) => x.op === "update" && x.id === "body");
  assert.ok(body);
  // The placket is centered on the body: its middle button stays, the end ones move out.
  const moved = r.patches.filter((x) => x.op === "update" && x.id.startsWith("button_sewn"));
  assert.equal(moved.length, 2);
  // Unknown control values fall back to the current ones.
  assert.equal(refitPatches(p, { length: "enormous" })!.patches.length, 0);
});

test("slot change hits slot parts and parts still wearing the slot material", () => {
  const p = outfitProduct({ template: "test_jacket", modules: [{ module: "snap_button", zone: "chest_left", material: "hardware" }, { module: "snap_button", zone: "chest_right", material: { preset: "pearl", color: "#F6F1E1" } }] })!;
  const r = slotPatches(p, "hardware", { color: "#C0C4CC" })!;
  const ids = r.patches.map((x) => (x as { id: string }).id);
  assert.ok(ids.includes("snap_button_chest_left"));
  assert.ok(!ids.includes("snap_button_chest_right"));
  assert.equal(r.fashion.slots!.hardware.color, "#C0C4CC");
});

test("deformers: length and fit move points; normals stay unit", () => {
  assert.deepEqual(deformPoint([0, 0.2, 0], { ly: 0.5, lk: 0.5 }), [0, 0.35, 0]);
  assert.deepEqual(deformPoint([0.1, 1, 0.1], { fx: 1.2, fz: 1.1 }).map((v) => +v.toFixed(4)), [0.12, 1, 0.11]);
  const n = deformNormal([0.1, 0.5, 0], [1, 0, 0], { fx: 1.5 });
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
});

test("a placement replaces the same module on its zone instead of doubling it", () => {
  const c = compileOutfit({
    template: "test_jacket",
    modules: [
      { module: "button_sewn", zone: "placket", params: { count: 4 } },
      { module: "button_sewn", zone: "placket", params: { count: 5 } },
      { module: "snap_button", zone: "chest_left" },
      { module: "snap_button", zone: "chest_left", material: { preset: "pearl", color: "#F6F1E1" } },
    ],
  })!;
  assert.equal(c.parts.filter((p) => p.kitAsset === "button_sewn").length, 5);
  const snaps = c.parts.filter((p) => p.kitAsset === "snap_button");
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].material.preset, "pearl");
  // Against an existing product: the old copies come back as replaced.
  const p = outfitProduct({ template: "test_jacket", modules: [{ module: "button_sewn", zone: "placket", params: { count: 3 } }] })!;
  const t = stub;
  const r = placeModules(t, t.zones({ length: "regular" }), [{ module: "button_sewn", zone: "placket@0.5" }], { hardware: { preset: "metal_polished", color: "#C9A657" } }, new Set(Object.keys(p.parts)), Object.values(p.parts));
  assert.equal(r.replaced.length, 1);
  assert.equal(r.parts.length, 1);
});
