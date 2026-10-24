// Tiny synthesized sound kit: no assets to load, nothing to fail on stage.
let ctx: AudioContext | null = null;
let muted = false;
export const setSfxMuted = (m: boolean) => { muted = m; };

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = "sine") {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function sparkle() {
  if (muted) return;
  const notes = [1568, 2093, 2637, 3136];
  notes.forEach((f, i) => tone(f * (1 + Math.random() * 0.01), i * 0.045, 0.35, 0.045, "triangle"));
}

export function chime() {
  if (muted) return;
  [880, 1318.5].forEach((f, i) => tone(f, i * 0.08, 0.6, 0.06));
}

export function fanfare() {
  if (muted) return;
  [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => tone(f, i * 0.09, 0.9, 0.07, "triangle"));
  [261.63, 392].forEach((f) => tone(f, 0.5, 1.6, 0.05));
}

let hum: { stop: () => void } | null = null;
/** Soft shimmering hum while the genie thinks. */
export function startHum() {
  if (muted || hum) return;
  const c = ac();
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.025, c.currentTime + 0.3);
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 5;
  lfoGain.gain.value = 0.01;
  lfo.connect(lfoGain).connect(g.gain);
  const oscs = [440, 659.25, 880.5].map((f) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g);
    o.start();
    return o;
  });
  lfo.start();
  g.connect(c.destination);
  hum = {
    stop: () => {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + 0.2);
      setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); }, 300);
    },
  };
}
export function stopHum() {
  hum?.stop();
  hum = null;
}
