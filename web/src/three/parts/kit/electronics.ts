import * as THREE from "three";
import type { PartMaterial } from "@wishit/shared";
import { getMaterial } from "../materials.ts";
import {
  Acc, M, type Params, type Piece, arcPts, circleHole, circleShape, clamp, domeZ, extrude, glowOf, lathe, latheDisplaced,
  latheZ, polyShape, rbox, rrect, rrectHole,
} from "./core.ts";

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Lighter, slightly desaturated version of a glow color for the diffuse base of a lit element. */
function tint(hex: string, toward = "#FFFFFF", k = 0.45): string {
  return "#" + new THREE.Color(hex).lerp(new THREE.Color(toward), k).getHexString().toUpperCase();
}

/** Emissive element material (cached by getMaterial). */
const glowMaterial = (intensity: number, roughness = 0.3, whiten = 0.45) => (m: PartMaterial) => {
  const g = glowOf(m);
  return getMaterial({ preset: "plastic_gloss", color: tint(g, "#FFFFFF", whiten), emissive: g, emissiveIntensity: intensity, roughness });
};

// ---------- LED ----------

export function led(): Piece[] {
  const acc = new Acc();
  const bezel: [number, number][] = [
    [0.0026, 0.0], [0.0039, 0.0], [0.004, 0.0003], [0.004, 0.0009], ...arcPts(0.0034, 0.0009, 0.0006, 0, Math.PI / 2, 4).slice(1),
    [0.0029, 0.00148], [0.00265, 0.0012], [0.0026, 0.0006],
  ];
  acc.add(latheZ([...bezel, bezel[0]], 56), "main", { crease: 0.7 });
  acc.add(domeZ(0.00262, 0.0024, 36, 12).translate(0, 0, 0.00055), glowMaterial(1.5, 0.2, 0.15));
  return acc.finish();
}

// ---------- Speaker grille ----------

export function speakerGrille(p: Params): Piece[] {
  const R = p.radius;
  const s = R / 0.03;
  const zs = Math.sqrt(s);
  const acc = new Acc();
  const rim: [number, number][] = [
    [0.845 * R, 0], [0.98 * R, 0], [R, 0.0008 * zs], [R, 0.0042 * zs], ...arcPts(R - 0.0016 * zs, 0.0042 * zs, 0.0016 * zs, 0, Math.PI / 2, 5).slice(1),
    [0.9 * R, 0.0059 * zs], ...arcPts(0.9 * R, 0.0049 * zs, 0.001 * zs, Math.PI / 2, Math.PI, 4).slice(1), [0.86 * R, 0.0034 * zs], [0.845 * R, 0.0030 * zs],
  ];
  acc.add(latheZ([...rim, rim[0]], 96), "main", { crease: 0.7 });
  // Perforated face: hex hole pattern, gently domed.
  const Rf = 0.865 * R;
  const face = circleShape(Rf, 0, 0, 96);
  const pitch = (0.8 * R) / 10;
  const hr = pitch * 0.34;
  const rows = Math.ceil((0.8 * R) / (pitch * 0.866)) + 1;
  for (let j = -rows; j <= rows; j++) {
    const y = j * pitch * 0.866;
    const off = Math.abs(j) % 2 === 1 ? pitch / 2 : 0;
    for (let i = -rows - 1; i <= rows + 1; i++) {
      const x = i * pitch + off;
      if (Math.hypot(x, y) <= 0.8 * R - hr) face.holes.push(circleHole(hr, x, y, 10));
    }
  }
  const g = extrude(face, 0.0007 * zs, 0, { z0: 0.0026 * zs });
  const pos = g.attributes.position;
  const dome = 0.0011 * zs;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / Rf;
    pos.setZ(i, pos.getZ(i) + dome * Math.max(0, 1 - r * r));
  }
  acc.add(g, "main", { crease: 0.5 });
  // Dark acoustic cloth behind the holes.
  acc.add(new THREE.CircleGeometry(Rf, 64).translate(0, 0, 0.0012 * zs), M.void);
  return acc.finish();
}

// ---------- USB-C ----------

export function usbPort(): Piece[] {
  const acc = new Acc();
  // Everything sits on the surface (a parent panel would hide anything below z = 0): a polished
  // stadium lip around a black slot with the contact tongue and its gold pins.
  const shell = rrect(0.0089, 0.0032, 0.0016);
  shell.holes.push(rrectHole(0.0079, 0.0022, 0.0011));
  acc.add(extrude(shell, 0.00045, 0.00014, { curveSegs: 14, bevelSegs: 3 }), "main", { crease: 0.8 });
  const gasket = rrect(0.0100, 0.0035, 0.00175);
  gasket.holes.push(rrectHole(0.0088, 0.0031, 0.00155));
  acc.add(extrude(gasket, 0.00016, 0.00006, { curveSegs: 14 }), M.blackGloss, { crease: 0.8 });
  acc.add(new THREE.ShapeGeometry(rrect(0.0082, 0.0025, 0.00122), 12).translate(0, 0, 0.00003), M.void);
  acc.add(rbox(0.0066, 0.0008, 0.00018, 0.00008, 1).translate(0, 0, 0.00012), M.blackPlastic);
  for (let i = 0; i < 12; i++) {
    const x = -0.00275 + i * 0.0005;
    acc.add(new THREE.BoxGeometry(0.00026, 0.00046, 0.00003).translate(x, 0, 0.00022), M.gold);
  }
  return acc.finish();
}

// ---------- Rocker switch ----------

export function toggleSwitch(): Piece[] {
  const acc = new Acc();
  const bezel = rrect(0.02, 0.012, 0.0022);
  bezel.holes.push(rrectHole(0.0166, 0.0086, 0.0012));
  acc.add(extrude(bezel, 0.0016, 0.0005, { curveSegs: 10, bevelSegs: 3 }), M.blackGloss, { crease: 0.8 });
  acc.add(new THREE.ShapeGeometry(rrect(0.0166, 0.0086, 0.0012), 8).translate(0, 0, 0.0001), M.void);
  // Rocker: concave top, tilted toward the "on" side.
  const zTop = (x: number) => 0.004 - 0.15 * x + 9.375 * x * x;
  const xs = 0.0079;
  const prof: [number, number][] = [[-xs, 0.0003], [xs, 0.0003]];
  for (let i = 0; i <= 20; i++) {
    const x = xs - (2 * xs * i) / 20;
    prof.push([x, zTop(x)]);
  }
  const rock = extrude(polyShape(prof), 0.0080, 0.0006, { bevelSegs: 3 });
  rock.rotateX(Math.PI / 2).translate(0, 0.004, 0);
  acc.add(rock, "main", { crease: 0.6 });
  // "I" / "O" marks following the rocker surface.
  const mark = (x: number) => -Math.atan(-0.15 + 2 * 9.375 * x);
  acc.add(rbox(0.0007, 0.0034, 0.0004, 0.00015, 1).rotateY(mark(-0.0045)).translate(-0.0045, 0, zTop(-0.0045) + 0.00005), M.whitePlastic);
  acc.add(new THREE.TorusGeometry(0.0011, 0.00028, 8, 28).rotateY(mark(0.0045)).translate(0.0045, 0, zTop(0.0045) + 0.00008), M.whitePlastic);
  return acc.finish();
}

// ---------- Display screen ----------

const screenMats = new Map<string, THREE.MeshPhysicalMaterial>();

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Glowing UI drawn in the glow color: status bar, progress ring, stat bars, a pill button. */
function screenTexture(glow: string, aspect: number, borderFrac: number): THREE.CanvasTexture {
  const long = 1024;
  const cw = aspect >= 1 ? long : Math.max(64, Math.round(long * aspect));
  const ch = aspect >= 1 ? Math.max(64, Math.round(long / aspect)) : long;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  const m = Math.min(cw, ch) * borderFrac;
  const ax = m, ay = m, aw = cw - 2 * m, ah = ch - 2 * m;
  const u = Math.min(aw, ah) / 100;
  const col = new THREE.Color(glow);
  const rgba = (a: number) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  // Active area: a deep tinted gradient.
  rr(ctx, ax, ay, aw, ah, u * 7);
  const bg = ctx.createLinearGradient(0, ay, 0, ay + ah);
  bg.addColorStop(0, rgba(0.16));
  bg.addColorStop(1, rgba(0.05));
  ctx.fillStyle = "#020203";
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  rr(ctx, ax, ay, aw, ah, u * 7);
  ctx.clip();
  const font = (px: number, wgt = 600) => `${wgt} ${px}px Inter, -apple-system, "Segoe UI", system-ui, sans-serif`;
  // Status bar.
  ctx.fillStyle = rgba(0.85);
  ctx.font = font(u * 5.2);
  ctx.textBaseline = "middle";
  ctx.fillText("9:41", ax + u * 7, ay + u * 7);
  for (let i = 0; i < 3; i++) {
    rr(ctx, ax + aw - u * (20 - i * 3.3), ay + u * (8.6 - i * 1.1), u * 2.2, u * (1.4 + i * 1.1), u * 0.6);
    ctx.fill();
  }
  rr(ctx, ax + aw - u * 9.5, ay + u * 5.2, u * 6.2, u * 3.4, u * 1);
  ctx.lineWidth = u * 0.6;
  ctx.strokeStyle = rgba(0.85);
  ctx.stroke();
  rr(ctx, ax + aw - u * 8.8, ay + u * 5.9, u * 4.2, u * 2, u * 0.5);
  ctx.fill();
  const landscape = aw / ah > 1.25;
  // Ring gauge.
  const ringR = landscape ? ah * 0.27 : Math.min(aw * 0.3, ah * 0.2);
  const rcx = landscape ? ax + aw * 0.28 : ax + aw / 2;
  const rcy = landscape ? ay + ah * 0.55 : ay + ah * 0.34;
  ctx.lineCap = "round";
  ctx.lineWidth = ringR * 0.16;
  ctx.strokeStyle = rgba(0.18);
  ctx.beginPath();
  ctx.arc(rcx, rcy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  const grad = ctx.createLinearGradient(rcx - ringR, rcy - ringR, rcx + ringR, rcy + ringR);
  grad.addColorStop(0, rgba(1));
  grad.addColorStop(1, rgba(0.55));
  ctx.strokeStyle = grad;
  ctx.shadowColor = rgba(0.9);
  ctx.shadowBlur = ringR * 0.18;
  ctx.beginPath();
  ctx.arc(rcx, rcy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.72);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.font = font(ringR * 0.52, 700);
  ctx.fillText("72", rcx, rcy - ringR * 0.04);
  ctx.fillStyle = rgba(0.7);
  ctx.font = font(ringR * 0.17, 600);
  ctx.fillText("PERCENT", rcx, rcy + ringR * 0.38);
  ctx.textAlign = "left";
  // Stat bars.
  const bx = landscape ? ax + aw * 0.56 : ax + aw * 0.12;
  const bw = landscape ? aw * 0.36 : aw * 0.76;
  const by0 = landscape ? ay + ah * 0.3 : ay + ah * 0.6;
  const gapY = landscape ? ah * 0.17 : ah * 0.075;
  const bh = Math.max(4, u * 2.6);
  const fills = [0.82, 0.56, 0.68];
  for (let i = 0; i < 3; i++) {
    const y = by0 + i * gapY;
    ctx.fillStyle = rgba(0.6);
    ctx.font = font(u * 3.6, 600);
    ctx.fillText(["Energy", "Focus", "Flow"][i], bx, y - bh * 1.6);
    rr(ctx, bx, y, bw, bh, bh / 2);
    ctx.fillStyle = rgba(0.16);
    ctx.fill();
    rr(ctx, bx, y, bw * fills[i], bh, bh / 2);
    ctx.fillStyle = rgba(i === 0 ? 1 : 0.8);
    ctx.fill();
  }
  // Pill button.
  if (!landscape) {
    const pw = aw * 0.56, ph = Math.min(ah * 0.07, u * 13);
    const px = ax + (aw - pw) / 2, py = ay + ah * 0.87 - ph / 2;
    rr(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = rgba(0.95);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.textAlign = "center";
    ctx.font = font(ph * 0.42, 700);
    ctx.fillText("Start", px + pw / 2, py + ph / 2 + ph * 0.02);
    ctx.textAlign = "left";
    // Home indicator.
    rr(ctx, ax + aw * 0.36, ay + ah - u * 3.2, aw * 0.28, u * 1.1, u);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
  } else {
    // Soft glow dot row.
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(bx + i * u * 6, ay + ah * 0.86, u * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = rgba(i === 0 ? 1 : 0.3);
      ctx.fill();
    }
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function screenMaterial(glow: string, aspect: number, borderFrac: number): THREE.MeshPhysicalMaterial {
  const key = `${glow}|${aspect.toFixed(2)}|${borderFrac.toFixed(3)}`;
  let mat = screenMats.get(key);
  if (!mat) {
    const tex = screenTexture(glow, aspect, borderFrac);
    mat = new THREE.MeshPhysicalMaterial({
      color: "#040507", roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      emissive: "#FFFFFF", emissiveMap: tex, emissiveIntensity: 1.35,
    });
    screenMats.set(key, mat);
  }
  return mat;
}

export function screen(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const acc = new Acc();
  const mn = Math.min(W, H);
  const rc = mn * 0.14;
  acc.add(extrude(rrect(W, H, rc), 0.003, Math.min(0.0012, mn * 0.08), { curveSegs: 16, bevelSegs: 4 }), "main", { crease: 0.8 });
  const m1 = mn * 0.022;
  const Wg = W - 2 * m1, Hg = H - 2 * m1;
  const glass = extrude(rrect(Wg, Hg, Math.max(rc - m1, mn * 0.02)), 0.0016, Math.min(0.0006, mn * 0.05), { z0: 0.0024, curveSegs: 16, bevelSegs: 3 });
  const pos = glass.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / Wg + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / Hg + 0.5;
  }
  glass.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const aspect = Wg / Hg;
  const border = clamp((mn * 0.035) / Math.min(Wg, Hg), 0.01, 0.12);
  acc.add(glass, (m: PartMaterial) => screenMaterial(glowOf(m), aspect, border), { crease: 0.8, keepUV: true });
  return acc.finish();
}

// ---------- Solar panel ----------

function cellColor(m: PartMaterial): string {
  const c = new THREE.Color(glowOf(m));
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.s < 0.15) hsl.h = 0.62;
  return "#" + new THREE.Color().setHSL(hsl.h, Math.max(0.55, hsl.s), Math.min(0.13, hsl.l)).getHexString().toUpperCase();
}

export function solarPanel(p: Params): Piece[] {
  const W = p.width, H = p.height;
  const acc = new Acc();
  const mn = Math.min(W, H);
  const fw = clamp(mn * 0.035, 0.003, 0.04);
  const frame = rrect(W, H, fw * 0.5);
  frame.holes.push(rrectHole(W - 2 * fw, H - 2 * fw, fw * 0.15));
  acc.add(extrude(frame, 0.006, Math.min(fw * 0.25, 0.0012), { curveSegs: 6, bevelSegs: 3 }), M.brushed, { crease: 0.8 });
  // Inner lip of the frame.
  const lip = rrect(W - 2 * fw + 0.0002, H - 2 * fw + 0.0002, fw * 0.15);
  lip.holes.push(rrectHole(W - 2 * fw - fw * 0.5, H - 2 * fw - fw * 0.5, fw * 0.1));
  acc.add(extrude(lip, 0.0003, 0, { z0: 0.0043 }), M.brushed, { crease: 0.8 });
  // Backsheet visible between the cells.
  acc.add(rbox(W - 2 * fw + 0.002, H - 2 * fw + 0.002, 0.0038, 0.0005, 1).translate(0, 0, 0.0021), "main");
  // Cells.
  const margin = Math.max(0.002, fw * 0.6);
  const Wi = W - 2 * fw - 2 * margin, Hi = H - 2 * fw - 2 * margin;
  const target = clamp(Math.max(mn / 4.5, Math.max(W, H) / 40), 0.012, 0.16);
  const cols = Math.max(1, Math.round(Wi / target)), rows = Math.max(1, Math.round(Hi / target));
  const gap = Math.max(0.0006, target * 0.05);
  const cw = (Wi - (cols - 1) * gap) / cols, chh = (Hi - (rows - 1) * gap) / rows;
  const clip = Math.min(cw, chh) * 0.11;
  const oct = polyShape([
    [-cw / 2 + clip, -chh / 2], [cw / 2 - clip, -chh / 2], [cw / 2, -chh / 2 + clip], [cw / 2, chh / 2 - clip],
    [cw / 2 - clip, chh / 2], [-cw / 2 + clip, chh / 2], [-cw / 2, chh / 2 - clip], [-cw / 2, -chh / 2 + clip],
  ]);
  const cell = extrude(oct, 0.0003, 0, { z0: 0.004 });
  const cellsMat = (m: PartMaterial) => getMaterial({ preset: "plastic_gloss", color: cellColor(m), emissive: glowOf(m), emissiveIntensity: 0.06, roughness: 0.16, metalness: 0.35 });
  const busMat = { preset: "metal_polished", color: "#D5D8DE", roughness: 0.25 } as const;
  const fingerMat = { preset: "metal_brushed", color: "#7F8796" } as const;
  const nBus = cw > 0.02 ? 3 : 2;
  const nFing = Math.round(clamp(chh / 0.005, 4, 10));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -Wi / 2 + cw / 2 + i * (cw + gap);
      const y = -Hi / 2 + chh / 2 + j * (chh + gap);
      acc.add(cell.clone().translate(x, y, 0), cellsMat, { crease: 0.5 });
      for (let b = 0; b < nBus; b++) {
        const bx = x - cw / 2 + (cw * (b + 0.5)) / nBus;
        acc.add(new THREE.BoxGeometry(Math.max(0.0003, cw * 0.014), chh * 0.97, 0.00006).translate(bx, y, 0.00433), busMat);
      }
      for (let f = 0; f < nFing; f++) {
        const fy = y - chh / 2 + (chh * (f + 0.5)) / nFing;
        acc.add(new THREE.BoxGeometry(cw * 0.95, Math.max(0.00008, chh * 0.0035), 0.00003).translate(x, fy, 0.00431), fingerMat);
      }
    }
  }
  cell.dispose();
  return acc.finish();
}

// ---------- Camera lens ----------

let lensGlass: THREE.MeshPhysicalMaterial | null = null;
function lensMaterial(): THREE.MeshPhysicalMaterial {
  if (!lensGlass) {
    lensGlass = new THREE.MeshPhysicalMaterial({
      color: "#06080F", roughness: 0.02, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.0,
      iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 650], specularIntensity: 1, ior: 1.7,
    });
  }
  return lensGlass;
}

export function cameraLens(p: Params): Piece[] {
  const R = p.radius;
  const s = R / 0.008;
  const acc = new Acc();
  const ring: [number, number][] = [
    [0.745 * R, 0], [0.97 * R, 0], [R, 0.0005 * s], [R, 0.0036 * s], ...arcPts(R - 0.0009 * s, 0.0036 * s, 0.0009 * s, 0, Math.PI / 2, 5).slice(1),
    [0.84 * R, 0.0047 * s], ...arcPts(0.84 * R, 0.0043 * s, 0.0004 * s, Math.PI / 2, Math.PI, 3).slice(1), [0.785 * R, 0.0040 * s], [0.745 * R, 0.0036 * s],
  ];
  acc.add(latheZ([...ring, ring[0]], 72), "main", { crease: 0.7 });
  // Stepped black barrel.
  const barrel: [number, number][] = [
    [0.5 * R, 0], [0.75 * R, 0], [0.75 * R, 0.0035 * s], [0.70 * R, 0.0035 * s], [0.69 * R, 0.0030 * s], [0.62 * R, 0.0029 * s],
    [0.61 * R, 0.0024 * s], [0.54 * R, 0.0023 * s], [0.5 * R, 0.0020 * s],
  ];
  acc.add(latheZ([...barrel, barrel[0]], 72), M.blackPlastic, { crease: 0.6 });
  acc.add(new THREE.TorusGeometry(0.705 * R, 0.012 * R, 8, 72).translate(0, 0, 0.0034 * s), M.chrome);
  // Glass element.
  acc.add(domeZ(0.54 * R, 0.0011 * s, 56, 12).translate(0, 0, 0.0021 * s), () => lensMaterial());
  return acc.finish();
}

// ---------- Light bulb ----------

export function bulb(): Piece[] {
  const acc = new Acc();
  // Contact tip + black glass insulator.
  acc.add(lathe([[0, 0], [0.0034, 0], [0.0042, 0.0007], [0.0042, 0.0018], [0, 0.0018]], 40), M.brass, { crease: 0.6 });
  acc.add(lathe([[0, 0.0016], [0.0062, 0.0016], [0.0098, 0.0030], [0.0108, 0.0045], [0, 0.0045]], 48), M.blackGloss, { crease: 0.6 });
  // Threaded shell (E26-style helix).
  const prof: [number, number][] = [[0, 0.0040], [0.0104, 0.0040], [0.0122, 0.0048]];
  for (let y = 0.0054; y <= 0.0236; y += 0.0004) prof.push([0.0128, y]);
  prof.push([0.0127, 0.0244], [0.0121, 0.0250], [0.0121, 0.0256], [0.0125, 0.0262], [0, 0.0262]);
  const pitch = 0.0036;
  const shell = latheDisplaced(prof, 72, (th, y, r) => {
    if (r < 0.0127) return 0;
    const win = smoothstep(0.0054, 0.0068, y) * (1 - smoothstep(0.0222, 0.0236, y));
    return 0.00085 * win * Math.cos(((y / pitch) * Math.PI * 2) - th);
  });
  acc.add(shell, { preset: "metal_brushed", color: "#C4C7CD", roughness: 0.32 }, { crease: 1.0 });
  // Neck collar.
  acc.add(lathe([[0.0118, 0.0258], [0.0126, 0.0262], [0.0128, 0.0275], [0.0123, 0.0290], [0.0112, 0.0294], [0.0118, 0.0258]], 64), "main", { crease: 0.6 });
  // A-shape glass envelope (glowing, frosted).
  const ctrl = [
    [0.0112, 0.0285], [0.0124, 0.034], [0.0162, 0.043], [0.0222, 0.052], [0.0272, 0.062], [0.0297, 0.072], [0.0300, 0.078],
    [0.0292, 0.086], [0.0268, 0.094], [0.0218, 0.1015], [0.0148, 0.1068], [0.0075, 0.1094], [0.0, 0.1100],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const spline = new THREE.SplineCurve(ctrl);
  const env = spline.getSpacedPoints(48).map((v): [number, number] => [v.x, v.y]);
  env[env.length - 1] = [0, 0.11];
  acc.add(lathe(env, 72), glowMaterial(1.25, 0.45, 0.3));
  return acc.finish();
}

