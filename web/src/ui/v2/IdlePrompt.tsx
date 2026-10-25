import { useEffect, useState } from "react";

const IDLE_MS = 10_000;
const LISTENING = ["Ready when you are", "Speak what you wish existed", "Anything at all. Just say it", "Try “a backpack with a built-in laptop stand”"];
const ASLEEP = ["Tap the bubble and make a wish", "Ready when you are. Tap the bubble", "Tap the bubble, then say what you want"];

/** True once `activity` (anything said, typed or shown) has stayed the same for 10 s. */
export function useIdle(activity: string, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    if (!enabled) return;
    const t = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(t);
  }, [activity, enabled]);
  return idle && enabled;
}

/** The nudge under UI variation 2's bubble, in caption style, changing every few seconds. */
export function IdlePrompt({ listening }: { listening: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((i) => i + 1), 4200);
    return () => clearInterval(t);
  }, []);
  const lines = listening ? LISTENING : ASLEEP;
  const text = lines[n % lines.length];
  // The live region stays put; only the words inside re-animate, so screen readers hear each line.
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
