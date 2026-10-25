import { useEffect, useState } from "react";

export type UiVariant = "1" | "2";
const KEY = "wishit.ui";

function initial(): UiVariant {
  const q = new URLSearchParams(window.location.search).get("ui");
  if (q === "1" || q === "2") return q;
  try {
    return localStorage.getItem(KEY) === "2" ? "2" : "1";
  } catch {
    return "1";
  }
}

/**
 * Which studio UI to show. Press 2 for the cinematic variation (it replays its intro every time),
 * 1 for the classic one. Remembered per browser; ?ui=2 forces it for a link.
 */
export function useUiVariant(): { variant: UiVariant; introKey: number } {
  const [variant, setVariant] = useState<UiVariant>(initial);
  const [introKey, setIntroKey] = useState(() => (initial() === "2" ? 1 : 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (e.key !== "1" && e.key !== "2") return;
      const next = e.key as UiVariant;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode: still switch for this visit */
      }
      setVariant(next);
      if (next === "2") setIntroKey((k) => k + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { variant, introKey };
}
