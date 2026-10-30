import { useEffect, useState } from "react";

/** 1 = classic, 2 = cinematic, 3 = cinematic that holds on its title until a click or key (demos). */
export type UiVariant = "1" | "2" | "3";
const KEY = "wishit.ui";

function initial(): UiVariant {
  const q = new URLSearchParams(window.location.search).get("ui");
  if (q === "1" || q === "2" || q === "3") return q;
  try {
    const v = localStorage.getItem(KEY);
    return v === "2" || v === "3" ? v : "1";
  } catch {
    return "1";
  }
}

/**
 * Which studio UI to show. Press 2 for the cinematic variation (it replays its intro every time),
 * 3 for the same one holding on its title until you click, 1 for the classic one. Remembered per
 * browser; ?ui=2 or ?ui=3 forces it for a link.
 */
export function useUiVariant(): { variant: UiVariant; introKey: number } {
  const [variant, setVariant] = useState<UiVariant>(initial);
  // ?intro=0 opens straight on the wish screen (coming back from the editor).
  const [introKey, setIntroKey] = useState(() => (initial() !== "1" && new URLSearchParams(window.location.search).get("intro") !== "0" ? 1 : 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (e.key !== "1" && e.key !== "2" && e.key !== "3") return;
      const next = e.key as UiVariant;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode: still switch for this visit */
      }
      setVariant(next);
      if (next !== "1") setIntroKey((k) => k + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { variant, introKey };
}
