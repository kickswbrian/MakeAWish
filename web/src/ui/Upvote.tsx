import { useState } from "react";
import type { Campaign } from "@wishit/shared";
import { api } from "../lib/api.ts";
import { pref, setPref } from "../lib/wishlist.ts";

/** This browser's anonymous voter id (the server counts one vote per id per wish). */
export function voterId(): string {
  let id = pref<string | null>("voter", null);
  if (!id) {
    id = crypto.randomUUID?.() ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    setPref("voter", id);
  }
  return id;
}
const myVotes = () => new Set(pref<string[]>("votes", []));

/**
 * "Me too": the community upvote on a live wish. Optimistic, so the count moves on tap; the server's
 * answer (and everyone else's votes, via the campaign socket) settles it.
 */
export function Upvote({ c, onChange, big }: { c: Campaign; onChange?: (c: Campaign) => void; big?: boolean }) {
  const [on, setOn] = useState(() => myVotes().has(c.id));
  const [delta, setDelta] = useState(0);
  const count = Math.max(0, c.votes + delta);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const up = !on;
    setOn(up);
    setDelta((d) => d + (up ? 1 : -1));
    const votes = myVotes();
    if (up) votes.add(c.id);
    else votes.delete(c.id);
    setPref("votes", [...votes].slice(-500));
    try {
      const next = await api.vote(c.id, voterId(), up);
      setDelta(0);
      onChange?.(next);
    } catch {
      // Didn't count: put it back the way it was.
      setOn(!up);
      setDelta(0);
    }
  };

  return (
    <button
      type="button"
      className={`upvote ${on ? "on" : ""} ${big ? "big" : ""}`}
      aria-pressed={on}
      aria-label={`${on ? "Remove your upvote" : "Upvote this wish"}, ${count} ${count === 1 ? "upvote" : "upvotes"}`}
      onClick={toggle}
    >
      <svg width={big ? 18 : 15} height={big ? 18 : 15} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5 20 13h-4.6v7.5H8.6V13H4z" />
      </svg>
      <span>{count}</span>
      {big && <small>{on ? "You want this too" : "Me too"}</small>}
    </button>
  );
}
