import { Link } from "react-router-dom";
import { Glows } from "../ui/Chrome.tsx";
import { BackIcon } from "../ui/Icons.tsx";
import { WishWorld } from "../ui/WishWorld.tsx";
import { remixWish } from "../lib/remix.ts";

/** The Wish World on its own (from the wishes page): every wish nobody has made yet. */
export default function World() {
  return (
    <div className="app v2 mode-world world-page">
      <Glows />
      <header className="hdr world-hdr">
        <Link to={`/wishlist${window.location.search}`} className="cbtn" aria-label="Back"><BackIcon /></Link>
        <span className="world-title">Wish World</span>
      </header>
      <WishWorld onRemix={(id) => void remixWish(id)} />
    </div>
  );
}
