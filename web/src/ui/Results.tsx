import { useMemo, useState } from "react";
import { CLOSE_SCORE, describeProduct, EXISTS_SCORE, type Match, type MatchesResponse, type Product } from "@wishit/shared";
import { ArrowOut, BackIcon, CategoryIcon, HeartIcon, LockIcon, MicIcon, MinusIcon, PlusIcon, SpinIcon, Sparkle } from "./Icons.tsx";

const STORE: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", google_shopping: "Google Shopping", sample: "Sample" };
const STORE_SHORT: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", google_shopping: "Google", sample: "Sample" };
const STORE_DOT: Record<string, string> = { amazon: "#F2A541", etsy: "#E86A33", google_shopping: "#5B8DEF", sample: "#9AA8A3" };

const money = (p: number | null) => (p == null ? null : `$${p % 1 ? p.toFixed(2) : p.toLocaleString("en-US")}`);
const tier = (score: number) => (score >= EXISTS_SCORE ? "hi" : score >= CLOSE_SCORE ? "mid" : "lo");

/** "★ 4.6 · 2.3k": only for listings with a real track record. */
function Stars({ m }: { m: Match }) {
  if (!m.rating) return null;
  const n = m.reviews ?? 0;
  const count = n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : n ? String(n) : "";
  return (
    <span className="mstars" aria-label={`Rated ${m.rating} out of 5${n ? ` from ${n.toLocaleString("en-US")} reviews` : ""}`}>
      <b aria-hidden="true">★</b>{m.rating.toFixed(1)}{count && <small> · {count}</small>}
    </span>
  );
}

/** "No cedar wood" reads better than a bare noun phrase. */
const lacks = (m: string) => (/^(no|not|doesn|lacks|missing)\b/i.test(m) ? m : `No ${m}`);

/** The product photo, or the wish's category icon when the store sent none (or it fails to load). */
function Photo({ m, category, color, size }: { m: Match; category: string; color?: string; size: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="mphoto">
      {m.image && !broken ? <img src={m.image} alt="" loading="lazy" onError={() => setBroken(true)} /> : <CategoryIcon category={category} color={color} size={size} />}
    </div>
  );
}

/** One listing: the whole card opens it in the store. */
export function MatchCard({ m, category, color, i, shared }: { m: Match; category: string; color?: string; i: number; shared?: Set<string> }) {
  const store = STORE[m.source] ?? m.source;
  const price = money(m.price);
  const gap = m.missing.find((x) => !shared?.has(x.toLowerCase()));
  return (
    <a className="mcard" href={m.url} target="_blank" rel="noreferrer" style={{ animationDelay: `${0.06 + i * 0.07}s` }} aria-label={`${m.title} on ${store}${price ? `, ${price}` : ""}, ${m.score}% match`}>
      <Photo m={m} category={category} color={color} size={72} />
      <span className={`mscore ${tier(m.score)}`}>{m.score}%<small> match</small></span>
      <div className="minfo">
        <div className="mrow">
          <span className="mstore"><i style={{ background: STORE_DOT[m.source] ?? "#9AA8A3" }} />{STORE_SHORT[m.source] ?? m.source}</span>
          {price && <span className="mprice">{price}</span>}
        </div>
        <span className="mtitle" title={m.title}>{m.title}</span>
        <Stars m={m} />
        {m.why ? <span className="mwhy">{m.why}</span> : gap && <span className="mlack" title={m.missing.map(lacks).join(", ")}>{lacks(gap)}</span>}
      </div>
    </a>
  );
}

/** The best listing, big: photo beside the verdict, with a clear way to the store. */
function TopMatch({ m, category, color }: { m: Match; category: string; color?: string }) {
  const store = STORE[m.source] ?? m.source;
  const exists = m.score >= EXISTS_SCORE;
  const price = money(m.price);
  return (
    <a className={`mtop ${exists ? "exists" : ""}`} href={m.url} target="_blank" rel="noreferrer" aria-label={`Best match: ${m.title} on ${store}${price ? `, ${price}` : ""}, ${m.score}% match`}>
      <Photo m={m} category={category} color={color} size={96} />
      <div className="minfo">
        <span className="mkicker">{exists ? <><Sparkle size={13} color="#8A6A12" /> It exists</> : "Closest match"}<span className={`mscore inline ${tier(m.score)}`}>{m.score}%</span></span>
        <span className="mtitle big" title={m.title}>{m.title}</span>
        <div className="mrow">
          <span className="mstore"><i style={{ background: STORE_DOT[m.source] ?? "#9AA8A3" }} />{STORE_SHORT[m.source] ?? store}<Stars m={m} /></span>
          {price && <span className="mprice big">{price}</span>}
        </div>
        {m.why && <span className="mwhy big">{m.why}</span>}
        {m.missing.length > 0 && (
          <div className="mlacks">{m.missing.slice(0, 3).map((x) => <span key={x} className="mlack">{lacks(x)}</span>)}</div>
        )}
        <span className="mgo">View on {STORE_SHORT[m.source] ?? store} <ArrowOut size={16} /></span>
      </div>
    </a>
  );
}

/** Stores often list the same product twice (sponsored + organic, two sellers): keep the best one. */
function dedupe(matches: Match[]): Match[] {
  const seen = new Set<string>();
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return matches.filter((m) => {
    const keys = [`t:${key(m.title)}`, ...(m.image && !m.image.startsWith("data:") ? [`i:${m.image}`] : [])];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

/** Store filter chips, the best match as a hero, the rest in a 2-column grid. Skeletons while searching. */
export function MatchGrid({ res, category, color }: { res: MatchesResponse | null; category: string; color?: string }) {
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => {
    if (!res) return [];
    const all = dedupe([...res.matches].sort((a, b) => b.score - a.score));
    const close = all.filter((m) => m.score >= CLOSE_SCORE);
    return (close.length ? close : all).slice(0, 8);
  }, [res]);
  const stores = useMemo(() => [...new Set(list.map((m) => m.source))], [list]);
  const shown = filter === "all" ? list : list.filter((m) => m.source === filter);

  if (!res || (res.pending && !res.matches.length)) {
    return (
      <div className="scroll">
        <div className="msearch" role="status"><span className="mpulse" aria-hidden="true" />Searching Amazon and Google Shopping…</div>
        <div className="mtop ghost" aria-hidden="true"><div className="mphoto" /><div className="minfo"><b /><b /><b className="short" /></div></div>
        <div className="mgrid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mcard ghost" style={{ animationDelay: `${i * 0.08}s` }}><div className="mphoto" /><div className="minfo"><b /><b className="short" /></div></div>
          ))}
        </div>
      </div>
    );
  }
  const [top, ...rest] = shown;
  // A gap every lacking listing shares ("cedar wood") is said once, not on every card.
  const lacking = shown.filter((m) => m.missing.length);
  const shared = new Set(
    lacking.length > 1 ? lacking[0].missing.map((x) => x.toLowerCase()).filter((x) => lacking.every((m) => m.missing.some((y) => y.toLowerCase() === x))) : [],
  );
  return (
    <>
      {stores.length > 1 && (
        <div className="chips" role="tablist" aria-label="Filter by store">
          {["all", ...stores].map((s) => (
            <button key={s} className="chip" role="tab" aria-selected={filter === s} onClick={() => setFilter(s)}>
              {s === "all" ? `All ${list.length}` : `${STORE_SHORT[s] ?? s} ${list.filter((m) => m.source === s).length}`}
            </button>
          ))}
        </div>
      )}
      <div className="scroll">
        {!top && <div className="empty-magic">Nothing like it anywhere. A truly original wish.</div>}
        {top && <TopMatch key={top.url} m={{ ...top, missing: top.missing.filter((x) => !shared.has(x.toLowerCase())) }} category={category} color={color} />}
        {shared.size > 0 && <p className="mshared">{lacking.length === shown.length ? "None of these have" : "Most of these lack"} <b>{[...shared].slice(0, 2).join(" or ")}</b>. Yours would.</p>}
        {rest.length > 0 && (
          <div className="mgrid">
            {rest.map((m, i) => <MatchCard key={m.url + i} m={m} category={category} color={color} i={i} shared={shared} />)}
          </div>
        )}
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
