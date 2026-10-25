import { useEffect, useState } from "react";
import type { OrderDTO } from "@wishit/shared";
import { api, money } from "../lib/api.ts";
import { voterId } from "./Upvote.tsx";

const STAGES = ["Ordered", "Shipped", "Out for delivery", "Delivered"];
const STORE: Record<string, string> = { amazon: "Amazon", google_shopping: "Google Shopping", etsy: "Etsy", sample: "Sample" };
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Everything your genie bought for you (this browser), with tracking. Test orders: simulated tracking. */
export function Purchases({ onClose }: { onClose: () => void }) {
  const [orders, setOrders] = useState<OrderDTO[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => void api.orders(voterId()).then((o) => !cancelled && setOrders(o)).catch(() => !cancelled && setOrders([]));
    load();
    const t = setInterval(load, 15_000); // tracking moves on while the panel is open
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div className="pur-pop" role="dialog" aria-label="Your purchases" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pur-panel">
        <button className="world-close" aria-label="Close" onClick={onClose}>×</button>
        <h2>Your purchases</h2>
        <p className="pur-sub">Everything your genie bought for you.</p>
        <div className="pur-card" aria-label="Payment method">
          <span className="pur-visa">VISA</span>
          <span><b>Visa •••• 4242</b><small>Your genie pays with this card using Visa's Trusted Agent Protocol. Test card: demo orders, simulated tracking.</small></span>
        </div>
        {orders && !orders.length && <p className="pur-empty">Nothing yet. Tap Purchase on a match and your genie buys it for you.</p>}
        <div className="pur-list">
          {orders?.map((o) => (
            <div key={o.id} className="pur-item">
              <a className="pur-photo" href={o.url} target="_blank" rel="noreferrer" aria-label={`${o.title} (opens the store)`}>
                {o.image ? <img src={o.image} alt="" /> : null}
              </a>
              <div className="pur-body">
                <div className="pur-top">
                  <span className="pur-name" title={o.title}>{o.title}</span>
                  <b className="pur-price">{money(o.amountCents)}</b>
                </div>
                <span className="pur-meta">{STORE[o.source] ?? o.source} · Order {o.id.toUpperCase()} · {when(o.createdAt)}</span>
                <div className="pur-track" aria-label={`${STAGES[o.stage]}`}>
                  {STAGES.map((s, i) => (
                    <span key={s} className={`pur-step ${i <= o.stage ? "done" : ""} ${i === o.stage ? "now" : ""}`}>
                      <i />
                      <small>{s}</small>
                      {i <= o.stage && <em>{when(o.stageAt[i])}</em>}
                    </span>
                  ))}
                </div>
                <span className="pur-tracking">{o.carrier} · {o.trackingNumber}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
