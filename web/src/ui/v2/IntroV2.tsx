import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The cinematic opening of UI variation 2:
 *   words  "Want it?" slides in from the right, then "Wish it." traces itself in outline and fills in color
 *   swipe  the phrase sweeps off to the left (same size throughout)
 *   ring   a circle draws itself where the bubble will be (rendered by the studio's orb slot)
 *   bubble the circle becomes the 3D bubble
 *   done   the wish screen fades in
 * Click or press any key to skip ahead. With `hold` (press 3) it stays on the title until a click or a
 * key, then plays the rest. It starts on a blank screen ("wait") until the page renders smoothly:
 * while the GPU builds the first shaders, nothing (not even CSS animation) draws at a steady rate.
 */
export type IntroPhase = "wait" | "words" | "swipe" | "ring" | "bubble" | "done";

const SWIPE_AT = 2800;
const TIMELINE: [IntroPhase, number][] = [["words", 0], ["swipe", SWIPE_AT], ["ring", 3350], ["bubble", 4550], ["done", 5850]];
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

export function useIntroPhase(playKey: number, enabled: boolean, ready = true, hold = false): [IntroPhase, () => void] {
  const [phase, setPhase] = useState<IntroPhase>(enabled && playKey > 0 && !reduced() ? "wait" : "done");
  const timers = useRef<number[]>([]);
  // Holding on the title (press 3) until the presenter clicks or presses a key.
  const holding = useRef(false);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  /** Schedule the rest of the timeline as if `from` ms had already passed. */
  const play = (from: number) => {
    for (const [p, at] of TIMELINE) if (at > from) timers.current.push(window.setTimeout(() => setPhase(p), at - from));
  };
  useEffect(() => {
    clear();
    holding.current = false;
    if (!enabled || playKey === 0 || reduced()) {
      setPhase("done");
      return;
    }
    if (!ready) {
      setPhase("wait");
      return;
    }
    setPhase("words");
    if (hold) holding.current = true;
    else play(0);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, enabled, ready, hold]);
  const skip = useCallback(() => {
    clear();
    if (holding.current) {
      // Held title: go on with the swipe, ring and bubble as normal.
      holding.current = false;
      setPhase("swipe");
      play(SWIPE_AT);
      return;
    }
    setPhase((p) => (p === "wait" || p === "words" || p === "swipe" || p === "ring" ? "bubble" : "done"));
    timers.current.push(window.setTimeout(() => setPhase("done"), 900));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [phase, skip];
}

export function IntroWords({ phase, onSkip }: { phase: IntroPhase; onSkip: () => void }) {
  const playing = phase !== "done";
  useEffect(() => {
    if (!playing) return;
    const k = (e: KeyboardEvent) => {
      // "1"/"2"/"3" switch variants (2 and 3 replay the intro); modifiers and form fields aren't a skip.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key === "1" || e.key === "2" || e.key === "3") return;
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
          {/* Traced in outline, then the color wipes in behind it. */}
          <svg className="v2-w2" viewBox="0 0 420 104" role="img" aria-label="Wish it.">
            <defs>
              <linearGradient id="v2wishg" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#D9A640" />
                <stop offset=".5" stopColor="#EA8CA6" />
                <stop offset="1" stopColor="#6FA894" />
              </linearGradient>
              <mask id="v2wishm" maskUnits="userSpaceOnUse" x="0" y="-20" width="420" height="144">
                <rect className="v2-w2-wipe" x="0" y="-20" width="420" height="144" fill="#fff" />
              </mask>
            </defs>
            <text className="v2-w2-fill" x="210" y="88" textAnchor="middle" mask="url(#v2wishm)">Wish it.</text>
            <text className="v2-w2-line" x="210" y="88" textAnchor="middle">Wish it.</text>
          </svg>
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
