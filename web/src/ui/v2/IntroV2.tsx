import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The cinematic opening of UI variation 2:
 *   words  "Want it?" rises in, then "Wish it." in color
 *   swipe  the phrase blows up and sweeps off to the left
 *   ring   a circle draws itself where the bubble will be (rendered by the studio's orb slot)
 *   bubble the circle becomes the 3D bubble, with clouds and sparkles spinning in
 *   done   the wish screen fades in
 * Click or press any key to skip ahead. It holds on a blank screen ("wait") until the page renders
 * smoothly: while the GPU builds the first shaders, nothing (not even CSS animation) draws at a steady rate.
 */
export type IntroPhase = "wait" | "words" | "swipe" | "ring" | "bubble" | "done";

const TIMELINE: [IntroPhase, number][] = [["words", 0], ["swipe", 2150], ["ring", 2700], ["bubble", 3900], ["done", 5200]];
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True once frames come at a steady rate (30 in a row under 34 ms), or after `maxMs` regardless. */
export function useFramesSettled(maxMs = 6000): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let good = 0;
    const t0 = last;
    const tick = (now: number) => {
      good = now - last < 34 ? good + 1 : 0;
      last = now;
      if (good >= 30 || now - t0 > maxMs) setOk(true);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [maxMs]);
  return ok;
}

export function useIntroPhase(playKey: number, enabled: boolean, ready = true): [IntroPhase, () => void] {
  const [phase, setPhase] = useState<IntroPhase>(enabled && playKey > 0 && !reduced() ? "wait" : "done");
  const timers = useRef<number[]>([]);
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!enabled || playKey === 0 || reduced()) {
      setPhase("done");
      return;
    }
    if (!ready) {
      setPhase("wait");
      return;
    }
    setPhase("words");
    for (const [p, at] of TIMELINE.slice(1)) timers.current.push(window.setTimeout(() => setPhase(p), at));
    return () => timers.current.forEach(clearTimeout);
  }, [playKey, enabled, ready]);
  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase((p) => (p === "wait" || p === "words" || p === "swipe" || p === "ring" ? "bubble" : "done"));
    timers.current.push(window.setTimeout(() => setPhase("done"), 900));
  }, []);
  return [phase, skip];
}

export function IntroWords({ phase, onSkip }: { phase: IntroPhase; onSkip: () => void }) {
  const playing = phase !== "done";
  useEffect(() => {
    if (!playing) return;
    const k = (e: KeyboardEvent) => {
      // "1"/"2" switch variants (2 replays the intro); modifiers and form fields aren't a skip.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key === "1" || e.key === "2") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      onSkip();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSkip, playing]);
  if (phase !== "wait" && phase !== "words" && phase !== "swipe") return null;
  return (
    <div className={`v2-intro ${phase === "swipe" ? "swipe" : ""}`} onClick={onSkip} aria-label="Want it? Wish it." role="presentation">
      {phase !== "wait" && (
        <div className="v2-words">
          <span className="v2-w1">Want&nbsp;it?</span>
          <span className="v2-w2">Wish&nbsp;it.</span>
        </div>
      )}
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
