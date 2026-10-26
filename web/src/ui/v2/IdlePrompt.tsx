import { useEffect, useState } from "react";

/** True once `activity` (anything said, typed or shown) has stayed the same for `delayMs`. */
export function useIdle(activity: string, enabled: boolean, delayMs: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    if (!enabled) return;
    const t = setTimeout(() => setIdle(true), delayMs);
    return () => clearTimeout(t);
  }, [activity, enabled, delayMs]);
  return idle && enabled;
}

/** The one-line nudge under UI variation 2's bubble, in caption style. */
export function IdlePrompt({ listening }: { listening: boolean }) {
  const text = listening ? "Ready when you are" : "Tap the bubble and make a wish";
  return (
    <p className="line v2-prompt" aria-live="polite">
      <span key={text}>
        {text.split(" ").map((w, i) => (
          <span key={i} className="w" style={{ ["--i" as string]: i }}>{w}</span>
        ))}
      </span>
    </p>
  );
}
