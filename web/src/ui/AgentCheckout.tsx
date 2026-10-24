import { useState } from "react";
import { EVENTS, type Campaign, type TapCheck, type TapLogEntry, type TapLogPayload } from "@wishit/shared";
import { money } from "../lib/api.ts";
import { useSocketEvent } from "../lib/socket.ts";
import { Sparkle } from "./Icons.tsx";

/**
 * "Genie, back it for me": the genie pledges as a Visa Trusted Agent Protocol agent, within a
 * spending limit the shopper sets, and Wish it verifies the signed request before placing the hold.
 * The trust log shows every check, live, including the bad requests the merchant refuses.
 */

const ATTACKS: { kind: TapLogEntry["kind"]; label: string }[] = [
  { kind: "unsigned", label: "Unsigned bot" },
  { kind: "replay", label: "Replayed request" },
  { kind: "tampered", label: "Amount edited in flight" },
  { kind: "expired", label: "Expired signature" },
  { kind: "over_limit", label: "Over the shopper's limit" },
];
const KIND_LABEL: Record<TapLogEntry["kind"], string> = {
  pledge: "Genie pledge", unsigned: "Unsigned bot", replay: "Replayed request", tampered: "Amount edited in flight",
  expired: "Expired signature", over_limit: "Over the limit",
};

async function post<T>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

export function AgentCheckout({ c }: { c: Campaign }) {
  const [email, setEmail] = useState("");
  const [limit, setLimit] = useState(String(Math.ceil(c.priceCents / 100)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<TapLogEntry[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useSocketEvent<TapLogPayload>(EVENTS.tapLog, (p) => {
    if (p.campaignId !== c.id) return;
    setLog((l) => [p.entry, ...l].slice(0, 8));
    setOpen(p.entry.at);
  });

  const backIt = async () => {
    setError(null);
    setBusy("pledge");
    const r = await post<{ ok?: boolean; outcome?: string; error?: { message?: string } }>(`/api/campaigns/${c.id}/agent-pledge`, {
      email, maxCents: Math.round(Number(limit) * 100),
    });
    if (r.status >= 400 && r.status !== 403) setError(r.json.error?.message ?? "Couldn't reach the genie.");
    setBusy(null);
  };
  const attack = async (kind: string) => {
    setError(null);
    setBusy(kind);
    const r = await post<{ error?: { message?: string } }>(`/api/campaigns/${c.id}/agent-attack`, { kind });
    if (r.status >= 400) setError(r.json.error?.message ?? "That demo request didn't go through.");
    setBusy(null);
  };

  return (
    <div className="agent-box">
      <div className="agent-head">
        <Sparkle size={16} color="#E9C46A" />
        <span>Agent checkout</span>
        <span className="note">Visa Trusted Agent Protocol</span>
      </div>
      {c.status === "funding" && (
        <form
          className="agent-form"
          onSubmit={(e) => {
            e.preventDefault();
            void backIt();
          }}
        >
          <input type="email" required placeholder="you@email.com" aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="agent-limit">
            up to $
            <input inputMode="decimal" aria-label="Spending limit in dollars" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <button className="pill" type="submit" disabled={!!busy}>
            {busy === "pledge" ? "Genie is signing…" : "Genie, back it for me"}
          </button>
        </form>
      )}
      {error && <div className="msg bad">{error}</div>}
      <div className="fineprint">
        The genie signs its checkout request (RFC 9421, Ed25519) and Wish it verifies it as the merchant before placing a {money(c.priceCents)} hold on a test card.
        Your limit works like a Visa Intelligent Commerce payment instruction, checked by Wish it. Production agents are registered with Visa; this demo agent's key is in Wish it's own registry.
      </div>
      <div className="agent-attacks">
        <span className="fineprint">Try to fool the merchant:</span>
        {ATTACKS.map((a) => (
          <button key={a.kind} className="chip" disabled={!!busy} onClick={() => void attack(a.kind)}>
            {busy === a.kind ? "…" : a.label}
          </button>
        ))}
      </div>
      {log.length > 0 && (
        <ol className="trust-log" aria-live="polite">
          {log.map((e) => (
            <li key={e.at} className={e.ok ? "ok" : "bad"}>
              <button className="trust-row" onClick={() => setOpen(open === e.at ? null : e.at)}>
                <span className={`status-pill ${e.ok ? "held" : "failed"}`}>{e.ok ? "accepted" : "blocked"}</span>
                <strong>{KIND_LABEL[e.kind]}</strong>
                <span className="trust-outcome">{e.outcome}</span>
              </button>
              {open === e.at && <Checks checks={e.checks} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Checks({ checks }: { checks: TapCheck[] }) {
  return (
    <ul className="trust-checks">
      {checks.map((k) => (
        <li key={k.name} className={k.ok ? "ok" : "bad"}>
          <span aria-hidden="true">{k.ok ? "✓" : "✗"}</span> <b>{k.name}</b> <span>{k.detail}</span>
        </li>
      ))}
    </ul>
  );
}
