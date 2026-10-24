import { Link } from "react-router-dom";
import type { Caption } from "../voice/useVoice.ts";

export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="topbar">
      <Link to="/" className="logo" reloadDocument>
        <span className="star">✦</span> Wish it
      </Link>
      <div style={{ display: "flex", gap: 10 }}>{right}</div>
    </div>
  );
}

export function Captions({ captions, interim }: { captions: Caption[]; interim: string }) {
  const now = Date.now();
  const shown = captions.slice(-2);
  return (
    <div className="captions" aria-live="polite">
      {shown.map((c) => (
        <div key={c.id} className={`caption ${c.who} ${now - c.at > 7000 ? "fading" : ""}`}>
          {c.text}
        </div>
      ))}
      {interim && <div className="caption you interim">{interim}</div>}
    </div>
  );
}

export function Heart({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`icon-btn ${on ? "on" : ""}`} onClick={onClick} aria-label={on ? "Remove from wishlist" : "Save to wishlist"} title="Save to wishlist">
      {on ? "♥" : "♡"}
    </button>
  );
}
