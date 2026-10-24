/**
 * Judge-request eval: replays each case's turns through a brain the way the server does
 * (patch, or undo from history) and checks the resulting spec.
 *   npm run judge                         dev corpus, offline rule brain
 *   npm run judge -- --brain=llm          Claude via ANTHROPIC_API_KEY (same as the server)
 *   npm run judge -- --brain=cli          Claude via the local `claude` CLI (no API key needed)
 *   npm run judge -- --cases=path.json    another corpus (JSON array of JudgeCase)
 *   npm run judge -- --only=resize -v     filter by id or tag, print every case
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { applyPatch, check, defaultSpec, DEV_CASES, type JudgeCase, type ProductSpec } from "@wishit/shared";
import { ruleBrain, SYSTEM, think, tool, ToolInput, turnMessage, undoOf, type BrainResult } from "../src/brain.ts";
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

/** Claude through `claude -p`, with the server's exact system prompt, turn message and tool schema. */
function cliBrain(spec: ProductSpec, transcript: TranscriptTurn[], text: string): Promise<BrainResult> {
  const schema = JSON.stringify(tool.input_schema);
  const prompt = turnMessage(spec, transcript, text);
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--output-format", "json", "--json-schema", schema, "--system-prompt", SYSTEM, "--model", args.model ?? "claude-opus-5-5", "--effort", args.effort ?? "low", "--tools", ""], { shell: false });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      try {
        const res = JSON.parse(out);
        const parsed = ToolInput.parse(res.structured_output);
        resolve({ say: parsed.say, patch: parsed.undo ? {} : parsed.patch, lock: parsed.lock, undo: undoOf(parsed, text), brain: "llm" });
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message} ${err.slice(0, 300)} ${out.slice(0, 300)}`));
      }
    });
    p.stdin.end(prompt);
  });
}

const run = (spec: ProductSpec, transcript: TranscriptTurn[], text: string) =>
  brain === "rules" ? Promise.resolve(ruleBrain(spec, transcript, text)) : brain === "cli" ? cliBrain(spec, transcript, text) : think(spec, transcript, text);

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
  // Undo cases compare against the spec before the earlier turns; everything else against the turn's own start.
  const fails = check(spec, c.before?.length ? start : before, c.expect);
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
