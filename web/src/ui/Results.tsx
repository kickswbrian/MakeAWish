import { useMemo, useState } from "react";
import { CLOSE_SCORE, describeProduct, EXISTS_SCORE, type Match, type MatchesResponse, type Product } from "@wishit/shared";
import { ArrowOut, BackIcon, CategoryIcon, HeartIcon, LockIcon, MicIcon, MinusIcon, PlusIcon, SpinIcon, Sparkle } from "./Icons.tsx";

const STORE: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", google_shopping: "Google", sample: "Sample" };
const CARD_BG = ["var(--card-sage)", "var(--card-pink)", "var(--card-gold)", "var(--card-sky)"];

export function MatchCard({ m, top, category, color, i }: { m: Match; top: boolean; category: string; color?: string; i: number }) {
  const store = STORE[m.source] ?? m.source;
  const exists = top && m.score >= EXISTS_SCORE;
  return (
    <div className="pcard" style={{ animationDelay: `${0.05 + i * 0.1}s` }}>
      <div className="pbody" style={{ background: CARD_BG[i % 4] }}>
        <span className="pprice">{m.price != null ? `$${m.price % 1 ? m.price.toFixed(2) : m.price}` : "—"}</span>
        <span className="pstore">{store}</span>
        <span className="ptitle">{m.title}</span>
        {m.missing[0] && <span className="miss" style={{ marginTop: 4 }} title={m.missing.join(", ")}>{m.missing[0]}</span>}
      </div>
      <span className={`pbadge ${exists ? "exists" : ""}`}>{exists ? "It exists" : `${m.score}%`}</span>
      <div className="pimg" style={{ animationDelay: `${-i * 1.2}s` }}>
        {m.image ? <img src={m.image} alt="" loading="lazy" /> : <CategoryIcon category={category} color={color} size={96} />}
      </div>
      <a className="pbtn" href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${m.title} on ${store}`}>
        <ArrowOut />
      </a>
    </div>
  );
}

/** Store filter chips over a 2-column grid. Ghost cards shimmer while the stores are searched. */
export function MatchGrid({ res, category, color }: { res: MatchesResponse | null; category: string; color?: string }) {
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => {
    if (!res) return [];
    const close = res.matches.filter((m) => m.score >= CLOSE_SCORE);
    return (close.length ? close : res.matches).slice(0, 8);
  }, [res]);
  const stores = useMemo(() => [...new Set(list.map((m) => m.source))], [list]);
  const shown = filter === "all" ? list : list.filter((m) => m.source === filter);

  if (!res || (res.pending && !res.matches.length)) {
    return (
      <>
        <div className="chips" role="tablist" aria-label="Filter by store">
          <button className="chip on" role="tab" aria-selected="true">All</button>
        </div>
        <div className="scroll">
          <div className="pgrid">
            {["Amazon", "Etsy", "Google", "more stores"].map((s, i) => (
              <div key={s} className="pcard ghost" style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="pbody"><span className="ghost-label">Searching {s}</span></div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {stores.length > 1 && (
        <div className="chips" role="tablist" aria-label="Filter by store">
          {["all", ...stores].map((s) => (
            <button key={s} className="chip" role="tab" aria-selected={filter === s} onClick={() => setFilter(s)}>
              {s === "all" ? "All" : STORE[s] ?? s}
            </button>
          ))}
        </div>
      )}
      <div className="scroll">
        <div className="pgrid">
          {shown.length === 0 && <div className="empty-magic">Nothing like it anywhere. A truly original wish.</div>}
          {shown.map((m, i) => (
            <MatchCard key={m.url + i} m={m} top={list[0] === m} category={category} color={color} i={i} />
          ))}
        </div>
      </div>
    </>
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
  { label: "6 days", ms: 6 * 86_400_000 },
];

/**
 * The launch sheet: slides up over the matches while the bubble (owned by the studio) floats above it.
 * Price, backers and deadline, then one pledge-style button.
 */
export function LaunchSheet({ product, saved, onSave, onClose, onTalk, onLaunch }: {
  product: Product;
  saved: boolean;
  onSave: () => void;
  onClose: () => void;
  onTalk: () => void;
  onLaunch: (b: { priceCents: number; targetBackers: number; deadlineAt: number }) => Promise<void>;
}) {
  const [price, setPrice] = useState(String(Math.round(product.targetPriceUsd ?? 89)));
  const [target, setTarget] = useState(3);
  const [dur, setDur] = useState(DURATIONS[1].ms);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const p = Math.round(Number(price) * 100);
    if (!(p >= 50)) return setErr("Enter a price of at least $0.50.");
    setBusy(true);
    setErr(null);
    try {
      await onLaunch({ priceCents: p, targetBackers: target, deadlineAt: Date.now() + dur });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="detail" role="dialog" aria-label="Wish it into existence">
      <div className="glows" aria-hidden="true">
        <div className="glow" style={{ left: -80, top: 160, width: 300, height: 300, background: "rgba(197,216,207,.2)" }} />
        <div className="glow" style={{ right: -90, top: 260, width: 240, height: 240, background: "rgba(249,198,220,.28)" }} />
      </div>
      <header className="hdr">
        <button className="cbtn" aria-label="Close" onClick={onClose}><BackIcon /></button>
        <button className={`cbtn ${saved ? "on" : ""}`} aria-pressed={saved} aria-label={saved ? "Remove from wishlist" : "Save to wishlist"} onClick={onSave}>
          <HeartIcon filled={saved} />
        </button>
      </header>
      <div className="orbit" />
      <span className="cbtn spin-hint" aria-hidden="true"><SpinIcon /></span>
      <div className="dcard">
        <button className="cbtn dark" aria-label="Keep talking to the genie" onClick={onTalk}><MicIcon size={17} /></button>
        <div>
          <h2 className="title-m">{product.title || "Your wish"}</h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 17, lineHeight: "24px" }}>{describeProduct(product)}</p>
        </div>
        <div className="drow">
          <label className="price-in">
            <span aria-hidden="true">$</span>
            <span className="sr-only">Price per unit in dollars</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <div className="stepper" role="group" aria-label="Backers needed">
            <button className="step" aria-label="Fewer backers" onClick={() => setTarget((t) => Math.max(1, t - 1))}><MinusIcon /></button>
            <output aria-live="polite" style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              {target}
              <span className="label" style={{ fontSize: 11, marginTop: 3 }}>{target === 1 ? "backer" : "backers"}</span>
            </output>
            <button className="step" aria-label="More backers" onClick={() => setTarget((t) => Math.min(50, t + 1))}><PlusIcon size={18} /></button>
          </div>
        </div>
        <div className="field">
          <span className="label">Deadline</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DURATIONS.map((d) => (
              <button key={d.label} className={`chip sm ${dur === d.ms ? "on" : ""}`} aria-pressed={dur === d.ms} onClick={() => setDur(d.ms)}>{d.label}</button>
            ))}
          </div>
        </div>
        <p className="lock-line"><LockIcon /> Card holds. Nobody pays unless {target} {target === 1 ? "person commits" : "people commit"}.</p>
        {err && <div className="msg bad">{err}</div>}
        <button className="pill dark" disabled={busy} onClick={submit}>
          {busy ? "Casting…" : <><Sparkle size={18} color="#F2D88A" /> Launch the wish</>}
        </button>
      </div>
    </div>
  );
}
