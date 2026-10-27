import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatches, compileOutfit, fashionById, kitById, outfitProduct, placeModules, refitPatches, resolveSlots, templateById } from "../index.ts";

const STYLES = ["hoop", "huggie", "stud", "drop", "statement"];
const SIZES = ["small", "medium", "large"];
const THICK = ["fine", "regular", "chunky"];

test("earrings compile for every style, size and thickness into a valid product on its stand", () => {
  for (const style of STYLES) {
    for (const size of SIZES) {
      for (const thickness of THICK) {
        const controls = { style, size, thickness };
        const c = compileOutfit({ template: "earrings", controls });
        assert.ok(c, `${style}/${size}/${thickness}`);
        assert.equal(c.skipped.length, 0);
        const product = outfitProduct({ template: "earrings", controls }, "t");
        assert.ok(product);
        assert.equal(Object.keys(product.parts).length, c.parts.length, "every part survives validation");
        assert.equal(product.rootId, "stand_base");
        for (const part of c.parts) {
          if (part.kind === "kit") {
            assert.ok(kitById(part.kitAsset ?? ""), part.kitAsset);
            assert.equal(part.parent, "stand_bar", `${part.id} hangs from the bar`);
          }
        }
        const ears = c.parts.filter((p) => p.kind === "kit" && /_(left|right)$/.test(p.id));
        assert.ok(ears.length >= 2);
        // A pair, 2-8 cm apart, the earrings below or on the bar.
        const left = ears.find((p) => p.id.endsWith("_left"))!, right = ears.find((p) => p.id.endsWith("_right"))!;
        const gap = right.transform.position[0] - left.transform.position[0];
        assert.ok(gap > 0.02 && gap < 0.08, `spacing ${gap}`);
      }
    }
  }
});

test("earring zones exist per side, in the bar frame, with matching path normals", () => {
  const t = fashionById("earrings")!;
  for (const style of STYLES) {
    const z = t.zones({ style, size: "medium", thickness: "regular" });
    for (const side of ["left", "right"]) {
      for (const name of ["earlobe", "drop_point", "face", "hoop_front"]) {
        const zone = z[`${name}_${side}`];
        assert.ok(zone, `${style} ${name}_${side}`);
        assert.equal(zone.part, "stand_bar");
        if (zone.path) assert.equal(zone.normals?.length, zone.path.length);
      }
    }
  }
});

test("detail modules land on earring zones (pavé on the hoop front, a charm at the drop point)", () => {
  const t = fashionById("earrings")!;
  const controls = { style: "hoop", size: "medium", thickness: "regular" };
  const slots = resolveSlots(t);
  const { parts, skipped } = placeModules(t, t.zones(controls), [
    { module: "pave", zone: "hoop_front_*" },
    { module: "charm", zone: "drop_point_*", params: { shape: "star" } },
    { module: "gem", zone: "face_left" },
    { module: "pearl", zone: "face_right" },
  ], slots);
  assert.equal(skipped.length, 0);
  assert.equal(parts.length, 6);
  assert.equal(parts.find((p) => p.kitAsset === "pave")?.material.preset, "gem", "pavé takes the stone slot");
  assert.equal(parts.find((p) => p.kitAsset === "pearl")?.material.preset, "pearl", "pearls take the accent slot");
  assert.equal(parts.find((p) => p.kitAsset === "charm")?.material.preset, "metal_polished");
  assert.ok(parts.find((p) => p.kitAsset === "pave")?.kitPath?.length);
});

test("switching style re-cuts the pair and keeps zone details on the stand", () => {
  const product = outfitProduct({ template: "earrings", modules: [{ module: "charm", zone: "drop_point_left" }] }, "t")!;
  const r = refitPatches(product, { style: "stud" });
  assert.ok(r);
  const next = applyPatches(product, r.patches).product;
  assert.ok(next.parts.stud_left && next.parts.stone_right && !next.parts.hoop_left && !next.parts.stand_peg_left);
  assert.ok(next.parts.charm_drop_point_left, "the charm stays");
  assert.equal(next.parts.charm_drop_point_left.parent, "stand_bar");
});

test("earrings are a keyword template", () => {
  const t = templateById("earrings");
  assert.ok(t?.fashion);
  assert.ok(t.keywords.includes("hoop earrings"));
});
