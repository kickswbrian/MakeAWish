import { Link } from "react-router-dom";
import type { Caption } from "../voice/useVoice.ts";
import { HeartIcon, Sparkle } from "./Icons.tsx";

/** The three soft background glows every screen sits on. */
export function Glows() {
  return (
    <div className="glows" aria-hidden="true">
      <div className="glow g1" />
      <div className="glow g2" />
      <div className="glow g3" />
    </div>
  );
}

export function Wordmark() {
  return (
    <Link to="/" className="wordmark" reloadDocument>
      <Sparkle size={18} color="#C5D8CF" /> Wish it
    </Link>
  );
}

/** The newest line of the conversation, revealed word by word. Live captions show as they arrive. */
export function SpeechLine({ captions, interim }: { captions: Caption[]; interim: string }) {
  if (interim) return <p className="line interim" aria-live="polite">{interim}</p>;
  const c = captions[captions.length - 1];
  if (!c || Date.now() - c.at > 15000) return null;
  const words = c.text.split(/\s+/).filter(Boolean);
  return (
    <p key={c.id} className={`line ${c.who} ${c.text.length > 90 ? "long" : ""}`} aria-live="polite">
      {words.map((w, i) => (
        <span key={i} className="w" style={{ ["--i" as string]: Math.min(i, 24) }}>{w}</span>
      ))}
    </p>
  );
}

export function Heart({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`cbtn ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on} aria-label={on ? "Remove from wishlist" : "Save to wishlist"}>
      <HeartIcon filled={on} />
    </button>
  );
}
