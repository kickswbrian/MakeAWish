import { Link } from "react-router-dom";
import { Glows } from "../ui/Chrome.tsx";
import { Sparkle } from "../ui/Icons.tsx";

/** Where to next: a new wish, or the Wish World. */
export default function Wishlist() {
  // Keep ?ui= (and similar) so the next screen opens in the same UI.
  const q = new URLSearchParams(window.location.search);
  q.delete("wish");
  q.delete("intro");
  const qs = q.toString() ? `?${q}` : "";
  return (
    <div className="app wl-choose">
      <Glows />
      <h1 className="wl-choose-title">Where to next?</h1>
      <div className="wl-choices">
        <Link to={`/${qs}`} reloadDocument className="wl-choice next">
          <span className="wl-orb" aria-hidden="true"><Sparkle size={44} color="#E9C46A" /></span>
          <span className="wl-choice-name">Your next wish</span>
          <span className="wl-choice-sub">Say what you wish existed and watch it take shape.</span>
        </Link>
        <Link to={`/world${qs}`} className="wl-choice wl-world">
          <span className="wl-orb wl-world" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <span className="wl-choice-name">Wish World</span>
          <span className="wl-choice-sub">Float through wishes nobody has made yet, vote and remix.</span>
        </Link>
      </div>
    </div>
  );
}
