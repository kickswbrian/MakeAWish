/**
 * Replays a wish and its follow-up edits through the brain, the way the studio sends them
 * (template shown first when one matches), and reports floating parts after every turn.
 *   FLOW="Can you make a hoodie that has headphones built in?|make the hood more hollow" npm run flow:test -w server
 * Each step's product is written to web/public/bench/flow_<n>.json for /debug?src=...&bare.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyProduct, floatingParts, matchTemplate, templateProduct, type Product } from "@wishit/shared";
import { runTurn } from "../src/brain.ts";
import type { TranscriptTurn } from "../src/wishes.ts";
import { ROOT } from "../src/env.ts";

const OUT = path.join(ROOT, "web", "public", "bench");
const steps = (process.env.FLOW ?? "").split("|").map((s) => s.trim()).filter(Boolean);
let product: Product = emptyProduct("flow");
const transcript: TranscriptTurn[] = [];
for (const [i, text] of steps.entries()) {
  const tpl = i === 0 ? matchTemplate(text) : undefined;
  if (tpl) product = templateProduct(tpl, "flow");
  const t0 = performance.now();
  const r = await runTurn({ text, product, selection: null, outline: [], transcript, template: tpl?.id ?? null }, () => {}, new AbortController().signal);
  product = r.product;
  transcript.push({ role: "user", text, at: Date.now() }, { role: "genie", text: r.say, at: Date.now() });
  fs.writeFileSync(path.join(OUT, `flow_${i + 1}${process.env.BENCH_SUFFIX ?? ""}.json`), JSON.stringify(product, null, 1));
  const floating = floatingParts(product);
  console.log(`${i + 1}. ${Math.round(performance.now() - t0)}ms ${tpl ? `[template ${tpl.id}] ` : ""}parts ${Object.keys(product.parts).length} rejected ${r.rejected} floating ${floating.join(" ") || "none"}\n   "${text}" -> "${r.say}"`);
}
