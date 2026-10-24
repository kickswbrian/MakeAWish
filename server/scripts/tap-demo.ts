/**
 * Live check of agent checkout (Visa Trusted Agent Protocol) against a running server:
 * the genie pledges under a mandate and the hold lands; five bad requests are refused.
 *   npm run tap:demo -- --base=http://localhost:3000
 * Payments must be in mock mode (no Stripe keys) or Stripe test mode.
 */
import type { Campaign, TapCheck, WishDTO } from "@wishit/shared";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^-+/, "").split("=") as [string, string]));
const BASE = (args.base ?? "http://localhost:3000").replace(/\/$/, "");
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}
type AgentReply = { ok: boolean; checks: TapCheck[]; outcome: string; pledgeId?: string };
const show = (r: AgentReply) => r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" · ");

const wish = (await call<WishDTO>("POST", "/api/wish")).json;
await call("POST", `/api/wish/${wish.id}/turn`, { text: "A bike helmet with built-in headphones" });
const c = (await call<Campaign>("POST", "/api/campaigns", { wishId: wish.id, priceCents: 8900, targetBackers: 3, deadlineAt: Date.now() + 10 * 60_000 })).json;
console.log(`campaign ${c.id} at $89, goal 3\n`);

const key = await fetch(`${BASE}/api/tap/keys?keyID=x`);
check("key registry answers 404 for unknown keys", key.status === 404);

const good = await call<AgentReply>("POST", `/api/campaigns/${c.id}/agent-pledge`, { email: "saif@example.com", maxCents: 9000 });
console.log(`     ${show(good.json)}`);
check("genie pledge within the mandate is accepted", good.status === 200 && good.json.ok, good.json.outcome);
await new Promise((r) => setTimeout(r, 800));
const after = (await call<Campaign>("GET", `/api/campaigns/${c.id}`)).json;
const agentPledge = after.pledges.find((p) => p.agent);
check("the hold is placed and marked as the genie's", after.held === 1 && !!agentPledge, `held ${after.held}, agent ${agentPledge?.agent?.keyid.slice(0, 12)}…`);
if (agentPledge?.agent) {
  const jwk = await call<{ kty: string; crv: string; kid: string }>("GET", `/api/tap/keys?keyID=${encodeURIComponent(agentPledge.agent.keyid)}`);
  check("key registry serves the genie's public key", jwk.status === 200 && jwk.json.crv === "Ed25519", `${jwk.json.kty}/${jwk.json.crv}`);
}

const expectBlocked: [string, string][] = [
  ["unsigned", "Signed by a trusted agent"],
  ["replay", "Nonce not replayed"],
  ["tampered", "Body untouched"],
  ["expired", "Fresh timestamps"],
  ["over_limit", "Within the shopper's mandate"],
];
for (const [kind, at] of expectBlocked) {
  const r = (await call<AgentReply>("POST", `/api/campaigns/${c.id}/agent-attack`, { kind })).json;
  const failed = r.checks.find((x) => !x.ok)?.name;
  console.log(`     ${kind}: ${show(r)}`);
  check(`${kind} request refused at "${at}"`, !r.ok && failed === at, r.outcome);
}
const end = (await call<Campaign>("GET", `/api/campaigns/${c.id}`)).json;
check("no bad request placed a hold", end.held === 1, `held ${end.held}`);

const capped = await call<AgentReply>("POST", `/api/campaigns/${c.id}/agent-pledge`, { email: "frugal@example.com", maxCents: 5000 });
check("a mandate below the price is refused", capped.status === 403 && !capped.json.ok, capped.json.outcome);

console.log(failures ? `\n${failures} check(s) failed` : "\nall agent checkout checks passed");
process.exit(failures ? 1 : 0);
