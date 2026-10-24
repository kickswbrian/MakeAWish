import { spawn } from "node:child_process";
import type { ProductSpec } from "@wishit/shared";
import { SYSTEM, tool, ToolInput, turnMessage, undoOf, type BrainResult } from "./brain.ts";
import type { TranscriptTurn } from "./wishes.ts";

/**
 * Claude through the local `claude` CLI, with the server's exact system prompt, turn message and
 * tool schema. For local testing without an API key (BRAIN_CLI=1) and for scripts/judge-eval.ts.
 * Slower than the API (a few seconds a turn), so never the production path.
 */
export function cliBrain(
  spec: ProductSpec, transcript: TranscriptTurn[], text: string,
  opts: { model?: string; effort?: string } = {},
): Promise<BrainResult> {
  const schema = JSON.stringify(tool.input_schema);
  const args = ["-p", "--output-format", "json", "--json-schema", schema, "--system-prompt", SYSTEM,
    "--model", opts.model ?? "claude-opus-5-5", "--effort", opts.effort ?? "low", "--tools", ""];
  return new Promise((resolve, reject) => {
    // No shell: the prompt and schema are long arguments a shell would mangle. A missing binary
    // rejects via "error" and the turn falls back to the rule brain.
    const p = spawn("claude", args, { shell: false });
    // A hung CLI must not block the wish's turn queue forever.
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("claude CLI timed out after 30 s"));
    }, 30_000);
    p.on("close", () => clearTimeout(timer));
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      try {
        const parsed = ToolInput.parse(JSON.parse(out).structured_output);
        resolve({ say: parsed.say, patch: parsed.undo ? {} : parsed.patch, lock: parsed.lock, undo: undoOf(parsed, text), brain: "llm" });
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message} ${err.slice(0, 300)} ${out.slice(0, 300)}`));
      }
    });
    p.stdin.end(turnMessage(spec, transcript, text));
  });
}
