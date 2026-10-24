import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EVENTS, type Campaign, type CampaignUpdatedPayload, type WishDTO } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { useRoom, useSocketEvent } from "../lib/socket.ts";
import { loadWishlist, pref, setPref } from "../lib/wishlist.ts";
import { Glows } from "../ui/Chrome.tsx";
import { BagIcon, CategoryIcon, HeartIcon, PlusIcon, QrIcon, Sparkle } from "../ui/Icons.tsx";

type Row = { wish: WishDTO; campaign: Campaign | null };
const CARD_BG = ["#EEF4F1, #DCE7E2", "#FCEDF3, #F7D3E3", "#FBF3DF, #F4E1B4", "#EEF3F6, #D9E4EA"];
const cardBg = (i: number) => `radial-gradient(circle at 20% 30%, #FFFFFF 0%, ${CARD_BG[i % 4].replace(", ", " 60%, ")} 100%)`;

const label = (r: Row) => {
  const s = r.campaign?.status;
  if (!s) return r.wish.status === "locked" ? "saved" : "drafting";
  if (s === "expired" || s === "releasing") return "released";
  return s;
};
const backers = (c: Campaign) => (c.status === "funded" || c.status === "capturing" ? Math.max(c.captured + c.held, c.captured) : c.held);
const pct = (c: Campaign) => Math.min(100, (backers(c) / Math.max(1, c.targetBackers)) * 100);
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Badge({ r }: { r: Row }) {
  const l = label(r);
  if (l === "funding" && r.campaign) return <span className="badge">{backers(r.campaign)}/{r.campaign.targetBackers}</span>;
  if (l === "funded") return <span className="badge sage">Funded</span>;
  if (l === "capturing") return <span className="badge gold">Capturing</span>;
  if (l === "released") return <span className="badge faint">Released</span>;
  if (l === "saved") return <span className="badge white">Saved</span>;
  return <span className="badge white">Drafting</span>;
}

function Thumb({ spec, size = 68 }: { spec: WishDTO["spec"]; size?: number }) {
  return (
    <div className="mb" style={{ width: size, height: size }}>
      <CategoryIcon category={spec.category} color={spec.color} size={size * 0.62} />
    </div>
  );
}

/** Screen 3: my wishes, plus the "Most wished" leaderboard. */
export default function Wishlist() {
  const [tab, setTab] = useState<"mine" | "top">(pref("wishlistTab", "mine"));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [board, setBoard] = useState<Campaign[] | null>(null);
  const latest = loadWishlist()[0]?.wishId;

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
    <div className="app">
      <Glows />
      <div className="wl-head">
        <h1 className="title-l">Wishes</h1>
        <Link to="/" reloadDocument className="cbtn on" aria-label="Make a new wish"><PlusIcon /></Link>
      </div>
      <div className="wl-tabs" role="tablist" aria-label="Wish lists">
        <button className="chip" role="tab" aria-selected={tab === "mine"} onClick={() => pick("mine")}>Mine</button>
        <button className="chip" role="tab" aria-selected={tab === "top"} onClick={() => pick("top")}>Most wished</button>
      </div>

      <div className="wl-list">
        {tab === "mine" && (
          <>
            {rows && rows.length === 0 && <div className="empty-magic">No wishes yet. Every great product started as someone's “I wish…”</div>}
            {rows?.map((r, i) => {
              const name = r.wish.spec.name ?? r.campaign?.name ?? "Unnamed wish";
              const to = r.campaign ? `/campaign/${r.campaign.id}` : `/?wish=${r.wish.id}`;
              return (
                <div key={r.wish.id} className="wcard" style={{ animationDelay: `${0.05 + i * 0.08}s`, background: cardBg(i) }}>
                  <Link to={to} reloadDocument={!r.campaign} className="wcard-link" aria-label={`Open ${name}`} />
                  <Thumb spec={r.wish.spec} />
                  <div className="winfo">
                    <div className="wtop">
                      <span className="wname">{name}</span>
                      <Badge r={r} />
                    </div>
                    {r.campaign && <div className="track"><div className="fill" style={{ width: `${pct(r.campaign)}%` }} /></div>}
                  </div>
                  {r.campaign?.status === "funding" && (
                    <Link to={`/campaign/${r.campaign.id}`} className="qr" aria-label={`Share ${name} campaign QR code`}><QrIcon /></Link>
                  )}
                </div>
              );
            })}
            <Link to="/" reloadDocument className="next-wish"><Sparkle size={16} color="#E9C46A" /> Your next wish</Link>
          </>
        )}

        {tab === "top" && (
          <>
            {board && board.length === 0 && <div className="empty-magic">No live wishes yet. Be the first to launch one.</div>}
            {board?.map((c, i) => (
              <div key={c.id} className="wcard tight" style={{ animationDelay: `${0.05 + i * 0.08}s`, background: cardBg(i) }}>
                <Link to={`/campaign/${c.id}`} className="wcard-link" aria-label={`Open ${c.name}`} />
                <span className="rank">{i + 1}{i === 0 && <Sparkle className="spk" color="#E9C46A" />}</span>
                <Thumb spec={c.spec} size={56} />
                <div className="winfo" style={{ gap: 8 }}>
                  <span className="wname" style={{ fontSize: 17 }}>{c.name}</span>
                  <div className="track"><div className="fill" style={{ width: `${pct(c)}%` }} /></div>
                </div>
                <span style={{ flex: "none", fontSize: 15, fontWeight: 700 }}>{fmt(backers(c))}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <nav className="nav" aria-label="Main">
        <Link to="/wishlist" className="navi on" aria-label="My wishes" aria-current="page"><HeartIcon filled size={26} /></Link>
        <div className="nav-group">
          <Link to="/" reloadDocument className="navi" aria-label="Make a wish"><Sparkle size={24} /></Link>
          <Link to={latest ? `/?wish=${latest}` : "/"} reloadDocument className="navi" aria-label="Shop matches for your latest wish"><BagIcon /></Link>
        </div>
      </nav>
    </div>
  );
}
