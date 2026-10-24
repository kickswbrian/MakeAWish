import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EVENTS, type Campaign, type CampaignUpdatedPayload, type WishDTO } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { useRoom, useSocketEvent } from "../lib/socket.ts";
import { loadWishlist, pref, setPref } from "../lib/wishlist.ts";
import { TopBar } from "../ui/Chrome.tsx";
import { DemandBar } from "../ui/Campaign.tsx";

const EMOJI: Record<string, string> = { dress: "👗", top: "👚", skirt: "👗", backpack: "🎒", helmet: "⛑️", generic: "✨" };
type Row = { wish: WishDTO; campaign: Campaign | null };

const label = (r: Row) => {
  const s = r.campaign?.status;
  if (!s) return r.wish.status === "locked" ? "saved" : "drafting";
  if (s === "expired" || s === "releasing") return "released";
  return s;
};

function Thumb({ color, category }: { color?: string; category: string }) {
  const c = color ?? "#b9a3f0";
  return (
    <div className="wthumb" style={{ background: `radial-gradient(circle at 35% 30%, ${c}ee, ${c}66 60%, ${c}22)` }}>
      {EMOJI[category] ?? "✨"}
    </div>
  );
}

/** Screen 3: my wishes, plus the "Most wished" leaderboard. */
export default function Wishlist() {
  const [tab, setTab] = useState<"mine" | "top">(pref("wishlistTab", "mine"));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [board, setBoard] = useState<Campaign[] | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = loadWishlist();
      const loaded = await Promise.all(
        saved.map(async (s) => {
          const wish = await api.getWish(s.wishId).catch(() => null);
          if (!wish) return null;
          const campaign = wish.campaignId ? await api.campaign(wish.campaignId).catch(() => null) : null;
          return { wish, campaign };
        }),
      );
      setRows(loaded.filter((r): r is Row => !!r));
    })();
    void api.campaigns("held").then(setBoard).catch(() => setBoard([]));
  }, []);

  useRoom("board");
  useSocketEvent<CampaignUpdatedPayload>(EVENTS.campaignUpdated, ({ campaign }) => {
    setRows((rs) => rs?.map((r) => (r.campaign?.id === campaign.id || r.wish.id === campaign.wishId ? { ...r, campaign } : r)) ?? rs);
    setBoard((b) => {
      if (!b) return b;
      const next = b.some((x) => x.id === campaign.id) ? b.map((x) => (x.id === campaign.id ? campaign : x)) : [campaign, ...b];
      return next.sort((x, y) => y.held + y.captured - (x.held + x.captured));
    });
  });

  const pick = (t: "mine" | "top") => {
    setTab(t);
    setPref("wishlistTab", t);
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopBar right={<Link to="/" className="icon-btn" aria-label="New wish">＋</Link>} />
      <div className="wishlist">
        <div className="tabs">
          <button className={tab === "mine" ? "on" : ""} onClick={() => pick("mine")}>My wishes</button>
          <button className={tab === "top" ? "on" : ""} onClick={() => pick("top")}>Most wished</button>
        </div>

        {tab === "mine" && (
          <>
            {rows && rows.length === 0 && (
              <div className="empty-magic glass">No wishes yet. Every great product started as someone's “I wish…”</div>
            )}
            {rows?.map((r) => (
              <Link
                key={r.wish.id}
                to={r.campaign ? `/campaign/${r.campaign.id}` : `/?wish=${r.wish.id}`}
                reloadDocument={!r.campaign}
                className="wish-row glass"
              >
                <Thumb color={r.wish.spec.color} category={r.wish.spec.category} />
                <div className="winfo">
                  <span className="wname">{r.wish.spec.name ?? r.campaign?.name ?? "Unnamed wish"}</span>
                  <div><span className={`status-pill ${label(r)}`}>{label(r)}</span></div>
                  {r.campaign && <DemandBar c={r.campaign} small />}
                </div>
                {r.campaign && <span className="price-line">{r.campaign.held + r.campaign.captured}/{r.campaign.targetBackers}</span>}
              </Link>
            ))}
            <Link to="/" reloadDocument className="next-wish">Your next wish ✦</Link>
          </>
        )}

        {tab === "top" && (
          <>
            {board && board.length === 0 && <div className="empty-magic glass">No live wishes yet. Be the first to launch one ✨</div>}
            {board?.map((c, i) => (
              <Link key={c.id} to={`/campaign/${c.id}`} className="wish-row glass">
                <span className="rank">{i + 1}</span>
                <Thumb color={c.spec.color} category={c.spec.category} />
                <div className="winfo">
                  <span className="wname">{c.name}</span>
                  <DemandBar c={c} small />
                </div>
                <span className="price-line">{c.held + c.captured} ★</span>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
