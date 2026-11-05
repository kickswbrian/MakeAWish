/**
 * SVG path outlines for extrudes: emblems, silhouettes and logos are far easier to draw as an SVG
 * path (which Claude writes well) than as a hand-placed point list. Any units, y down like SVG; the
 * drawing is centered, flipped to y up and scaled to `width` meters. Curves and arcs are flattened.
 */

export type Pt = [number, number];
export interface SvgShape { outer: Pt[]; holes: Pt[][] }
export interface SvgOutline { shapes: SvgShape[]; width: number; height: number }

const MAX_POINTS = 3000;

/** Parse an SVG path `d` string into closed polylines (one per subpath). */
export function svgContours(d: string): Pt[][] {
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = (): number | null => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number | null => {
    skip();
    if (d[i] === "0" || d[i] === "1") return Number(d[i++]);
    return null;
  };
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl: Pt | null = null, lastCmd = "";
  let total = 0;
  const push = (px: number, py: number) => {
    if (total >= MAX_POINTS) return;
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(prev[0] - px) < 1e-9 && Math.abs(prev[1] - py) < 1e-9) return;
    cur.push([px, py]);
    total++;
  };
  const close = () => {
    if (cur.length >= 3) out.push(cur);
    cur = [];
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    for (let k = 1; k <= 10; k++) {
      const t = k / 10, u = 1 - t;
      push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
  };
  const quad = (x1: number, y1: number, ex: number, ey: number) => {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      push(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
    }
  };
  // Endpoint arc to center form (SVG spec F.6.5), then flattened every ~12 degrees.
  const arc = (rx: number, ry: number, rot: number, large: number, sweep: number, ex: number, ey: number) => {
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) return push(ex, ey);
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x - ex) / 2, dy = (y - ey) / 2;
    const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (x + ex) / 2, cy = sin * cx1 + cos * cy1 + (y + ey) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 15)));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (dt * k) / n;
      const ax = rx * Math.cos(t), ay = ry * Math.sin(t);
      push(cos * ax - sin * ay + cx, sin * ax + cos * ay + cy);
    }
  };

  while (i < d.length && total < MAX_POINTS) {
    skip();
    if (i >= d.length) break;
    let cmd = d[i];
    if (/[a-zA-Z]/.test(cmd)) i++;
    else if (lastCmd && lastCmd.toLowerCase() !== "z") cmd = lastCmd === "M" ? "L" : lastCmd === "m" ? "l" : lastCmd; // repeated args
    else { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    let ctrl: Pt | null = null;
    if (C === "Z") {
      x = sx; y = sy;
      close();
    } else if (C === "M") {
      const a = num(), b = num();
      if (a === null || b === null) break;
      close();
      x = ox + a; y = oy + b; sx = x; sy = y;
      push(x, y);
    } else if (C === "L" || C === "T") {
      const a = num(), b = num();
      if (a === null || b === null) break;
      if (C === "T") {
        const c: Pt = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        quad(c[0], c[1], ox + a, oy + b);
        ctrl = c;
      } else push(ox + a, oy + b);
      x = ox + a; y = oy + b;
    } else if (C === "H") {
      const a = num();
      if (a === null) break;
      x = ox + a;
      push(x, y);
    } else if (C === "V") {
      const a = num();
      if (a === null) break;
      y = oy + a;
      push(x, y);
    } else if (C === "C" || C === "S") {
      let x1: number, y1: number;
      if (C === "C") {
        const a = num(), b = num();
        if (a === null || b === null) break;
        x1 = ox + a; y1 = oy + b;
      } else {
        [x1, y1] = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
      }
      const c = num(), e = num(), f = num(), g = num();
      if (c === null || e === null || f === null || g === null) break;
      cubic(x1, y1, ox + c, oy + e, ox + f, oy + g);
      ctrl = [ox + c, oy + e];
      x = ox + f; y = oy + g;
    } else if (C === "Q") {
      const a = num(), b = num(), c = num(), e = num();
      if (a === null || b === null || c === null || e === null) break;
      quad(ox + a, oy + b, ox + c, oy + e);
      ctrl = [ox + a, oy + b];
      x = ox + c; y = oy + e;
    } else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), a = num(), b = num();
      if (rx === null || ry === null || rot === null || large === null || sweep === null || a === null || b === null) break;
      arc(rx, ry, rot, large, sweep, ox + a, oy + b);
      x = ox + a; y = oy + b;
    } else break;
    lastCtrl = ctrl;
    lastCmd = cmd;
  }
  close();
  // A closing point that repeats the start adds nothing.
  for (const c of out) {
    const a = c[0], b = c[c.length - 1];
    if (c.length > 3 && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) c.pop();
  }
  return out;
}

const area = (c: Pt[]) => c.reduce((s, p, k) => { const q = c[(k + 1) % c.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function inside(p: Pt, c: Pt[]): boolean {
  let hit = false;
  for (let k = 0, j = c.length - 1; k < c.length; j = k++) {
    const [xi, yi] = c[k], [xj, yj] = c[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const cache = new Map<string, SvgOutline | null>();

/**
 * The drawing as extrudable shapes, `width` meters wide, centered on the origin with y up. Subpaths
 * inside an odd number of others are holes (even-odd, like a stencil). Null when nothing parses.
 */
export function svgOutline(d: string, width: number): SvgOutline | null {
  const key = `${width}|${d}`;
  if (cache.has(key)) return cache.get(key)!;
  const contours = svgContours(d).filter((c) => Math.abs(area(c)) > 0);
  let result: SvgOutline | null = null;
  if (contours.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of contours) for (const [px, py] of c) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const s = width / Math.max(1e-9, maxX - minX);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    const norm = contours.map((c) => c.map(([px, py]) => [r((px - cx) * s), r(-(py - cy) * s)] as Pt));
    // Biggest first; each contour's depth is how many bigger ones contain it.
    const order = norm.map((c, k) => ({ c, k, a: Math.abs(area(c)) })).sort((a, b) => b.a - a.a);
    const shapes: SvgShape[] = [];
    const owner = new Map<number, SvgShape>();
    order.forEach(({ c, k }, idx) => {
      // Inside means all of it: a wing that starts on the body and sticks out is a piece, not a hole.
      const containers = order.slice(0, idx).filter((o) => c.every((p) => inside(p, o.c)));
      if (containers.length % 2 === 0) {
        const shape = { outer: c, holes: [] as Pt[][] };
        shapes.push(shape);
        owner.set(k, shape);
      } else {
        // The smallest container is the outline this hole cuts.
        const parent = containers[containers.length - 1];
        owner.get(parent.k)?.holes.push(c);
      }
    });
    result = { shapes, width: r(width), height: r((maxY - minY) * s) };
  }
  if (cache.size > 300) cache.clear();
  cache.set(key, result);
  return result;
}

/** At most `n` points, evenly picked: a fallback outline for the schema. */
export function thinPoints(c: Pt[], n: number): Pt[] {
  if (c.length <= n) return c;
  return Array.from({ length: n }, (_, k) => c[Math.floor((k * c.length) / n)]);
}
