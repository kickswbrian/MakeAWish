import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The cinematic opening of UI variation 2:
 *   words  "Want it?" rises in, then "Wish it." in color
 *   swipe  the phrase blows up and sweeps off to the left
 *   ring   a circle draws itself where the bubble will be (rendered by the studio's orb slot)
 *   bubble the circle becomes the 3D bubble, with clouds and sparkles spinning in
 *   done   the wish screen fades in
 * Click or press any key to skip ahead.
 */
export type IntroPhase = "words" | "swipe" | "ring" | "bubble" | "done";

const TIMELINE: [IntroPhase, number][] = [["words", 0], ["swipe", 2150], ["ring", 2700], ["bubble", 3900], ["done", 5200]];
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useIntroPhase(playKey: number, enabled: boolean): [IntroPhase, () => void] {
  const [phase, setPhase] = useState<IntroPhase>(enabled && playKey > 0 && !reduced() ? "words" : "done");
  const timers = useRef<number[]>([]);
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!enabled || playKey === 0 || reduced()) {
      setPhase("done");
      return;
    }
    setPhase("words");
    for (const [p, at] of TIMELINE.slice(1)) timers.current.push(window.setTimeout(() => setPhase(p), at));
    return () => timers.current.forEach(clearTimeout);
  }, [playKey, enabled]);
  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase((p) => (p === "words" || p === "swipe" || p === "ring" ? "bubble" : "done"));
    timers.current.push(window.setTimeout(() => setPhase("done"), 900));
  }, []);
  return [phase, skip];
}

export function IntroWords({ phase, onSkip }: { phase: IntroPhase; onSkip: () => void }) {
  useEffect(() => {
    const k = () => onSkip();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSkip]);
  if (phase !== "words" && phase !== "swipe") return null;
  return (
    <div className={`v2-intro ${phase === "swipe" ? "swipe" : ""}`} onClick={onSkip} aria-label="Want it? Wish it." role="presentation">
      <div className="v2-words">
        <span className="v2-w1">Want&nbsp;it?</span>
        <span className="v2-w2">Wish&nbsp;it.</span>
      </div>
    </div>
  );
}

/** The circle that draws itself in the bubble's place, then flashes into the sphere. */
export function IntroRing({ phase }: { phase: IntroPhase }) {
  if (phase !== "ring" && phase !== "bubble") return null;
  return (
    <svg className={`v2-ring ${phase === "bubble" ? "out" : ""}`} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="v2ringg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E9C46A" />
          <stop offset=".55" stopColor="#F4A8C8" />
          <stop offset="1" stopColor="#9FBFB2" />
        </linearGradient>
      </defs>
      <circle className="v2-ring-track" cx="50" cy="50" r="48.6" />
      <g className="v2-ring-spin">
        <circle className="v2-ring-draw" cx="50" cy="50" r="48.6" pathLength="100" />
        <g className="v2-ring-headg">
          <circle className="v2-ring-head" cx="98.6" cy="50" r="1.6" />
        </g>
      </g>
    </svg>
  );
}
