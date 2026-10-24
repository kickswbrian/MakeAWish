/**
 * Trusted Agent Protocol: the genie's signer against Wish it's verifier, and every way the
 * verifier must refuse a request. npm test -w server
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wishit-tap-"));
const { agentKey, parseSignatureInput, signObject, signRequest, verifyContainer, verifyRequest } = await import("./tap.ts");

const authority = "wishit.example";
const p = "/api/agent/campaigns/abc/pledges";
const body = JSON.stringify({ email: "a@b.co", amountCents: 8900 });
const req = (headers: Record<string, string>, rawBody = body, reqPath = p, host = authority) => ({
  authority: host, path: reqPath, rawBody,
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
});
const failedAt = (r: ReturnType<typeof verifyRequest>) => r.checks.find((c) => !c.ok)?.name;

test("a request signed by the genie verifies, with every check passing", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  const r = verifyRequest(req(headers));
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.keyid, agentKey.kid);
  assert.ok(r.checks.every((c) => c.ok));
});

test("Signature-Input matches the spec's shape", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  const parsed = parseSignatureInput(headers["Signature-Input"])!;
  assert.equal(parsed.label, "sig2");
  assert.deepEqual(parsed.components, ["@authority", "@path", "content-digest"]);
  for (const k of ["created", "expires", "keyid", "alg", "nonce", "tag"]) assert.ok(parsed.params[k], k);
  assert.equal(parsed.params.alg, "Ed25519");
  assert.ok(Number(parsed.params.expires) - Number(parsed.params.created) <= 480);
});

test("unsigned requests are refused as unknown bots", () => {
  assert.equal(failedAt(verifyRequest(req({}))), "Signed by a trusted agent");
});

test("a browsing tag can't pay", () => {
  const { headers } = signRequest(authority, p, body, "agent-browser-auth");
  assert.equal(failedAt(verifyRequest(req(headers))), "Checkout tag");
});

test("replayed nonces are refused", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  assert.equal(verifyRequest(req(headers)).ok, true);
  assert.equal(failedAt(verifyRequest(req(headers))), "Nonce not replayed");
});

test("expired signatures are refused", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth", { expired: true });
  assert.equal(failedAt(verifyRequest(req(headers))), "Fresh timestamps");
});

test("a body changed after signing is refused", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  assert.equal(failedAt(verifyRequest(req(headers, body.replace("8900", "890")))), "Body untouched");
});

test("a signature replayed on another path or host is refused", () => {
  const a = signRequest(authority, p, body, "agent-payer-auth");
  assert.equal(failedAt(verifyRequest(req(a.headers, body, "/api/agent/campaigns/other/pledges"))), "Signature valid");
  const b = signRequest(authority, p, body, "agent-payer-auth");
  assert.equal(failedAt(verifyRequest(req(b.headers, body, p, "evil.example"))), "Signature valid");
});

test("a key the registry doesn't know is refused", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  headers["Signature-Input"] = headers["Signature-Input"].replace(agentKey.kid, "someone-else");
  assert.equal(failedAt(verifyRequest(req(headers))), "Agent key found");
});

test("a signature from a different private key is refused", () => {
  const { headers } = signRequest(authority, p, body, "agent-payer-auth");
  const params = headers["Signature-Input"].slice("sig2=".length);
  const base = `"@authority": ${authority}\n"@path": ${p}\n"content-digest": ${headers["Content-Digest"]}\n"@signature-params": ${params}`;
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  headers.Signature = `sig2=:${crypto.sign(null, Buffer.from(base), other).toString("base64")}:`;
  assert.equal(failedAt(verifyRequest(req(headers))), "Signature valid");
});

test("the payment container must carry the same nonce and key", () => {
  const nonce = crypto.randomBytes(32).toString("base64");
  const container = signObject({ nonce, kid: agentKey.kid, alg: "Ed25519", mandateId: "m1", campaignId: "abc", amountCents: 8900 });
  assert.equal(verifyContainer(container, nonce, agentKey.kid).ok, true);
  assert.equal(verifyContainer(container, "another-nonce", agentKey.kid).ok, false);
  assert.equal(verifyContainer({ ...container, amountCents: 100 }, nonce, agentKey.kid).ok, false);
  assert.equal(verifyContainer(null, nonce, agentKey.kid).ok, false);
});
