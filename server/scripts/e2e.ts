/**
 * End-to-end check of the whole product against a running server (npm run dev first):
 * wish -> starter -> edits -> live Q&A -> undo -> any product -> lock -> matches -> campaign ->
 * pledges (good and declined cards) -> capture at goal -> a second campaign that expires and releases.
 *   npm run e2e                       against http://localhost:3000
 *   npm run e2e -- --base=https://... against a deploy (admin steps need ADMIN_TOKEN in env)
 * Payments must be in mock mode (no Stripe keys) for the pledge steps; they are skipped otherwise.
 */
import { colorFamily, type Campaign, type MatchesResponse, type ProductSpec, type TurnResponse, type WishDTO } from "@wishit/shared";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^-+/, "").split("=") as [string, string]));
const BASE = (args.base ?? "http://localhost:3000").replace(/\/$/, "");
const admin = process.env.ADMIN_TOKEN;

let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  console.log(results[results.length - 1]);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(admin ? { "x-admin-token": admin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs: number, everyMs = 1000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let v = await fn();
  while (!done(v) && Date.now() < end) {
    await sleep(everyMs);
    v = await fn();
  }
  return v;
}
const turn = async (id: string, text: string) => {
  const t0 = Date.now();
  const r = await call<TurnResponse>("POST", `/api/wish/${id}/turn`, { text });
  console.log(`     "${text}" -> ${r.brain} ${Date.now() - t0}ms: ${r.say}`);
  return { ...r, wall: Date.now() - t0 };
};
const fam = (hex?: string) => (hex ? colorFamily(hex) : "none");
const visual = (s: ProductSpec) => JSON.stringify([s.category, s.color, s.features, s.parts, s.decals, s.addons, s.body, s.scale, s.length]);

const config = await call<{ brain: string; paymentMode: string; demoMode: boolean }>("GET", "/api/config");
console.log(`server ${BASE}: brain=${config.brain} payments=${config.paymentMode} demoMode=${config.demoMode}\n`);

// ---- 1. Starting a wish: a starter is instant and complete ----
const w1 = await call<WishDTO>("POST", "/api/wish");
let r = await turn(w1.id, "A bike helmet with built-in headphones");
check("starter: headphone helmet", r.spec.category === "helmet" && !!r.spec.features?.includes("headphones"), `${r.spec.category} ${r.spec.features}`);
check("starter: instant (< 500 ms)", r.wall < 500, `${r.wall} ms`);

// ---- 2. Judge edits ----
r = await turn(w1.id, "make it yellow and put cat ears on top");
check("edit: recolor + add-on", fam(r.spec.color) === "yellow" && !!r.spec.addons?.some((a) => /ear/i.test(a.name)), `${r.spec.color} ${JSON.stringify(r.spec.addons?.map((a) => a.name))}`);
r = await turn(w1.id, "draw a lightning bolt on the left side");
check("edit: decal on the left", !!r.spec.decals?.some((d) => /lightning|⚡/.test(d.content) && d.placement === "left"), JSON.stringify(r.spec.decals));
const beforeQa = r.spec;

// ---- 3. Live Q&A: answers, and the design doesn't move ----
const qa: [string, RegExp][] = [
  ["wait, will my card get charged if nobody else backs it?", /hold|released|not charged|won'?t be charged|nobody pays|only if/i],
  ["how do you know whether this already exists?", /search|amazon|etsy|google|store/i],
  ["who actually manufactures it?", /maker|manufactur|simulated|purchase order/i],
  ["how long does a campaign run?", /six|6|days|deadline/i],
  ["what's it made of right now?", /helmet|yellow|ear|lightning|glossy/i],
];
for (const [q, want] of qa) {
  r = await turn(w1.id, q);
  check(`Q&A: ${q}`, want.test(r.say) && visual(r.spec) === visual(beforeQa), r.say.slice(0, 90));
}

// ---- 4. Undo ----
r = await turn(w1.id, "make the visor black");
check("edit: part recolor (visor)", fam(r.spec.parts?.visor?.color) === "black", JSON.stringify(r.spec.parts));
r = await turn(w1.id, "undo that");
check("undo restores the visor", !r.spec.parts?.visor?.color, JSON.stringify(r.spec.parts));

// ---- 5. Any product renders ----
const w2 = await call<WishDTO>("POST", "/api/wish");
r = await turn(w2.id, "a robot vacuum that empties itself");
check("any product: renders a body", r.spec.category === "generic" && !!r.spec.body, JSON.stringify(r.spec.body));
check("any product: has a name", !!r.spec.name, r.spec.name ?? "");

// ---- 6. Lock -> matches ----
await call("POST", `/api/wish/${w1.id}/lock`);
const m = await until(() => call<MatchesResponse>("GET", `/api/wish/${w1.id}/matches`), (x) => !x.pending && x.searched + x.total > 0, 150_000, 2000);
check("matches: search finishes (not stuck pending)", !m.pending, `searched ${m.searched}/${m.total}, ${m.matches.length} matches${m.sample ? ", sample" : ""}`);
check("matches: cards to show", m.matches.length > 0);

// ---- 7. Campaign, pledges, capture at goal ----
if (config.paymentMode !== "mock") {
  console.log(`SKIP pledge steps: payments=${config.paymentMode} (they need the simulated provider)`);
} else {
  const c = await call<Campaign>("POST", "/api/campaigns", { wishId: w1.id, priceCents: 4900, targetBackers: 2, deadlineAt: Date.now() + 10 * 60_000 });
  check("campaign: created, funding", c.status === "funding", c.status);
  const pledge = async (email: string, card: string) => {
    const p = await call<{ pledgeId: string }>("POST", `/api/campaigns/${c.id}/pledges`, { email });
    await call("POST", `/api/mock/pledges/${p.pledgeId}/confirm`, { card });
    return until(() => call<{ status: string; failReason: string | null }>("GET", `/api/pledges/${p.pledgeId}`), (x) => x.status !== "created", 10_000, 300);
  };
  const p1 = await pledge("judge1@example.com", "4242 4242 4242 4242");
  check("pledge 1 (good card): held", p1.status === "held" || p1.status === "captured", p1.status);
  const p2 = await pledge("judge2@example.com", "4000 0000 0000 0002");
  check("pledge 2 (declined card): failed with a reason", p2.status === "failed" && !!p2.failReason, `${p2.status} ${p2.failReason}`);
  let cc = await call<Campaign>("GET", `/api/campaigns/${c.id}`);
  check("declined card doesn't count", cc.held === 1 && cc.status === "funding", `held ${cc.held}, ${cc.status}`);
  await pledge("judge3@example.com", "4242424242424242");
  cc = await until(() => call<Campaign>("GET", `/api/campaigns/${c.id}`), (x) => x.status === "funded", 15_000, 500);
  check("goal hit: every hold captured, funded", cc.status === "funded" && cc.captured === 2, `${cc.status}, captured ${cc.captured}`);
  check("goal hit: purchase order to a (simulated) maker", !!cc.maker?.name, cc.maker?.name ?? "");

  // A second campaign that misses its goal: holds are released.
  const c2 = await call<Campaign>("POST", "/api/campaigns", { wishId: w2.id, priceCents: 2500, targetBackers: 5, deadlineAt: Date.now() + 10 * 60_000 });
  const q1 = await call<{ pledgeId: string }>("POST", `/api/campaigns/${c2.id}/pledges`, { email: "backer@example.com" });
  await call("POST", `/api/mock/pledges/${q1.pledgeId}/confirm`, { card: "4242424242424242" });
  await until(() => call<{ status: string }>("GET", `/api/pledges/${q1.pledgeId}`), (x) => x.status === "held", 10_000, 300);
  try {
    await call("POST", `/api/admin/campaigns/${c2.id}/expire`);
    const e = await until(() => call<Campaign>("GET", `/api/campaigns/${c2.id}`), (x) => x.status === "expired", 15_000, 500);
    const q = await call<{ status: string }>("GET", `/api/pledges/${q1.pledgeId}`);
    check("deadline missed: campaign expired, hold released", e.status === "expired" && q.status === "released", `${e.status}, pledge ${q.status}`);
  } catch (err) {
    check("deadline missed: admin expire", false, (err as Error).message.slice(0, 120));
  }
  const board = await call<Campaign[]>("GET", "/api/campaigns?sort=held");
  check("leaderboard lists the campaigns", board.some((x) => x.id === c.id) && board.some((x) => x.id === c2.id));
}

// ---- 8. Rehearsed lines are instant ----
const w3 = await call<WishDTO>("POST", "/api/wish");
await turn(w3.id, "a teapot shaped like a cat");
const w4 = await call<WishDTO>("POST", "/api/wish");
const again = await turn(w4.id, "a teapot shaped like a cat");
check("turn cache: repeated line is instant", config.brain !== "llm" || again.wall < 500, `${again.wall} ms`);

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
