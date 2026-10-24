import { useState } from "react";
import { CLOSE_SCORE, EXISTS_SCORE, type Match, type MatchesResponse, type ProductSpec } from "@wishit/shared";

const STORE: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", google_shopping: "Google Shopping", sample: "Sample listing" };
const EMOJI: Record<string, string> = { dress: "👗", top: "👚", skirt: "👗", backpack: "🎒", helmet: "⛑️", generic: "✨" };

export function MatchCard({ m, top, category, delay }: { m: Match; top: boolean; category: string; delay: number }) {
  const cls = m.score >= EXISTS_SCORE ? "hi" : m.score >= CLOSE_SCORE ? "mid" : "lo";
  return (
    <a className="match glass" href={m.url} target="_blank" rel="noreferrer" style={{ animationDelay: `${delay}ms` }}>
      {top && m.score >= EXISTS_SCORE && <span className="exists-badge">This exists</span>}
      <div className="thumb" style={m.image ? { backgroundImage: `url(${m.image})` } : undefined}>
        {!m.image && EMOJI[category]}
      </div>
      <div className="meta">
        <span className="store">{STORE[m.source] ?? m.source}</span>
        <span className="title">{m.title}</span>
        <div className="row">
          <span className={`score ${cls}`}>{m.score}</span>
          {m.price != null && <span>${m.price.toFixed(0)}</span>}
          {top && m.score >= EXISTS_SCORE && <span className="chip ok">Buy it →</span>}
        </div>
        {m.missing.length > 0 && (
          <div className="row">
            {m.missing.slice(0, 2).map((x) => (
              <span key={x} className="missing">missing: {x}</span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

/** The 2x2 grid. Ghost cards shimmer while the stores are searched (no spinners). */
export function MatchGrid({ res, category }: { res: MatchesResponse | null; category: string }) {
  if (!res || (res.pending && !res.matches.length)) {
    return (
      <div className="grid2">
        {["Amazon", "Etsy", "Google Shopping", "…and friends"].map((s, i) => (
          <div key={s} className="match ghost" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="ghost-label">Searching {s}</span>
          </div>
        ))}
      </div>
    );
  }
  const shown = res.matches.filter((m) => m.score >= CLOSE_SCORE).slice(0, 4);
  const list = shown.length ? shown : res.matches.slice(0, 4);
  return (
    <div className="grid2">
      {list.length === 0 && <div className="empty-magic glass">Nothing like it anywhere. A truly original wish ✨</div>}
      {list.map((m, i) => (
        <MatchCard key={m.url + i} m={m} top={i === 0} category={category} delay={i * 140} />
      ))}
    </div>
  );
}

export function summarize(res: MatchesResponse): { exists: boolean; line: string } {
  const top = res.matches[0];
  if (!top || top.score < CLOSE_SCORE) return { exists: false, line: "Nobody has made this yet. Shall we wish it into existence?" };
  if (top.score >= EXISTS_SCORE) return { exists: true, line: "Good news: it exists! Here it is." };
  const gap = top.missing[0];
  return { exists: false, line: `Closest match scores ${top.score}${gap ? `, but ${/^(no|doesn|not)\b/i.test(gap) ? gap : `no ${gap}`}` : ""}. Shall we wish it into existence?` };
}

const DURATIONS = [
  { label: "2 min", ms: 2 * 60_000 },
  { label: "5 min", ms: 5 * 60_000 },
  { label: "1 day", ms: 86_400_000 },
  { label: "6 days (max)", ms: 6 * 86_400_000 },
];

export function LaunchSheet({ spec, onClose, onLaunch }: {
  spec: ProductSpec;
  onClose: () => void;
  onLaunch: (b: { priceCents: number; targetBackers: number; deadlineAt: number }) => Promise<void>;
}) {
  const [price, setPrice] = useState(String(spec.target_price_usd ?? 89));
  const [target, setTarget] = useState("3");
  const [dur, setDur] = useState(DURATIONS[1].ms);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const p = Math.round(Number(price) * 100);
    const t = Math.round(Number(target));
    if (!(p >= 50) || !(t >= 1)) return setErr("Enter a price of at least $0.50 and at least 1 backer.");
    setBusy(true);
    setErr(null);
    try {
      await onLaunch({ priceCents: p, targetBackers: t, deadlineAt: Date.now() + dur });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <h2>Wish it into existence</h2>
        <div className="fineprint">
          Backers place a card hold. Nobody pays unless enough people commit before the deadline.
        </div>
        <div className="field">
          <label>Price per unit (USD)</label>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>Backers needed</label>
          <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div className="field">
          <label>Deadline</label>
          <div className="seg">
            {DURATIONS.map((d) => (
              <button key={d.label} className={dur === d.ms ? "on" : ""} onClick={() => setDur(d.ms)}>{d.label}</button>
            ))}
          </div>
        </div>
        {err && <div className="pledge-msg bad">{err}</div>}
        <button className="btn primary block" disabled={busy} onClick={submit}>
          {busy ? "Casting…" : "Launch the wish ✨"}
        </button>
      </div>
    </div>
  );
}
