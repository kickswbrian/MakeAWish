import type { TurnEvent, TurnRequest } from "@wishit/shared";

export type TurnBody = TurnRequest;

/**
 * POST a turn and read the newline-delimited event stream as it arrives. Resolves when the stream
 * ends. Abort the signal to cancel (the server stops the Claude calls too).
 */
export async function streamTurn(wishId: string, body: TurnBody, onEvent: (ev: TurnEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/wish/${wishId}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: { message?: string } }).error?.message ?? `Turn failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as TurnEvent);
      } catch {
        /* a torn line can't happen with \n framing; ignore junk */
      }
    }
  }
}

/**
 * A turn that may have started early (on Cartesia's eager end-of-turn guess). Events are held
 * back until the turn is confirmed, so a guess that turns out wrong never touches the model.
 */
export class PendingTurn {
  readonly controller = new AbortController();
  private held: TurnEvent[] = [];
  private live: ((ev: TurnEvent) => void) | null = null;
  readonly started = performance.now();
  readonly done: Promise<void>;
  error: Error | null = null;

  constructor(readonly wishId: string, readonly body: TurnBody) {
    this.done = streamTurn(wishId, body, (ev) => (this.live ? this.live(ev) : this.held.push(ev)), this.controller.signal).catch((err) => {
      if (!this.controller.signal.aborted) this.error = err as Error;
    });
  }

  /** Start delivering events (replays anything already received). */
  commit(onEvent: (ev: TurnEvent) => void) {
    this.live = onEvent;
    for (const ev of this.held.splice(0)) onEvent(ev);
  }

  cancel() {
    this.controller.abort();
  }
}

/** Same words, ignoring case and punctuation: is the final transcript what we guessed? */
export const sameUtterance = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  return n(a) === n(b);
};
