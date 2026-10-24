import crypto from "node:crypto";
import { customAlphabet } from "nanoid";

export const newId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 10);
export const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(4, u.length - 1)))}@${d ?? ""}`;
}
