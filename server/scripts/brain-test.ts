/**
 * Genie bench: scripted wishes and edits straight through the streaming brain, with timings.
 *   npm run brain:test                       # default models
 *   DESIGN_MODEL=claude-sonnet-5 npm run brain:test -- --only=create
 * Writes each resulting product to web/public/bench/<name>.json so /lab/view?src=/bench/<name>.json
 * can render it. Fails if a turn produces no parts or a reply breaks the voice rules.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyProduct, isEmpty, parseProduct, templateById, templateProduct, toProductSpace, type Product, type TurnEvent, type TurnSelection } from "@wishit/shared";
import { brainKind, runTurn } from "../src/brain.ts";
import { env, ROOT } from "../src/env.ts";

// BENCH_ONLY=create | edit | comma-separated step names (npm swallows --flags through workspaces).
const only = process.env.BENCH_ONLY ?? process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const OUT = path.join(ROOT, "web", "public", "bench");
fs.mkdirSync(OUT, { recursive: true });

type Step = { name: string; text: string; from?: string; mode: "create" | "edit"; selection?: TurnSelection; template?: string; near?: { part: string; within: number } };
const steps: Step[] = [
  { name: "backpack", text: "A backpack with a built-in laptop stand", mode: "create" },
  { name: "helmet", text: "A bike helmet with built-in headphones", mode: "create" },
  { name: "lamp", text: "A desk lamp shaped like a mushroom that glows warm orange", mode: "create" },
  { name: "bottle", text: "A water bottle with a fruit infuser and a carry loop", mode: "create" },
  { name: "toaster", text: "A retro toaster with a little window so you can watch the toast", mode: "create" },
  { name: "backpack_wheels", text: "add two wheels at the bottom and a telescoping handle", from: "backpack", mode: "edit" },
  { name: "lamp_edit", text: "make the shade bigger and add a little switch on the base", from: "lamp", mode: "edit" },
  // Tap placement: a zipper where the shopper tapped the speaker's front, flush to the surface.
  // Untapped addition on a nested part: the hat must sit on the head, not a head-height above it.
  { name: "bear_hat", text: "give it a tiny party hat", template: "teddy_bear", mode: "edit", near: { part: "head", within: 0.13 } },
  { name: "tap_zipper", text: "add a zipper here", template: "speaker", mode: "edit", selection: { partId: "body", point: [0.03, -0.02, 0.03], normal: [0, 0, 1], rotation: [0, 0, 0] } },
];

// BENCH_PROMPTS="a cat tree|a guitar with an amp" runs ad-hoc new designs instead of the script.
if (process.env.BENCH_PROMPTS) {
  steps.length = 0;
  process.env.BENCH_PROMPTS.split("|").forEach((text, i) => steps.push({ name: `adhoc_${i + 1}`, text: text.trim(), mode: "create" }));
}

const products = new Map<string, Product>();
let failures = 0;
console.log(`brain: ${brainKind}  design=${env.designModel}  edit=${env.editModel}\n`);

for (const step of steps) {
  if (only && step.mode !== only && !only.split(",").includes(step.name)) continue;
  const fromDisk = (n: string) => {
    try {
      return parseProduct(JSON.parse(fs.readFileSync(path.join(OUT, `${n}.json`), "utf8"))) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const tpl = step.template ? templateById(step.template) : undefined;
  const base = tpl ? templateProduct(tpl, step.name) : step.from ? products.get(step.from) ?? fromDisk(step.from) : emptyProduct(step.name);
  if (!base) continue;
  const t0 = performance.now();
  const events: { at: number; ev: TurnEvent }[] = [];
  const r = await runTurn(
    { text: step.text, product: base, selection: step.selection ?? null, outline: [], transcript: [] },
    (ev) => events.push({ at: performance.now() - t0, ev }),
    new AbortController().signal,
  );
  const ms = Math.round(performance.now() - t0);
  products.set(step.name, r.product);
  fs.writeFileSync(path.join(OUT, `${step.name}${process.env.BENCH_SUFFIX ?? ""}.json`), JSON.stringify(r.product, null, 1));
  const parts = Object.keys(r.product.parts).length;
  const patchEvents = events.filter((e) => e.ev.t === "patches");
  const sentences = (r.say.match(/[.!?](\s|$)/g) ?? []).length;
  const problems: string[] = [];
  if (isEmpty(r.product)) problems.push("no parts");
  if (sentences > 2) problems.push(`${sentences} sentences`);
  if ((r.say.match(/\?/g) ?? []).length > 1) problems.push("more than one question");
  if (step.selection) {
    // The new part must hang off the tapped part, at the tapped point.
    const added = Object.values(r.product.parts).filter((p) => !base.parts[p.id]);
    const near = added.find((p) => p.parent === step.selection!.partId && Math.hypot(...p.transform.position.map((v, i) => v - step.selection!.point![i])) < 0.02);
    if (!near) problems.push(`no new part at the tap point (added: ${added.map((p) => `${p.id}@${p.parent}[${p.transform.position}]`).join(" ")})`);
  }
  if (step.near) {
    // Every new top-level addition must sit within reach of the named part (product space).
    const target = toProductSpace(r.product, step.near.part, [0, 0, 0]);
    const added = Object.values(r.product.parts).filter((p) => !base.parts[p.id] && !(p.parent && !base.parts[p.parent]));
    const far = added.filter((p) => Math.hypot(...toProductSpace(r.product, p.id, [0, 0, 0]).map((v, i) => v - target[i])) > step.near!.within);
    if (!added.length) problems.push("nothing added");
    if (far.length) problems.push(`far from ${step.near.part}: ${far.map((p) => `${p.id}@${p.parent}`).join(" ")}`);
  }
  if (problems.length) failures++;
  const t = r.timing;
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${step.name.padEnd(16)} ${String(ms).padStart(5)}ms  first patch ${String(t.firstPatch ?? "-").padStart(5)}  last ${String(t.lastPatch ?? "-").padStart(5)}  ttft ${String(t.firstToken ?? "-").padStart(5)}  ` +
      `parts ${String(parts).padStart(3)}  batches ${patchEvents.length}  calls ${t.calls}  in ${t.inputTokens} (cached ${t.cachedTokens})  out ${t.outputTokens}  rejected ${r.rejected}\n` +
      `      "${step.text}" -> ${r.product.title}: "${r.say}"${problems.length ? `  [${problems.join(", ")}]` : ""}`,
  );
}
process.exit(failures ? 1 : 0);
