import crypto, { type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.ts";

/**
 * Visa Trusted Agent Protocol (TAP), both sides, from the published spec
 * (developer.visa.com/docs/trusted-agent-protocol): the genie signs its checkout requests as an
 * agent, and Wish it verifies them as the merchant before placing a card hold.
 *
 * Message signature: RFC 9421 HTTP Message Signatures, Ed25519, tag "agent-payer-auth", over
 * @authority, @path and content-digest (RFC 9530, so the amount in the body is covered too).
 * Payment container: the body's agenticPaymentContainer is signed with the same key and carries
 * the same nonce, so it can't be lifted into another request.
 *
 * Honest scope: in production the agent's public key lives in Visa's key directory for approved
 * agents. Here the genie's key is served by Wish it's own registry (GET /api/tap/keys), because
 * Visa onboarding isn't available to hackathon teams. The verification logic is the same.
 */

export const TAP_TAGS = ["agent-browser-auth", "agent-payer-auth"] as const;
export const WINDOW_S = 8 * 60;

// ---------- Keys: the genie's signing key and the registry merchants read ----------

export interface Jwk { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; use: "sig"; alg: "Ed25519" }
interface AgentKey { kid: string; privateKey: KeyObject; jwk: Jwk }

const KEY_FILE = path.join(DATA_DIR, "tap-agent-key.json");

function loadAgentKey(): AgentKey {
  let pkcs8: string;
  try {
    pkcs8 = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).pkcs8;
  } catch {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify({ pkcs8 }), { mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey(pkcs8);
  const pub = crypto.createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  // RFC 7638 thumbprint as the key id, as in the spec's examples.
  const kid = crypto.createHash("sha256").update(JSON.stringify({ crv: "Ed25519", kty: "OKP", x: pub.x })).digest("base64url");
  return { kid, privateKey, jwk: { kty: "OKP", crv: "Ed25519", x: pub.x, kid, use: "sig", alg: "Ed25519" } };
}

export const agentKey = loadAgentKey();

/** The key registry (in production: Visa's well-known key directory). */
export function lookupKey(kid: string): Jwk | null {
  return kid === agentKey.kid ? agentKey.jwk : null;
}

// ---------- Agent side: signing ----------

const digestOf = (body: string | Buffer) => `sha-256=:${crypto.createHash("sha256").update(body).digest("base64")}:`;

function signatureBase(authority: string, reqPath: string, contentDigest: string | null, components: string[], params: string): string {
  const lines: string[] = [];
  for (const c of components) {
    if (c === "@authority") lines.push(`"@authority": ${authority}`);
    else if (c === "@path") lines.push(`"@path": ${reqPath}`);
    else if (c === "content-digest") lines.push(`"content-digest": ${contentDigest ?? ""}`);
  }
  lines.push(`"@signature-params": ${params}`);
  return lines.join("\n");
}

/** Canonical form of a signed body object: its fields in order, without the signature. */
export const objectBase = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "signature")));

export interface SignOptions {
  /** For the rejection demo: sign with created/expires already in the past. */
  expired?: boolean;
  nonce?: string;
}

/** Sign an outgoing agent request. Returns the headers to send and the nonce used. */
export function signRequest(authority: string, reqPath: string, body: string, tag: (typeof TAP_TAGS)[number], opts: SignOptions = {}) {
  const now = Math.floor(Date.now() / 1000) - (opts.expired ? 600 : 0);
  const nonce = opts.nonce ?? crypto.randomBytes(32).toString("base64");
  const contentDigest = digestOf(body);
  const components = ["@authority", "@path", "content-digest"];
  const params = `(${components.map((c) => `"${c}"`).join(" ")});created=${now};expires=${now + 300};keyid="${agentKey.kid}";alg="Ed25519";nonce="${nonce}";tag="${tag}"`;
  const base = signatureBase(authority, reqPath, contentDigest, components, params);
  const sig = crypto.sign(null, Buffer.from(base), agentKey.privateKey).toString("base64");
  return {
    nonce,
    headers: { "Signature-Input": `sig2=${params}`, Signature: `sig2=:${sig}:`, "Content-Digest": contentDigest },
  };
}

/** Sign a body object (the agentic payment container) with the agent key, keeping field order. */
export function signObject<T extends Record<string, unknown>>(o: T): T & { signature: string } {
  return { ...o, signature: crypto.sign(null, Buffer.from(objectBase(o)), agentKey.privateKey).toString("base64") };
}

// ---------- Merchant side: verification ----------

export interface TapCheck { name: string; ok: boolean; detail: string }
export interface TapResult { ok: boolean; checks: TapCheck[]; keyid?: string; nonce?: string; tag?: string }

/**
 * Nonces used by verified requests, each kept until its signature expires (spec: block a repeated
 * nonce within the 8-minute window). Only verified requests are recorded, so junk can't fill it.
 */
const seen = new Map<string, number>();
const MAX_NONCES = 20_000;
const nonceSeen = (nonce: string) => {
  const now = Date.now();
  for (const [n, until] of seen) if (until < now) seen.delete(n);
  return seen.has(nonce);
};
function recordNonce(nonce: string, expiresS: number) {
  if (seen.size >= MAX_NONCES) seen.delete(seen.keys().next().value!);
  seen.set(nonce, Math.max(expiresS * 1000, Date.now()) + 5_000);
}

interface Parsed { label: string; components: string[]; params: Record<string, string>; raw: string }

/** Parse `sig2=("@authority" "@path");created=..;keyid="..";...` (spaces after ; tolerated). */
export function parseSignatureInput(header: string): Parsed | null {
  const m = /^\s*([a-zA-Z0-9_-]+)=(\(([^)]*)\)(.*))$/s.exec(header);
  if (!m) return null;
  const components = [...m[3].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const params: Record<string, string> = {};
  for (const part of m[4].split(";")) {
    const kv = /^\s*([a-zA-Z]+)\s*=\s*"?([^"]*)"?\s*$/.exec(part);
    if (kv) params[kv[1].toLowerCase()] = kv[2];
  }
  return { label: m[1], components, params, raw: m[2].trim() };
}

/**
 * Verify a TAP message signature the way the spec tells a merchant to: tag present, required
 * fields, timestamps within 8 minutes, nonce not replayed, key from the registry, body digest,
 * signature over the reconstructed base. Every step is reported, for the live trust log.
 */
export function verifyRequest(req: { authority: string; path: string; headers: Record<string, string | string[] | undefined>; rawBody: string | Buffer }): TapResult {
  const checks: TapCheck[] = [];
  const fail = (name: string, detail: string): TapResult => ({ ok: false, checks: [...checks, { name, ok: false, detail }] });
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
  const h = (k: string) => {
    const v = req.headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };

  const input = h("signature-input");
  const parsed = input ? parseSignatureInput(input) : null;
  if (!parsed || !TAP_TAGS.includes(parsed.params.tag as never)) return fail("Signed by a trusted agent", "No TAP message signature (no agent-browser-auth / agent-payer-auth tag): treated as an unknown bot.");
  const { params } = parsed;
  const keyid = params.keyid;
  if (params.tag !== "agent-payer-auth") return fail("Checkout tag", `Tag ${params.tag} can browse, not pay.`);
  pass("Signed by a trusted agent", `tag=${params.tag}`);

  const missing = ["created", "expires", "keyid", "alg", "nonce", "tag"].filter((k) => !params[k]);
  if (missing.length) return fail("Required fields", `Missing ${missing.join(", ")}`);
  // A payment must also sign the body's digest, so the amount can't change.
  if (!["@authority", "@path", "content-digest"].every((c) => parsed.components.includes(c))) return fail("Required fields", "A checkout signature must cover @authority, @path and content-digest");
  if (params.nonce.length > 256) return fail("Required fields", "Nonce too long");
  pass("Required fields", `covers ${parsed.components.join(", ")}`);

  const now = Math.floor(Date.now() / 1000);
  const created = Number(params.created), expires = Number(params.expires);
  if (!(created <= now + 5) || !(expires > now) || expires - created > WINDOW_S) {
    return fail("Fresh timestamps", `created ${created}, expires ${expires}, now ${now}: must be in the past/future and at most 8 minutes apart`);
  }
  pass("Fresh timestamps", `expires in ${expires - now}s`);

  if (nonceSeen(params.nonce)) return fail("Nonce not replayed", "This nonce was already used in the last 8 minutes: replay blocked.");
  pass("Nonce not replayed", `${params.nonce.slice(0, 12)}…`);

  const jwk = lookupKey(keyid);
  if (!jwk) return fail("Agent key found", `Unknown keyid ${keyid.slice(0, 12)}…`);
  if (params.alg !== "Ed25519") return fail("Agent key found", `Unsupported alg ${params.alg}`);
  pass("Agent key found", `keyid ${keyid.slice(0, 12)}… (Ed25519)`);

  const digest = h("content-digest");
  if (parsed.components.includes("content-digest")) {
    if (!digest || digest !== digestOf(req.rawBody)) return fail("Body untouched", "Content-Digest doesn't match the body: it was changed after signing.");
    pass("Body untouched", "content-digest matches");
  }

  const sigHeader = h("signature") ?? "";
  const sig = new RegExp(`${parsed.label}=:([A-Za-z0-9+/=]+):`).exec(sigHeader)?.[1];
  if (!sig) return fail("Signature valid", "No signature for this label");
  const base = signatureBase(req.authority, req.path, digest ?? null, parsed.components, parsed.raw);
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  if (!crypto.verify(null, Buffer.from(base), key, Buffer.from(sig, "base64"))) return fail("Signature valid", "Ed25519 signature doesn't match the request.");
  pass("Signature valid", "Ed25519 over @authority, @path, content-digest");
  recordNonce(params.nonce, expires);
  return { ok: true, checks, keyid, nonce: params.nonce, tag: params.tag };
}

/** Verify the agentic payment container: same key, same nonce as the message signature. */
export function verifyContainer(container: unknown, nonce: string, keyid: string): TapCheck {
  const c = container as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return { name: "Payment container", ok: false, detail: "No agenticPaymentContainer in the body" };
  const missing = ["nonce", "kid", "alg", "signature"].filter((k) => typeof c[k] !== "string");
  if (missing.length) return { name: "Payment container", ok: false, detail: `Missing ${missing.join(", ")}` };
  if (c.nonce !== nonce) return { name: "Payment container", ok: false, detail: "Container nonce doesn't match the message signature" };
  if (c.kid !== keyid) return { name: "Payment container", ok: false, detail: "Container signed by a different key" };
  const jwk = lookupKey(keyid);
  const ok = !!jwk && crypto.verify(null, Buffer.from(objectBase(c)), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(String(c.signature), "base64"));
  return ok
    ? { name: "Payment container", ok: true, detail: "signed by the same agent, same nonce" }
    : { name: "Payment container", ok: false, detail: "Container signature doesn't verify" };
}
