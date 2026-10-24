/**
 * Judge-request eval: replays each case's turns through a brain the way the server does
 * (patch, or undo from history) and checks the resulting spec.
 *   npm run judge                         dev corpus, offline rule brain
 *   npm run judge -- --brain=llm          Claude via ANTHROPIC_API_KEY (same as the server)
 *   npm run judge -- --brain=cli          Claude via the local `claude` CLI (no API key needed)
 *   npm run judge -- --cases=path.json    another corpus (JSON array of JudgeCase)
 *   npm run judge -- --only=resize -v     filter by id or tag, print every case
 */
import fs from "node:fs";
import { applyPatch, check, defaultSpec, DEV_CASES, type JudgeCase, type ProductSpec } from "@wishit/shared";
import { ruleBrain, starterTurn, think } from "../src/brain.ts";
import { cliBrain } from "../src/brainCli.ts";
import type { TranscriptTurn } from "../src/wishes.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^-+/, "").split("=");
  return [k, v ?? "true"];
}));
const brain = (args.brain ?? "rules") as "rules" | "llm" | "cli";
const verbose = args.v === "true" || args.verbose === "true";
const concurrency = Number(args.j ?? (brain === "rules" ? 1 : 4));
let cases: JudgeCase[] = args.cases ? JSON.parse(fs.readFileSync(args.cases, "utf8")) : DEV_CASES;
if (args.only) cases = cases.filter((c) => c.id.includes(args.only) || c.tags?.includes(args.only));

// Same order as the server's turn route: a starter wish first, then the brain.
const run = async (spec: ProductSpec, transcript: TranscriptTurn[], text: string) =>
  starterTurn(spec, transcript, text, brain === "rules" ? "rules" : "llm")
  ?? (brain === "rules" ? ruleBrain(spec, transcript, text) : brain === "cli" ? await cliBrain(spec, transcript, text, { model: args.model, effort: args.effort }) : await think(spec, transcript, text));

async function runCase(c: JudgeCase) {
  const start = applyPatch(defaultSpec, c.start ?? {}).spec;
  let spec = start;
  const history: ProductSpec[] = [];
  const transcript: TranscriptTurn[] = [];
  let before = start;
  let say = "";
  let patch: unknown = {};
  for (const [i, text] of [...(c.before ?? []), c.say].entries()) {
    if (i === (c.before?.length ?? 0)) before = spec;
    const r = await run(spec, transcript, text);
    if (r.undo) spec = history.pop() ?? spec;
    else {
      const next = applyPatch(spec, r.patch);
      if (next.changed.length) history.push(spec);
      spec = next.spec;
    }
    transcript.push({ role: "user", text, at: 0 }, { role: "genie", text: r.say, at: 0 });
    say = r.say;
    patch = r.undo ? "undo" : r.patch;
  }
  // Relative checks (unchanged, grew, shrank) compare with the spec just before the judged turn.
  // Undo cases assert absolute values (equals the start), so they don't depend on this.
  const fails = check(spec, before, c.expect, say);
  return { c, fails, say, patch, spec };
}

const results: Awaited<ReturnType<typeof runCase>>[] = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < cases.length) {
    const c = cases[next++];
    try {
      results.push(await runCase(c));
    } catch (e) {
      results.push({ c, fails: [`ERROR ${(e as Error).message}`], say: "", patch: null, spec: defaultSpec });
    }
  }
}));
results.sort((a, b) => cases.indexOf(a.c) - cases.indexOf(b.c));

const byTag = new Map<string, [number, number]>();
for (const r of results) {
  const ok = r.fails.length === 0;
  for (const t of r.c.tags ?? ["untagged"]) {
    const v = byTag.get(t) ?? [0, 0];
    byTag.set(t, [v[0] + (ok ? 1 : 0), v[1] + 1]);
  }
  if (!ok || verbose) {
    console.log(`${ok ? "PASS" : "FAIL"} ${r.c.id}: "${r.c.say}"`);
    if (!ok || verbose) console.log(`     patch: ${JSON.stringify(r.patch)}\n     say:   ${r.say}`);
    for (const f of r.fails) console.log(`     x ${f}`);
  }
}
const passed = results.filter((r) => r.fails.length === 0).length;
console.log(`\nbrain=${brain} cases=${args.cases ?? "dev"}`);
console.log([...byTag].sort().map(([t, [p, n]]) => `  ${t.padEnd(12)} ${p}/${n}`).join("\n"));
console.log(`\n${passed}/${results.length} passed (${((100 * passed) / results.length).toFixed(1)}%)`);
process.exit(passed === results.length ? 0 : 1);
