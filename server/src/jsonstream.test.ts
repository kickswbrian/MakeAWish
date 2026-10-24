import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonStreamScanner } from "./jsonstream.ts";

function scan(src: string, chunk: number) {
  const values: [string, unknown][] = [];
  const items: [string, number, unknown][] = [];
  const s = new JsonStreamScanner({
    onValue: (k, raw) => values.push([k, JSON.parse(raw)]),
    onItem: (k, i, raw) => items.push([k, i, JSON.parse(raw)]),
  });
  for (let i = 0; i < src.length; i += chunk) s.push(src.slice(i, i + chunk));
  s.end();
  return { values, items };
}

const input = {
  template: null,
  meta: { title: 'A {tricky} "bag" ]', category: "bag" },
  patches: [
    { op: "add", part: { id: "a", geometry: { params: { points: [[0, 1], [2, [3]]] } } } },
    { op: "remove", id: "b" },
  ],
  say: "Hi, there! {not json}",
  lock: true,
};

test("emits every top-level value and array item, whatever the chunking", () => {
  for (const chunk of [1, 2, 3, 7, 64, 10_000]) {
    for (const src of [JSON.stringify(input), JSON.stringify(input, null, 2)]) {
      const { values, items } = scan(src, chunk);
      assert.deepEqual(Object.fromEntries(values), input);
      assert.deepEqual(items.map(([k, i, v]) => [k, i, v]), input.patches.map((p, i) => ["patches", i, p]));
    }
  }
});

test("items arrive before the array closes", () => {
  const src = JSON.stringify(input);
  const cut = src.indexOf('{"op":"remove"');
  const s = new JsonStreamScanner({ onItem: (k, i) => seen.push(`${k}:${i}`) });
  const seen: string[] = [];
  s.push(src.slice(0, cut));
  assert.deepEqual(seen, ["patches:0"]);
});

test("a truncated stream keeps what completed", () => {
  const src = JSON.stringify(input);
  const { items } = scan(src.slice(0, src.indexOf('"say"') - 2), 5);
  assert.equal(items.length, 2);
});
