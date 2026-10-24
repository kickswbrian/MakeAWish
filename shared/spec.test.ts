import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, defaultSpec, guessPatch } from "./index.ts";

test("applyPatch keeps valid fields and drops invalid ones", () => {
  const { spec, changed, dropped } = applyPatch(defaultSpec, {
    category: "dress",
    color: "not-a-color",
    length: "ankle",
    fabric: "satin",
    bogus: 1,
  });
  assert.equal(spec.category, "dress");
  assert.equal(spec.fabric, "satin");
  assert.equal(spec.color, undefined);
  assert.equal(spec.length, undefined);
  assert.deepEqual(changed.sort(), ["category", "fabric"]);
  assert.deepEqual(dropped.sort(), ["bogus", "color", "length"]);
});

test("applyPatch normalizes color names and short hex", () => {
  assert.equal(applyPatch(defaultSpec, { color: "emerald" }).spec.color, "#1F8A5B");
  assert.equal(applyPatch(defaultSpec, { color: "#abc" }).spec.color, "#AABBCC");
});

test("applyPatch never throws on junk", () => {
  assert.doesNotThrow(() => applyPatch(defaultSpec, null));
  assert.doesNotThrow(() => applyPatch(defaultSpec, "x"));
  assert.doesNotThrow(() => applyPatch(defaultSpec, { features: "nope", target_price_usd: -3 }));
});

test("guessPatch reads the demo wish", () => {
  const p = guessPatch("I want a midi dress that turns into a skirt, with pockets that actually fit my phone");
  assert.equal(p.category, "dress");
  assert.equal(p.length, "midi");
  assert.ok(p.features?.includes("converts_to_skirt"));
  assert.ok(p.features?.includes("phone_pockets"));
  const p2 = guessPatch("emerald green, and a little shorter", { category: "dress", length: "midi" });
  assert.equal(p2.color, "#1F8A5B");
  assert.equal(p2.length, "knee");
});
