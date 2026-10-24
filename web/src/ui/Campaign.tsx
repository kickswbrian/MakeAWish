import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { colorName, describeSpec, type Campaign } from "@wishit/shared";
import { api, getConfig, money } from "../lib/api.ts";
import { chime } from "../lib/sound.ts";
import { Bubble } from "./Bubble.tsx";
import { Sparkle } from "./Icons.tsx";

/** "X of N" with a star that flies into the bar on each new held pledge. */
export function DemandBar({ c, small }: { c: Campaign; small?: boolean }) {
  const count = c.status === "funded" || c.status === "capturing" ? Math.max(c.captured + c.held, c.captured) : c.held;
  const pct = Math.min(100, (count / Math.max(1, c.targetBackers)) * 100);
  const bar = useRef<HTMLDivElement>(null);
  const prev = useRef(count);
  const [pulse, setPulse] = useState(0);
  const [stars, setStars] = useState<{ id: number; fx: number; fy: number; tx: number; ty: number }[]>([]);

  useEffect(() => {
    if (count > prev.current && bar.current && !small) {
      const r = bar.current.getBoundingClientRect();
      const tx = r.left + (r.width * pct) / 100 - 15;
      const ty = r.top - 14;
      const id = Date.now();
      setStars((s) => [...s, { id, fx: window.innerWidth / 2, fy: window.innerHeight - 60, tx, ty }]);
      setTimeout(() => setStars((s) => s.filter((x) => x.id !== id)), 1000);
      setTimeout(() => {
        setPulse((p) => p + 1);
        chime();
      }, 800);
    }
    prev.current = count;
  }, [count, pct, small]);

  return (
    <div className="demand">
      {!small && (
        <div className="demand-head">
          <span className="demand-count">
            {count} <small>of {c.targetBackers} backers</small>
          </span>
          <span className="price-line">{c.status === "funded" ? "Funded" : `${Math.round(pct)}%`}</span>
        </div>
      )}
      <div ref={bar} key={pulse} className={`track ${small ? "" : "lg"} ${pulse ? "pulse" : ""}`}>
        <div className="fill" style={{ width: `${pct}%` }} />
        {pulse > 0 && <span className="landflash" style={{ left: `${pct}%` }} />}
      </div>
      {stars.map((s) => (
        <Sparkle
          key={s.id}
          size={30}
          color="#E9C46A"
          className="flying-star"
          style={{ ["--fx" as string]: `${s.fx}px`, ["--fy" as string]: `${s.fy}px`, ["--tx" as string]: `${s.tx}px`, ["--ty" as string]: `${s.ty}px` }}
        />
      ))}
    </div>
  );
}

export function Countdown({ to, status }: { to: number; status: Campaign["status"] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (status === "funded") return <span className="countdown">Wish granted</span>;
  if (status === "capturing") return <span className="countdown">Capturing holds…</span>;
  if (status === "expired" || status === "releasing") return <span className="countdown">Deadline passed</span>;
  const ms = Math.max(0, to - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const text = d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}:${String(sec).padStart(2, "0")} left`;
  return <span className={`countdown ${s < 60 ? "urgent" : ""}`}>{text}</span>;
}

/** Where a phone can reach this server: PUBLIC_URL if it isn't localhost, else this page's origin. */
export function usePublicOrigin() {
  const [origin, setOrigin] = useState(window.location.origin);
  useEffect(() => {
    void getConfig().then((cfg) => {
      if (cfg.publicUrl && !/localhost|127\.0\.0\.1/.test(cfg.publicUrl)) setOrigin(cfg.publicUrl.replace(/\/$/, ""));
    });
  }, []);
  return origin;
}

export function CampaignPanel({ c, snapshot }: { c: Campaign; snapshot?: string | null }) {
  const origin = usePublicOrigin();
  const url = `${origin}/c/${c.id}`;
  const params = new URLSearchParams(window.location.search);
  const admin = params.has("admin");
  const [expiring, setExpiring] = useState(false);
  const local = /localhost|127\.0\.0\.1/.test(origin);

  if (c.status === "funded") return <PurchaseOrder c={c} snapshot={snapshot} />;

  return (
    <div className="panel">
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span className={`status-pill ${c.status}`}>{c.status}</span>
          <span className="note">{c.paymentMode === "stripe" ? "Stripe test mode" : "Simulated payments"}</span>
        </div>
        <h2>{c.name}</h2>
        <div className="price-line">
          {money(c.priceCents)} each · only charged if {c.targetBackers} people commit
        </div>
      </div>
      <DemandBar c={c} />
      <Countdown to={c.deadlineAt} status={c.status} />
      {c.status === "funding" && (
        <div className="qr-box">
          <a className="qr" href={url} target="_blank" rel="noreferrer">
            <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#182825" level="M" />
          </a>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 17 }}>Scan to back this wish</div>
            <div className="short-url">{url.replace(/^https?:\/\//, "")}</div>
            {local && <div className="fineprint" style={{ marginTop: 6 }}>Set PUBLIC_URL (or open this page via your LAN IP) so phones can reach it.</div>}
          </div>
        </div>
      )}
      {(c.status === "expired" || c.status === "releasing") && (
        <div className="msg info">
          Missed the goal. {c.status === "expired" ? "Every hold was released" : "Releasing every hold"}, and nobody paid a cent.
        </div>
      )}
      {c.pledges.length > 0 && (
        <div className="pledge-list">
          {c.pledges.slice().reverse().map((p) => (
            <div key={p.id} className="pledge-row">
              <span>{p.email}</span>
              <span title={p.failReason ?? ""}>
                <span className={`status-pill ${p.status}`}>{p.status === "held" ? "hold placed" : p.status.replace("_", " ")}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {admin && c.status === "funding" && (
        <button
          className="pill ghost"
          disabled={expiring}
          onClick={() => {
            setExpiring(true);
            void api.expire(c.id, params.get("admin") || undefined).finally(() => setExpiring(false));
          }}
        >
          Force deadline now
        </button>
      )}
    </div>
  );
}

export function PurchaseOrder({ c, snapshot }: { c: Campaign; snapshot?: string | null }) {
  const s = c.spec;
  const rows: [string, React.ReactNode][] = [
    ["Product", c.name],
    ["Description", describeSpec(s)],
    ...(s.color ? [["Color", <><span className="swatch" style={{ background: s.color }} />{colorName(s.color)} {s.color}</>] as [string, React.ReactNode]] : []),
    ...(["length", "silhouette", "sleeves", "neckline", "fabric", "pattern", "size"] as const)
      .filter((k) => s[k])
      .map((k) => [k[0].toUpperCase() + k.slice(1), String(s[k]).replace("_", "-")] as [string, React.ReactNode]),
    ...(s.features?.length ? [["Features", s.features.map((f) => f.replace(/_/g, " ")).join(", ")] as [string, React.ReactNode]] : []),
    ...(s.notes ? [["Notes", s.notes] as [string, React.ReactNode]] : []),
  ];
  const captured = c.pledges.filter((p) => p.status === "captured");
  return (
    <div className="po">
      <div className="po-head">
        <div>
          <div className="po-num">PO-{c.id.toUpperCase()}</div>
          <h2>Purchase order</h2>
        </div>
        <span className="status-pill funded">funded</span>
      </div>
      {snapshot && <img className="thumb-img" src={snapshot} alt={c.name} />}
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
          <tr>
            <td>Maker</td>
            <td>
              {c.maker ? (
                <>
                  <a href={c.maker.url} target="_blank" rel="noreferrer">{c.maker.name}</a>, {c.maker.location}
                  <div className="fineprint">{c.maker.specialty}</div>
                </>
              ) : "Assigning…"}
            </td>
          </tr>
          <tr>
            <td>Guaranteed buyers</td>
            <td>{captured.length} of {c.targetBackers}</td>
          </tr>
          <tr>
            <td>Unit price</td>
            <td>{money(c.priceCents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="pledge-list">
        {c.pledges.filter((p) => p.status === "captured" || p.status === "capture_failed").map((p) => (
          <div key={p.id} className="pledge-row">
            <span>{p.email}</span>
            <span className={`status-pill ${p.status}`}>{p.status.replace("_", " ")}</span>
          </div>
        ))}
      </div>
      <div className="demand-head">
        <span className="price-line">Total captured</span>
        <span className="total">{money(captured.length * c.priceCents)}</span>
      </div>
      <div className="sim-note">
        Simulated order: the maker is a stand-in. The payments are real card holds, captured {c.paymentMode === "stripe" ? "in Stripe test mode" : "by the simulated payment provider"}.
      </div>
    </div>
  );
}

const PARTY = ["#F2D88A", "#F4A8C8", "#E9C46A", "#F9C6DC", "#C5D8CF"];
const RISING = Array.from({ length: 26 }, (_, i) => ({
  cls: i % 2 ? "rb rbA" : "rb rbB", x: 3 + ((i * 37) % 88), s: 14 + ((i * 17) % 34), t: 2500 + ((i * 290) % 1100), d: (i * 130) % 1700, c: PARTY[i % 4],
}));
const PARTY_SPARKS = [[10, 20, 16, 0, 0], [85, 17, 20, 1, 0.6], [15, 50, 13, 2, 1.2], [82, 47, 17, 3, 0.3], [49, 19, 11, 0, 1.8], [6, 36, 10, 1, 0.9], [90, 34, 11, 2, 1.5], [51, 73, 14, 3, 2.1]];

/** Full-screen "Wish granted": bubbles rise and pop into sparkles around the wish. */
export function Celebration({ onDone, image, line }: { onDone?: () => void; image?: string | null; line?: string }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current?.(), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="party" aria-live="polite">
      <div className="pscrim" />
      <div className="party-in">
        {RISING.map((b, i) => (
          <div key={i} className={b.cls} style={{ left: `${b.x}%`, width: b.s, height: b.s, animationDuration: `${b.t}ms`, animationDelay: `${b.d}ms` }}>
            <span className="rbg" style={{ animationDuration: `${b.t}ms`, animationDelay: `${b.d}ms` }} />
            <Sparkle className="rbs" color={b.c} style={{ animationDuration: `${b.t}ms`, animationDelay: `${b.d}ms` }} />
          </div>
        ))}
        {PARTY_SPARKS.map(([x, y, s, c, d], i) => (
          <Sparkle key={i} className="spk" color={PARTY[c]} style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${d}s` }} />
        ))}
        <div className="bigwrap">
          <Bubble state="speaking">{image ? <img src={image} alt="" /> : null}</Bubble>
        </div>
        <h2 className="granted-title">Wish granted</h2>
        {line && <div className="granted-sub"><span>{line}</span></div>}
      </div>
    </div>
  );
}
