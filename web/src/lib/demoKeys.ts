import { useEffect } from "react";

/**
 * Presenter keys, anywhere outside a text field:
 *   1 = back to the start on a fresh wish, straight to the wish screen (no intro);
 *   3 = back to the start on a fresh wish, with the intro holding on its title until a click;
 *   4 = the Wish World.
 * (2 toggles the classic UI; see useUiVariant.) Every jump reloads, so nothing of the last wish stays.
 */
export const VARIANT_KEY = "wishit.ui.v2";

export function goStart(intro: "skip" | "hold"): void {
  const q = new URLSearchParams(window.location.search);
  q.delete("wish");
  if (intro === "skip") q.set("intro", "0");
  else {
    q.delete("intro");
    try {
      localStorage.setItem(VARIANT_KEY, "3");
    } catch {
      /* private mode: the ?ui param below still holds it */
    }
    if (q.has("ui")) q.set("ui", "3");
  }
  const qs = q.toString();
  window.location.assign(`/${qs ? `?${qs}` : ""}`);
}

export function goWorld(): void {
  const q = new URLSearchParams(window.location.search);
  q.delete("wish");
  q.delete("intro");
  const qs = q.toString();
  window.location.assign(`/world${qs ? `?${qs}` : ""}`);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

/** The presenter keys 1, 3 and 4 (`world` = already on the Wish World, so 4 does nothing). */
export function useDemoKeys(world = false): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "1") goStart("skip");
      else if (e.key === "3") goStart("hold");
      else if (e.key === "4" && !world) goWorld();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [world]);
}
