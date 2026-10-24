import { useEffect, useRef } from "react";
import { orbSignal } from "../three/signals.ts";

const COLORS = ["#9FBFB2", "#C5D8CF", "#F4A8C8", "#F2D88A", "#E9C46A", "#F9C6DC"];
const W = 342, X0 = 24, H = 32, N = 60;

/** Six translucent ribbons that swell with the voice level (mic while listening, genie while speaking). */
export function Waveform({ label }: { label: string }) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    let amp = 0;
    let last = performance.now();
    let clk = 0;
    const p1 = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;
    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      clk += dt;
      const st = orbSignal.state;
      const target = st === "listening" ? Math.min(0.8, orbSignal.level * 2) : st === "speaking" ? Math.min(1, orbSignal.level * 2.2) : st === "thinking" ? 0.12 : 0;
      const up = 1 - Math.pow(0.6, dt / 40), down = 1 - Math.pow(0.86, dt / 40);
      amp += (target - amp) * (target > amp ? up : down);
      for (let i = 0; i < 6; i++) {
        const el = paths.current[i];
        if (!el) continue;
        const cx = 0.5 + 0.13 * Math.sin(clk / 900 + i * 1.3);
        const A = (13 + (i % 3) * 6) * amp;
        const fr = 1.3 + i * 0.21;
        const w = (clk / (240 + i * 45)) * (i % 2 ? -1 : 1);
        const ph = i * 0.95;
        let top = "", bottom = "";
        for (let j = 0; j <= N; j++) {
          const u = j / N;
          const x = X0 + u * W;
          const a = A * Math.exp(-Math.pow((u - cx) / 0.17, 2));
          top += (j ? " L" : "M") + p1(x, H + a * Math.sin(u * fr * 6.283 + w + ph));
          bottom = " L" + p1(x, H + a * 0.7 * Math.sin(u * fr * 6.283 + w + ph + 0.5)) + bottom;
        }
        el.setAttribute("d", top + bottom + "Z");
        el.setAttribute("stroke-opacity", (0.08 + 0.52 * Math.min(1, amp * 4)).toFixed(2));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="wavebox" role="img" aria-label={label}>
      <svg viewBox="0 0 390 64" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wbase" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#C5D8CF" stopOpacity="0" />
            <stop offset=".12" stopColor="#C5D8CF" stopOpacity=".6" />
            <stop offset=".5" stopColor="#C5D8CF" />
            <stop offset=".88" stopColor="#C5D8CF" stopOpacity=".6" />
            <stop offset="1" stopColor="#C5D8CF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M16 32 H374" stroke="url(#wbase)" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {COLORS.map((c, i) => (
          <path key={c} ref={(el) => { paths.current[i] = el; }} className="rib" fill={c} fillOpacity="0.22" stroke={c} strokeOpacity="0.08" strokeWidth="0.9" />
        ))}
      </svg>
    </div>
  );
}
