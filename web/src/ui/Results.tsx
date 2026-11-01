import { useEffect, useMemo, useRef, useState } from "react";
import { CLOSE_SCORE, describeProduct, EXISTS_SCORE, type Match, type MatchesResponse, type Product } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { voterId } from "./Upvote.tsx";
import { ArrowOut, BackIcon, CategoryIcon, HeartIcon, LockIcon, MicIcon, MinusIcon, PlusIcon, SpinIcon, Sparkle } from "./Icons.tsx";

const STORE: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", google_shopping: "Google Shopping", sample: "Sample" };

const money = (p: number | null) => (p == null ? null : `$${p % 1 ? p.toFixed(2) : p.toLocaleString("en-US")}`);
/** How well a listing matches (the store search scores each listing against the design render and its photo). */
export const matchOf = (m: Match) => m.score;

export type SortKey = "best" | "price";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "best", label: "Best match + price" },
  { key: "price", label: "Lowest price" },
];

/**
 * The listings worth showing (deduped; close ones only when there are any; at most 8), ordered.
 * "best" weighs the match 70% and price 30% (cheapest in the set = full marks, unpriced = middle).
 */
export function rankMatches(res: MatchesResponse | null, sort: SortKey = "best"): Match[] {
  if (!res) return [];
  const all = dedupe([...res.matches].sort((a, b) => matchOf(b) - matchOf(a)));
  const close = all.filter((m) => m.score >= CLOSE_SCORE);
  const pool = (close.length ? close : all).slice(0, 8);
  const prices = pool.flatMap((m) => (m.price == null ? [] : [m.price]));
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const cheap = (m: Match) => (m.price == null ? 0.5 : hi > lo ? (hi - m.price) / (hi - lo) : 1);
  const value: Record<SortKey, (m: Match) => number> = {
    // A listing that IS the product leads (the headline says "It already exists!" about it).
    best: (m) => (m.score >= EXISTS_SCORE ? 1000 : 0) + matchOf(m) * 0.7 + cheap(m) * 30,
    price: (m) => (m.price == null ? -1e9 : -m.price),
  };
  return [...pool].sort((a, b) => value[sort](b) - value[sort](a) || matchOf(b) - matchOf(a));
}

/** The product photo, or the wish's category icon when the store sent none (or it fails to load). */
function Photo({ m, category, color, size }: { m: Match; category: string; color?: string; size: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="mphoto">
      {m.image && !broken ? <img src={m.image} alt="" loading="lazy" onError={() => setBroken(true)} /> : <CategoryIcon category={category} color={color} size={size} />}
    </div>
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
/** The sort, as one custom dropdown pill (at the right of "N sites searched"). */
export function SortSelect({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void; res?: MatchesResponse | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const label = SORTS.find((x) => x.key === value)?.label ?? "";
  return (
    <div ref={box} className={`sort-dd ${open ? "open" : ""}`}>
      <button className="sort-dd-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Sort matches: ${label}`} onClick={() => setOpen((o) => !o)}>
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="sort-dd-menu" role="listbox" aria-label="Sort matches">
          {SORTS.map((x) => (
            <button
              key={x.key}
              className="sort-dd-opt"
              role="option"
              aria-selected={x.key === value}
              onClick={() => {
                onChange(x.key);
                setOpen(false);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type BuyState = { step: "idle" | "confirm" | "buying" | "done" | "failed"; orderId?: string; why?: string };

/**
 * One listing as a product card: a big photo, then the store, name and price. "Purchase" has the genie
 * buy it right here (confirm the price, then a signed agent checkout); the store link opens the listing.
 */
function MatchCard({ m, category, color, i, wishId }: { m: Match; category: string; color?: string; i: number; wishId?: string }) {
  const store = STORE[m.source] ?? m.source;
  const price = money(m.price);
  const [buy, setBuy] = useState<BuyState>({ step: "idle" });
  useEffect(() => {
    if (buy.step !== "confirm") return;
    const t = setTimeout(() => setBuy({ step: "idle" }), 5000); // an unconfirmed tap times out
    return () => clearTimeout(t);
  }, [buy.step]);
  const purchase = async () => {
    if (!wishId) return;
    if (buy.step === "idle" || buy.step === "failed") return setBuy({ step: "confirm" });
    if (buy.step !== "confirm") return;
    setBuy({ step: "buying" });
    try {
      const r = await api.agentBuy(wishId, m.url, voterId());
      setBuy(r.ok ? { step: "done", orderId: r.orderId } : { step: "failed", why: r.outcome });
    } catch (err) {
      setBuy({ step: "failed", why: (err as Error).message });
    }
  };
  return (
    <div className={`mcardx ${buy.step === "done" ? "bought" : ""}`} style={{ animationDelay: `${0.05 + i * 0.06}s` }}>
      <a className="mx-link" href={m.url} target="_blank" rel="noreferrer" aria-label={`${m.title} on ${store}${price ? `, ${price}` : ""} (opens the store)`}>
        <Photo m={m} category={category} color={color} size={96} />
      </a>
      <span className="mx-body">
        <a className="mx-site" href={m.url} target="_blank" rel="noreferrer">{store} <ArrowOut size={12} /></a>
        <span className="mx-name" title={m.title}>{m.title}</span>
        {buy.step === "done" ? (
          <span className="mx-done" role="status">
            <b>Bought by your genie</b>
            <small>Test order {buy.orderId?.toUpperCase()} · {price} · verified agent checkout</small>
          </span>
        ) : (
          <span className="mx-foot">
            <span className="mx-price">{price ?? "—"}</span>
            {m.price != null && wishId && (
              <button className={`mx-buy ${buy.step}`} disabled={buy.step === "buying"} onClick={() => void purchase()}>
                {buy.step === "confirm" ? `Confirm ${price}` : buy.step === "buying" ? "Genie is buying…" : "Purchase"}
              </button>
            )}
          </span>
        )}
        {buy.step === "failed" && <span className="mx-fail" role="alert">{buy.why ?? "That didn't go through."} Tap Purchase to try again.</span>}
      </span>
    </div>
  );
}

/** The listings as product cards, best first (by the chosen sort). Skeleton cards while searching. */
export function MatchGrid({ res, category, color, sort = "best", wishId }: { res: MatchesResponse | null; category: string; color?: string; sort?: SortKey; wishId?: string }) {
  const list = useMemo(() => rankMatches(res, sort), [res, sort]);
  if (!res || (res.pending && !res.matches.length)) {
    return (
      <div className="scroll">
        <div className="mcards" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="mcardx ghost" style={{ animationDelay: `${i * 0.08}s` }}><div className="mphoto" /><span className="mx-body"><b /><b /><b className="short" /></span></div>
          ))}
        </div>
      </div>
    );
  }
  // A gap every listing shares ("cedar wood") is said once, in plain words.
  const lacking = list.filter((m) => m.missing.length);
  const shared = lacking.length > 1 ? lacking[0].missing.filter((x) => lacking.every((m) => m.missing.some((y) => y.toLowerCase() === x.toLowerCase()))) : [];
  return (
    <div className="scroll">
      {!list.length && <div className="empty-magic">Nothing like it anywhere. A truly original wish.</div>}
      {list.length > 0 && (
        <div className="mcards">
          {list.map((m, i) => <MatchCard key={m.url + i} m={m} category={category} color={color} i={i} wishId={wishId} />)}
        </div>
      )}
      {shared.length > 0 && <p className="mshared">{lacking.length === list.length ? "None of these have" : "Most of these lack"} {shared.slice(0, 2).join(" or ")}. Yours would.</p>}
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
