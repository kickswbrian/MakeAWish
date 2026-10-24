import type { ProductSpec } from "@wishit/shared";
import { FABRIC_LOOK, FINISH_LOOK, HEM_Y, HIP_Y, smooth, TORSO_ZS, WAIST_Y } from "./shapes.ts";

/** Morph targets for a garment. Every number eases toward its target, so spec changes never pop. */
export interface Targets {
  hem: number; wF: number; wA: number; wW: number; wFl: number;
  nCrew: number; nV: number; nSq: number; nH: number; nScoop: number; nSweet: number; nTurtle: number; nOff: number;
  sleeveL: number; sleeveR: number; bodiceBottom: number;
  roughness: number; sheen: number; sheenRoughness: number; clearcoat: number; metalness: number; glow: number;
  pockets: number; seam: number;
}

export const SLEEVE_LEN = { none: 0, cap: 0.085, short: 0.21, puff: 0.15, three_quarter: 0.45, long: 0.62 } as const;

export function targetsFor(spec: ProductSpec): Targets {
  const cat = spec.category;
  const len = spec.length ?? "midi";
  const sil = spec.silhouette ?? "a_line";
  const neck = spec.neckline ?? "crew";
  const sleeves = spec.sleeves ?? (cat === "top" ? "short" : "none");
  const look = { ...FABRIC_LOOK[spec.fabric ?? "cotton"], ...(spec.finish ? FINISH_LOOK[spec.finish] : {}) };
  const f = spec.features ?? [];
  return {
    hem: HEM_Y[len],
    wF: sil === "fitted" ? 1 : 0, wA: sil === "a_line" ? 1 : 0, wW: sil === "wrap" ? 1 : 0, wFl: sil === "flowy" ? 1 : 0,
    nCrew: neck === "crew" ? 1 : 0, nV: neck === "v" ? 1 : 0, nSq: neck === "square" ? 1 : 0, nH: neck === "halter" ? 1 : 0,
    nScoop: neck === "scoop" ? 1 : 0, nSweet: neck === "sweetheart" ? 1 : 0, nTurtle: neck === "turtleneck" ? 1 : 0, nOff: neck === "off_shoulder" ? 1 : 0,
    sleeveL: SLEEVE_LEN[sleeves],
    sleeveR: sleeves === "cap" ? 0.078 : sleeves === "puff" ? 0.1 : 0.062,
    bodiceBottom: cat === "top" ? 0.86 : WAIST_Y - 0.02,
    roughness: look.roughness, sheen: look.sheen, sheenRoughness: look.sheenRoughness, clearcoat: look.clearcoat,
    metalness: look.metalness ?? 0, glow: look.glow ?? 0,
    pockets: f.includes("phone_pockets") && cat !== "top" ? 1 : 0,
    seam: f.includes("converts_to_skirt") && cat === "dress" ? 1 : 0,
  };
}

/** Neckline height around the body; theta = 0 is the front. Weights blend so necklines morph. */
export function topY(th: number, a: Targets) {
  const ath = Math.abs(th);
  const front = Math.max(0, Math.cos(th));
  const crew = 1.555 - 0.035 * front ** 4;
  const v = 1.555 - 0.21 * Math.max(0, 1 - ath / 0.55);
  const sq = 1.555 - 0.13 * (1 - smooth(0.55, 0.75, ath));
  const halter = ath < 0.32 ? 1.575 : 1.575 - 0.2 * smooth(0.32, 0.7, ath) - 0.1 * smooth(1.8, 2.6, ath);
  const scoop = 1.555 - 0.13 * front ** 2;
  // Two curves over the bust meeting in a small dip at the center.
  const sweet = 1.43 + 0.05 * Math.sin(Math.min(ath, 0.9) / 0.9 * Math.PI) - 0.03 * (1 - smooth(0, 0.12, ath)) + 0.1 * smooth(0.9, 1.6, ath);
  const turtle = 1.66;
  const off = 1.445 + 0.01 * Math.cos(th * 2);
  const sum = a.nCrew + a.nV + a.nSq + a.nH + a.nScoop + a.nSweet + a.nTurtle + a.nOff || 1;
  return (crew * a.nCrew + v * a.nV + sq * a.nSq + halter * a.nH + scoop * a.nScoop + sweet * a.nSweet + turtle * a.nTurtle + off * a.nOff) / sum;
}

/** Skirt surface at height y: out = [radius, y, xScale, zScale]. */
export function skirtPoint(y: number, th: number, a: Targets, sway: number, out: number[]) {
  const rHip = 0.235 + a.wFl * 0.015 + a.wA * 0.005;
  let r: number;
  let zs: number;
  if (y > HIP_Y) {
    r = 0.168 + (rHip - 0.168) * smooth(WAIST_Y, HIP_Y, y);
    zs = TORSO_ZS + 0.04;
  } else {
    const dy = HIP_Y - y;
    const slope = a.wF * -0.05 + a.wA * 0.3 + a.wW * 0.26 + a.wFl * 0.56;
    r = rHip + dy * slope;
    const depth = Math.min(1, dy / 0.45);
    r += (a.wFl * 0.042 + a.wA * 0.006 + a.wW * 0.01) * depth * Math.sin(th * 9 + sway * (0.4 + a.wFl));
    r += a.wW * 0.014 * Math.max(0, Math.sin(th + 0.5));
    zs = TORSO_ZS + 0.04 + 0.16 * Math.min(1, dy / 0.5);
  }
  out[0] = r;
  out[1] = y;
  out[2] = 1;
  out[3] = zs;
}

/** Skirt radius ignoring the hem ripple (for things placed on the skirt). */
export function skirtRadius(y: number, a: Targets) {
  const out = [0, 0, 1, 1];
  skirtPoint(y, 0, { ...a, wFl: a.wFl, wA: a.wA }, 0, out);
  const dy = Math.max(0, HIP_Y - y);
  const ripple = (a.wFl * 0.042 + a.wA * 0.006 + a.wW * 0.01) * Math.min(1, dy / 0.45);
  return { r: out[0] + ripple, zs: out[3] };
}
