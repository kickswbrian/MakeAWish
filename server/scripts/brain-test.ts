/**
 * Step B2's check: 5 scripted utterances through the design brain.
 *   npm run brain:test
 * Uses Claude when ANTHROPIC_API_KEY is set, else the offline rule brain. Fails if a reply is
 * longer than 2 sentences, has more than one question, or a patch has an invalid field.
 */
import { applyPatch, defaultSpec, type ProductSpec } from "@wishit/shared";
import { brainKind, think } from "../src/brain.ts";
import type { TranscriptTurn } from "../src/wishes.ts";

const script: { text: string; newWish?: boolean }[] = [
  { text: "I want a midi dress that turns into a skirt, with pockets that actually fit my phone" },
  { text: "emerald green, and a little shorter" },
  { text: "satin, and I'd pay about eighty bucks" },
  { text: "a bike helmet with built-in headphones", newWish: true },
  { text: "yes, make it real" },
];

let spec: ProductSpec = defaultSpec;
let transcript: TranscriptTurn[] = [];
let failures = 0;
console.log(`brain: ${brainKind}\n`);

for (const [i, step] of script.entries()) {
  if (step.newWish) {
    spec = defaultSpec;
    transcript = [];
  }
  const started = Date.now();
  const r = await think(spec, transcript, step.text);
  const ms = Date.now() - started;
  const { spec: next, changed, dropped } = applyPatch(spec, r.patch);
  const sentences = r.say.match(/[^.!?]+[.!?]+/g)?.length ?? 1;
  const questions = (r.say.match(/\?/g) ?? []).length;
  const problems = [
    sentences > 2 && `${sentences} sentences`,
    questions > 1 && `${questions} questions`,
    dropped.length > 0 && `invalid fields: ${dropped.join(", ")}`,
    i === 4 && !r.lock && "expected lock: true",
  ].filter(Boolean);
  if (problems.length) failures++;
  console.log(`${i + 1}. "${step.text}"  (${r.brain}, ${ms}ms)`);
  console.log(`   say:     ${r.say}`);
  console.log(`   patch:   ${JSON.stringify(r.patch)}`);
  console.log(`   changed: [${changed.join(", ")}]  lock: ${r.lock}`);
  console.log(`   ${problems.length ? `FAIL ${problems.join("; ")}` : "ok"}\n`);
  spec = next;
  transcript.push({ role: "user", text: step.text, at: started }, { role: "genie", text: r.say, at: Date.now() });
}

console.log(failures ? `${failures} step(s) failed` : "All 5 steps passed");
process.exit(failures ? 1 : 0);
