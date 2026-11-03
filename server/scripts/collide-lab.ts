/**
 * Collision lab: a wish, then edits, straight through the brain. Prints each part's product-space box
 * and the floating check. Writes each step to LAB_DIR. LAB_STEPS="a double decker couch|raise the second deck" npm run collide:lab -w server
 */
import fs from "node:fs";
import path from "node:path";
import { emptyProduct, partBox, floatingParts, type Product, type OutlineEntry } from "@wishit/shared";
import { runTurn } from "../src/brain.ts";

const steps = (process.env.LAB_STEPS ?? "a double decker couch|raise the second deck").split("|");
const out = process.env.LAB_OUT ?? "lab";
let product: Product = process.env.LAB_FROM ? JSON.parse(fs.readFileSync(process.env.LAB_FROM, "utf8")) : emptyProduct("lab");
const outline = (p: Product): OutlineEntry[] => Object.keys(p.parts).flatMap((id) => {
  const b = partBox(p, id);
  return b ? [{ id, center: b.min.map((v, i) => (v + b.max[i]) / 2) as OutlineEntry["center"], size: b.max.map((v, i) => v - b.min[i]) as OutlineEntry["size"] }] : [];
});
const r3 = (v: number) => Math.round(v * 1000) / 1000;
for (const [i, text] of steps.entries()) {
  const r = await runTurn({ text, product, selection: null, outline: outline(product), transcript: [] }, () => {}, new AbortController().signal);
  product = r.product;
  fs.writeFileSync(path.join(process.env.LAB_DIR ?? ".", `${out}_${i}.json`), JSON.stringify(product, null, 1));
  console.log(`\n== "${text}" -> ${product.title} (${Object.keys(product.parts).length} parts): ${r.say}`);
  for (const p of Object.values(product.parts)) {
    const b = partBox(product, p.id);
    console.log(`  ${p.id.padEnd(22)} parent=${String(p.parent).padEnd(16)} ${b ? `y ${r3(b.min[1])}..${r3(b.max[1])}  x ${r3(b.min[0])}..${r3(b.max[0])}  z ${r3(b.min[2])}..${r3(b.max[2])}` : "?"}`);
  }
  console.log("  floating:", floatingParts(product).join(" ") || "none");
}
