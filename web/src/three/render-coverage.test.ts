/**
 * Render coverage: everything the spec can say, some renderer draws. A brain can only make a
 * judge's edit visible if the field it writes is actually rendered.
 *   npm test   (runs with the shared tests)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDON_SHAPES, BODY_SHAPES, CATEGORIES, DECAL_SHAPES, FABRICS, FINISHES, NECKLINES, PARTS, PATTERNS, PLACEMENTS, SLEEVES,
  type ProductSpec,
} from "@wishit/shared";
import { anchorFor, slide } from "./anchors.ts";
import { SLEEVE_LEN, targetsFor } from "./garmentShape.ts";
import { FABRIC_LOOK, FINISH_LOOK } from "./shapes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f: string) => fs.readFileSync(path.join(here, f), "utf8");

const SPECS: ProductSpec[] = [
  ...CATEGORIES.filter((c) => c !== "generic").map((category) => ({ category })),
  { category: "dress", length: "mini", silhouette: "flowy", parts: { skirt: { scale: 2 } } },
  { category: "skirt", length: "maxi", silhouette: "fitted" },
  { category: "generic" }, // the wish orb
  ...BODY_SHAPES.map((shape) => ({ category: "generic" as const, body: { shape, width: 0.5, height: 0.6 } })),
  { category: "generic", body: { shape: "box", width: 0.6, height: 0.1, depth: 0.6 }, addons: [{ name: "legs", shape: "cylinder", placement: "bottom", count: 4 }] },
];

test("every placement resolves to a finite, on-stage anchor for every model", () => {
  for (const spec of SPECS)
    for (const p of PLACEMENTS) {
      const a = anchorFor(spec, p);
      const label = `${spec.category}/${spec.body?.shape ?? ""} ${p}`;
      for (const v of [...a.pos, ...a.normal, ...a.tangent, a.base]) assert.ok(Number.isFinite(v), `${label}: non-finite anchor`);
      assert.ok(Math.abs(Math.hypot(...a.normal) - 1) < 1e-6, `${label}: normal not unit`);
      assert.ok(a.pos[1] > 0.1 && a.pos[1] < 1.9, `${label}: y ${a.pos[1]} off the stage`);
      assert.ok(Math.hypot(a.pos[0], a.pos[2]) < 0.8, `${label}: too far from the pedestal axis`);
      assert.ok(a.base > 0.04 && a.base < 0.5, `${label}: decal size ${a.base}`);
      // Copies slide along the surface and stay finite.
      for (const s of [-0.2, 0.2]) for (const v of slide(a, s).pos) assert.ok(Number.isFinite(v), `${label}: slide`);
    }
});

test("front and back anchors face the camera side they name", () => {
  for (const spec of SPECS) {
    assert.ok(anchorFor(spec, "front").normal[2] > 0.3, `${spec.category} front`);
    assert.ok(anchorFor(spec, "back").normal[2] < -0.3, `${spec.category} back`);
    assert.ok(anchorFor(spec, "left").pos[0] < anchorFor(spec, "right").pos[0], `${spec.category} left/right`);
  }
});

test("every named part is drawn by its category's renderer", () => {
  const files: Record<string, string> = {
    dress: src("Garment.tsx"), top: src("Garment.tsx"), skirt: src("Garment.tsx"),
    backpack: src("Products.tsx"), helmet: src("Products.tsx"), generic: src("Extras.tsx"),
  };
  for (const [cat, parts] of Object.entries(PARTS))
    for (const name of parts) assert.match(files[cat], new RegExp(`(name="${name}"|part\\("${name}"|"${name}"\\)|parts\\?\\.${name}\\b)`), `${cat}.${name} has no renderer`);
});

test("every decal icon, add-on primitive and body shape has a drawing", () => {
  const extras = src("Extras.tsx");
  for (const s of DECAL_SHAPES) assert.match(extras, new RegExp(`\\n  ${s}: \\(g\\)`), `icon ${s}`);
  for (const s of ADDON_SHAPES) assert.match(extras, new RegExp(`case "${s}"`), `add-on ${s}`);
  for (const s of BODY_SHAPES) assert.match(extras, new RegExp(`case "${s}": `), `body ${s}`);
});

test("every pattern, fabric, finish, neckline and sleeve has a look", () => {
  const shapes = src("shapes.ts");
  for (const p of PATTERNS.filter((p) => p !== "solid" && p !== "floral")) assert.match(shapes, new RegExp(`kind === "${p}"`), `pattern ${p}`);
  for (const f of FABRICS) assert.ok(FABRIC_LOOK[f], `fabric ${f}`);
  for (const f of FINISHES) assert.ok(FINISH_LOOK[f], `finish ${f}`);
  for (const s of SLEEVES) assert.ok(SLEEVE_LEN[s] !== undefined, `sleeves ${s}`);
  for (const neckline of NECKLINES) {
    const t = targetsFor({ category: "dress", neckline });
    const sum = t.nCrew + t.nV + t.nSq + t.nH + t.nScoop + t.nSweet + t.nTurtle + t.nOff;
    assert.equal(sum, 1, `neckline ${neckline} has no shape`);
  }
});
