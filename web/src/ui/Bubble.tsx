import { useEffect, useRef, useState, type ReactNode } from "react";
import { orbSignal, type OrbState } from "../three/signals.ts";
import { Sparkle } from "./Icons.tsx";

const GLOW = ["#F2D88A", "#F4A8C8", "#E9C46A", "#F9C6DC", "#C5D8CF"];
const SPIRAL = Array.from({ length: 22 }, (_, i) => ({ a: i * (360 / 22), r: 92 + ((i * 13) % 28), d: (i % 6) * 70, c: GLOW[i % 5] }));
const BURST = Array.from({ length: 16 }, (_, i) => ({ a: i * 22.5, cls: i % 2 ? "bs bsA" : "bs bsB", c: GLOW[i % 5] }));

/** Sparkles that twinkle around the bubble, placed in % of the bubble's box. */
const SPARKS = [[-5, 2, 14, 0, 0], [96, 0, 16, 1, 0.8], [104, 74, 11, 2, 1.6], [-10, 84, 14, 3, 2.2], [32, -8, 9, 0, 2], [86, 96, 10, 1, 1.1], [4, 40, 8, 2, 2.7]];

export function BubbleSparks() {
  return (
    <>
      {SPARKS.map(([x, y, s, c, d], i) => (
        <Sparkle key={i} className="spk" color={GLOW[c]} style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${d}s` }} />
      ))}
    </>
  );
}

/** A centred glow that pulses with the genie's voice level, read straight from the audio signal. */
function VoiceCore() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let amp = 0;
    const loop = () => {
      const target = Math.min(1, orbSignal.level * 2.2);
      amp += (target - amp) * (target > amp ? 0.35 : 0.12);
      if (el.current) {
        el.current.style.transform = `scale(${(0.55 + amp * 0.6).toFixed(3)})`;
        el.current.style.opacity = (0.3 + amp * 0.65).toFixed(2);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={el} className="vcore" />;
}

function robotPose(t: number) {
  const x = 120 + 50 * Math.sin(t * 1.05);
  const y = 110 + 28 * Math.sin(t * 1.9 + 0.6) + 3 * Math.sin(t * 7);
  const r = Math.max(-14, Math.min(14, 52.5 * Math.cos(t * 1.05) * 0.22));
  const rad = (r * Math.PI) / 180;
  return { x, y, r, tx: x - 44.6 * Math.sin(rad), ty: y + 44.6 * Math.cos(rad) };
}

/** The genie robot that flies around inside the bubble with a magnifying glass while it thinks. */
function Robot() {
  const [T, setT] = useState(0);
  const hist = useRef<[number, number][]>([]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const q = robotPose(t);
      hist.current.push([q.tx, q.ty]);
      if (hist.current.length > 24) hist.current.shift();
      setT(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const f = (v: number) => +v.toFixed(2);
  const p = robotPose(T);
  const ease = (s: number) => s * s * (3 - 2 * s);
  const cyc = (T % 3.2) / 3.2;
  let arm = 0;
  if (cyc < 0.08) arm = 0;
  else if (cyc < 0.24) arm = -155 * ease((cyc - 0.08) / 0.16);
  else if (cyc < 0.62) arm = -155 + 4 * Math.sin((cyc - 0.24) * 40);
  else if (cyc < 0.8) arm = -155 * (1 - ease((cyc - 0.62) / 0.18));
  let beo = 0;
  if (cyc >= 0.22 && cyc < 0.26) beo = (cyc - 0.22) / 0.04;
  else if (cyc >= 0.26 && cyc < 0.6) beo = 1;
  else if (cyc >= 0.6 && cyc < 0.64) beo = 1 - (cyc - 0.6) / 0.04;
  const bp = T % 2.9;
  const k = bp < 0.14 ? 8 * Math.sin((bp / 0.14) * Math.PI) : 0;
  const g = cyc >= 0.26 && cyc < 0.4 ? Math.sin(((cyc - 0.26) / 0.14) * Math.PI) : 0;
  const h = Math.max(0, Math.min(1, (p.y - 80) / 60));
  const trail = [3, 6, 9, 13, 17, 21].flatMap((lag, i) => {
    const q = hist.current[hist.current.length - 1 - lag];
    return q ? [{ x: q[0], y: q[1], r: 3.4 - i * 0.45, o: 0.9 - i * 0.13, c: i % 2 ? "#F4A8C8" : "#F2D88A" }] : [];
  });

  return (
    <div className="robo" role="img" aria-label="The genie is searching">
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <ellipse cx={f(p.x)} cy="214" rx={f(18 + 14 * h)} ry="5" fill="#182825" fillOpacity={f(0.06 + 0.12 * h)} />
        {trail.map((d, i) => <circle key={i} cx={f(d.x)} cy={f(d.y)} r={f(d.r)} fill={d.c} fillOpacity={f(d.o)} />)}
        <g transform={`translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.r)}) scale(0.72) translate(-60 -78)`}>
          <ellipse cx="60" cy="138" rx="7.5" ry={f(10 + 3 * Math.sin(T * 38))} fill="#F4A8C8" fillOpacity=".75" />
          <ellipse cx="60" cy="136" rx="5" ry={f(7 + 2 * Math.sin(T * 38 + 1))} fill="#F2D88A" />
          <ellipse cx="60" cy="134" rx="2.5" ry={f(4 + 1.2 * Math.sin(T * 38 + 2))} fill="#FFF6D8" />
          <path d="M60 17 V9" stroke="#8FD4C1" strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="7" r="5" fill="#A9E7D6" />
          <circle cx="58.5" cy="5.5" r="1.6" fill="#FFFFFF" />
          <ellipse cx="34" cy="104" rx="7.5" ry="13.5" fill="#E3EAEE" transform={`rotate(${f(4 * Math.sin(T * 5))} 38 94)`} />
          <ellipse cx="60" cy="108" rx="28" ry="29" fill="#F6F9FA" />
          <path d="M74 84 Q90 104 80 130 Q72 137 60 137 Q80 122 74 84 Z" fill="#DDE5EA" />
          <ellipse cx="48" cy="98" rx="7" ry="10" fill="#FFFFFF" transform="rotate(-20 48 98)" />
          <path d="M47 84 Q60 91 73 84" stroke="#A9E7D6" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <circle cx="67" cy="105" r="5.5" fill="#CFFAF3" />
          <circle cx="67" cy="105" r="3" fill="#7FF0DD" />
          <ellipse cx="16" cy="48" rx="9.5" ry="12.5" fill="#8DBEDF" />
          <ellipse cx="17.5" cy="48" rx="7" ry="10" fill="#A9D3EC" />
          <ellipse cx="16" cy="44" rx="2.6" ry="3.6" fill="#E3F2FB" />
          <ellipse cx="104" cy="48" rx="9.5" ry="12.5" fill="#8DBEDF" />
          <ellipse cx="102.5" cy="48" rx="7" ry="10" fill="#A9D3EC" />
          <ellipse cx="101" cy="44" rx="2.6" ry="3.6" fill="#E3F2FB" />
          <rect x="18" y="16" width="84" height="66" rx="31" fill="#9FDDCB" />
          <rect x="18" y="16" width="84" height="61" rx="30" fill="#BDEEE0" />
          <rect x="24" y="19" width="66" height="30" rx="15" fill="#D3F5EB" />
          <ellipse cx="40" cy="25" rx="12" ry="4.5" fill="#FFFFFF" transform="rotate(-14 40 25)" />
          <rect x="28" y="30" width="64" height="44" rx="20" fill="#121A3A" />
          <rect x="30" y="31" width="60" height="36" rx="18" fill="#1F2A58" />
          <path d="M34 41 Q44 33 60 33 Q47 37 38 46 Z" fill="#FFFFFF" fillOpacity=".16" />
          <circle cx="84" cy="38" r="2" fill="#FFFFFF" fillOpacity=".55" />
          <path d={`M40 52 Q46 ${f(44 + k)} 52 52`} stroke="#7FF0DD" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d={`M68 52 Q74 ${f(44 + k)} 80 52`} stroke="#7FF0DD" strokeWidth="4" strokeLinecap="round" fill="none" strokeOpacity={f(1 - beo)} />
          <path d="M54 61 Q60 66 66 61" stroke="#7FF0DD" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M64 48 Q73 34 82 48" stroke="#7FF0DD" strokeWidth="6.5" strokeLinecap="round" fill="none" strokeOpacity={f(beo)} />
          <g transform={`rotate(${f(arm)} 84 94)`}>
            <path d="M84 94 L101 117" stroke="#DDE5EA" strokeWidth="13" strokeLinecap="round" />
            <path d="M83.5 93 L100 115.5" stroke="#F6F9FA" strokeWidth="9" strokeLinecap="round" />
            <circle cx="102" cy="119" r="6.8" fill="#F6F9FA" />
            <circle cx="103.5" cy="120.5" r="4.5" fill="#E3EAEE" />
            <path d="M104 123 L109 128" stroke="#2F62D9" strokeWidth="5.5" strokeLinecap="round" />
            <circle cx="116" cy="136" r="12" fill="#DDEBFF" fillOpacity=".55" stroke="#3D7BF5" strokeWidth="4.5" />
            <path d="M109 131 Q112 127 117 127" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </g>
          <path
            d="M88 22C88.4 26.6 91.4 29.6 96 30C91.4 30.4 88.4 33.4 88 38C87.6 33.4 84.6 30.4 80 30C84.6 29.6 87.6 26.6 88 22Z"
            fill="#F2D88A" fillOpacity={f(g)} transform={`translate(88 30) scale(${f(0.4 + 0.8 * g)}) translate(-88 -30)`}
          />
        </g>
      </svg>
    </div>
  );
}

/** One-shot effect that removes itself after `ms`. */
function OneShot({ ms, children }: { ms: number; children: ReactNode }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on ? <>{children}</> : null;
}

/** Sparkle spiral and flash when the product first appears. */
function Materialize() {
  return (
    <OneShot ms={2200}>
      <div className="spiral">
        {SPIRAL.map((p, i) => (
          <div key={i} className="sp-arm" style={{ transform: `rotate(${p.a}deg)` }}>
            <div className="sp-len" style={{ width: p.r, animationDelay: `${p.d}ms` }}>
              <span className="sp-dot" style={{ background: `radial-gradient(circle, #fff 30%, ${p.c} 80%)`, boxShadow: `0 0 8px 2px ${p.c}`, animationDelay: `${p.d}ms` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flash" />
    </OneShot>
  );
}

/** Ripple, sweep and burst when the product reshapes. */
function Reshape() {
  return (
    <OneShot ms={1900}>
      <div className="wave" />
      <div className="wave" style={{ animationDelay: ".25s" }} />
      <div className="sweep" />
      <div className="bursts">
        {BURST.map((b, i) => (
          <div key={i} className="b-arm" style={{ transform: `rotate(${b.a}deg)` }}>
            <span className={b.cls} style={{ background: `radial-gradient(circle, #fff 30%, ${b.c} 80%)`, boxShadow: `0 0 8px ${b.c}` }} />
          </div>
        ))}
      </div>
    </OneShot>
  );
}

export interface BubbleProps {
  state?: OrbState;
  /** Show the flying robot (thinking before there is a product). */
  robot?: boolean;
  /** Bump to play the materialize effect. */
  materializeKey?: number;
  /** Bump to play the reshape effect. */
  reshapeKey?: number;
  children?: ReactNode;
  /** Floats over the bubble without being clipped by it (the genie edit card). */
  overlay?: ReactNode;
}

/** The pearly soap bubble the genie lives in. The 3D product renders inside it. */
/** Drives --amp on the bubble from the live voice level (mic while listening, genie while speaking). */
function useVoiceAmp(ref: React.RefObject<HTMLDivElement>, active: boolean) {
  useEffect(() => {
    let raf = 0;
    let amp = 0;
    const loop = () => {
      const target = active ? Math.min(1, orbSignal.level * 2) : 0;
      amp += (target - amp) * (target > amp ? 0.4 : 0.1);
      ref.current?.style.setProperty("--amp", amp.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ref, active]);
}

export function Bubble({ state = "idle", robot, materializeKey = 0, reshapeKey = 0, children, overlay }: BubbleProps) {
  const wrap = useRef<HTMLDivElement>(null);
  useVoiceAmp(wrap, state === "listening" || state === "speaking");
  return (
    <div ref={wrap} className={`bwrap is-${state}`}>
      <div className="bfloat">
        {state === "listening" && (
          <>
            <div className="ripple" />
            <div className="ripple" style={{ animationDelay: ".8s" }} />
            <div className="ripple" style={{ animationDelay: "1.6s" }} />
          </>
        )}
        <div className="bubble">
          <div className="b-swirl" />
          <div className="b-tint" />
          <div className="b-content">{children}</div>
          {state === "speaking" && robot && <VoiceCore />}
          <div className="b-amp" />
          {robot && state === "thinking" && <Robot />}
          {materializeKey > 0 && <Materialize key={`m${materializeKey}`} />}
          {reshapeKey > 0 && <Reshape key={`r${reshapeKey}`} />}
          <div className="b-glint" />
          <div className="b-hl1" />
          <div className="b-hl2" />
          <div className="b-hl3" />
          <div className="b-rim" />
        </div>
        {overlay && <div className="b-overlay">{overlay}</div>}
      </div>
      <div className="bshadow" />
    </div>
  );
}
