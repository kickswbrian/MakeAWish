import { useEffect, useRef, useState } from "react";

/** 1 = classic, 2 = cinematic, 3 = cinematic that holds on its title until a click or key (demos). */
export type UiVariant = "1" | "2" | "3";
// A new key: choices saved while the classic UI was the default shouldn't outlive the switch.
const KEY = "wishit.ui.v2";

function initial(): UiVariant {
  const q = new URLSearchParams(window.location.search).get("ui");
  if (q === "1" || q === "2" || q === "3") return q;
  try {
    const v = localStorage.getItem(KEY);
    return v === "1" || v === "3" ? v : "2";
  } catch {
    return "2";
  }
}

/**
 * Which studio UI to show. The cinematic variation (2) is the default; press 2 to toggle to the classic
 * UI and back (coming back replays the intro), 3 for the cinematic one holding on its title until you
 * click, 1 for classic. Remembered per browser; ?ui=1/2/3 forces it for a link.
 */
export function useUiVariant(): { variant: UiVariant; introKey: number } {
  const [variant, setVariant] = useState<UiVariant>(initial);
  const current = useRef(variant);
  current.current = variant;
  // ?intro=0 opens straight on the wish screen (coming back from the editor).
  const [introKey, setIntroKey] = useState(() => (initial() !== "1" && new URLSearchParams(window.location.search).get("intro") !== "0" ? 1 : 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (e.key !== "1" && e.key !== "2" && e.key !== "3") return;
      // 2 toggles: from either cinematic version to classic, and from classic back to cinematic.
      const next: UiVariant = e.key === "2" ? (current.current === "1" ? "2" : "1") : (e.key as UiVariant);
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
