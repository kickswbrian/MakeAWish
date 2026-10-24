import { env } from "./env.ts";

const API = "https://api.cartesia.ai";
const headers = () => ({
  Authorization: `Bearer ${env.cartesiaKey}`,
  "Cartesia-Version": env.cartesiaVersion,
  "Content-Type": "application/json",
});

/** Short-lived browser token with STT + TTS grants. The API key never leaves the server. */
export async function mintToken(): Promise<{ token: string; expiresAt: number }> {
  if (!env.cartesiaKey) throw new Error("CARTESIA_API_KEY not set");
  const expiresIn = 600;
  const res = await fetch(`${API}/access-token`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: expiresIn }),
  });
  if (!res.ok) throw new Error(`cartesia token ${res.status}: ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}

let voiceCache: { at: number; voices: unknown[] } | null = null;
export async function listVoices() {
  if (!env.cartesiaKey) return [];
  if (voiceCache && Date.now() - voiceCache.at < 3600_000) return voiceCache.voices;
  const res = await fetch(`${API}/voices?limit=100`, { headers: headers() });
  if (!res.ok) throw new Error(`cartesia voices ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; name: string; description?: string; language?: string }[] } | { id: string; name: string }[];
  const list = Array.isArray(body) ? body : body.data ?? [];
  const voices = list
    .filter((v: any) => !v.language || String(v.language).startsWith("en"))
    .map((v: any) => ({ id: v.id, name: v.name, description: v.description ?? "" }));
  voiceCache = { at: Date.now(), voices };
  return voices;
}
