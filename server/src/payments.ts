import Stripe from "stripe";
import { env, paymentMode } from "./env.ts";
import { newId } from "./util.ts";

/**
 * One interface, two providers. Stripe test mode when keys are present; otherwise a simulated
 * provider that mimics PaymentIntent states (including the test-card declines) so the whole flow
 * runs offline. Both report back through the same handlers in campaigns.ts.
 */
export interface PaymentEvents {
  onHeld(paymentIntentId: string): void;
  onFailed(paymentIntentId: string, reason: string): void;
  onCaptured(paymentIntentId: string): void;
  onCanceled(paymentIntentId: string): void;
}

export type PIState = "created" | "held" | "failed" | "captured" | "canceled";

export interface Provider {
  mode: "stripe" | "mock";
  createHold(amountCents: number, metadata: Record<string, string>, email: string): Promise<{ id: string; clientSecret: string | null }>;
  capture(id: string, idempotencyKey: string): Promise<"captured" | "pending">;
  cancel(id: string, idempotencyKey: string): Promise<void>;
  /** Fallback for missed webhooks: read the real state. */
  retrieve(id: string): Promise<{ state: PIState; reason?: string }>;
}

let events: PaymentEvents;
export function bindPaymentEvents(e: PaymentEvents) {
  events = e;
}

export const stripe = env.stripeSecret ? new Stripe(env.stripeSecret) : null;

function stripeState(pi: Stripe.PaymentIntent): { state: PIState; reason?: string } {
  switch (pi.status) {
    case "requires_capture": return { state: "held" };
    case "succeeded": return { state: "captured" };
    case "canceled": return { state: "canceled" };
    case "requires_payment_method":
      return pi.last_payment_error ? { state: "failed", reason: pi.last_payment_error.message ?? "Card declined" } : { state: "created" };
    default: return { state: "created" };
  }
}

const stripeProvider: Provider = {
  mode: "stripe",
  async createHold(amount, metadata, email) {
    const pi = await stripe!.paymentIntents.create({
      amount,
      currency: "usd",
      capture_method: "manual",
      receipt_email: email,
      metadata,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `Wish it pledge ${metadata.campaignId}`,
    });
    return { id: pi.id, clientSecret: pi.client_secret };
  },
  async capture(id, idempotencyKey) {
    const pi = await stripe!.paymentIntents.capture(id, {}, { idempotencyKey });
    return pi.status === "succeeded" ? "captured" : "pending";
  },
  async cancel(id, idempotencyKey) {
    try {
      await stripe!.paymentIntents.cancel(id, {}, { idempotencyKey });
    } catch (err) {
      // Already canceled/succeeded is fine; anything else bubbles.
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
      const cur = await stripe!.paymentIntents.retrieve(id);
      if (cur.status !== "canceled") throw err;
    }
  },
  async retrieve(id) {
    return stripeState(await stripe!.paymentIntents.retrieve(id));
  },
};

/** In-memory simulated PaymentIntents. Lost on restart, which is fine for offline dev. */
const mockStore = new Map<string, { state: PIState; reason?: string; amount: number }>();
const later = (fn: () => void, ms = 250) => setTimeout(fn, ms);

const mockProvider: Provider = {
  mode: "mock",
  async createHold(amount) {
    const id = `pi_mock_${newId()}`;
    mockStore.set(id, { state: "created", amount });
    return { id, clientSecret: null };
  },
  async capture(id) {
    const pi = mockStore.get(id);
    if (!pi || pi.state !== "held") throw new Error(`cannot capture ${id} in state ${pi?.state}`);
    pi.state = "captured";
    later(() => events.onCaptured(id), 400);
    return "pending";
  },
  async cancel(id) {
    const pi = mockStore.get(id);
    if (!pi || pi.state === "canceled") return;
    pi.state = "canceled";
    later(() => events.onCanceled(id), 300);
  },
  async retrieve(id) {
    const pi = mockStore.get(id);
    return pi ? { state: pi.state, reason: pi.reason } : { state: "canceled" };
  },
};

/** Simulated card confirmation, mirroring Stripe's test cards. */
export function mockConfirm(id: string, card: string): { ok: boolean; reason?: string } {
  const pi = mockStore.get(id);
  if (!pi) return { ok: false, reason: "This pledge expired. Please start again." };
  if (pi.state !== "created") return { ok: pi.state === "held", reason: pi.reason };
  const digits = card.replace(/\D/g, "");
  let reason: string | undefined;
  if (digits.length < 12) reason = "Your card number is incomplete.";
  else if (digits.endsWith("0002")) reason = "Your card was declined.";
  else if (digits.endsWith("9995")) reason = "Your card has insufficient funds.";
  else if (digits.endsWith("0069")) reason = "Your card has expired.";
  if (reason) {
    pi.state = "failed";
    pi.reason = reason;
    later(() => events.onFailed(id, reason!));
    return { ok: false, reason };
  }
  pi.state = "held";
  later(() => events.onHeld(id));
  return { ok: true };
}

export const provider: Provider = paymentMode === "stripe" ? stripeProvider : mockProvider;

export function handleStripeEvent(event: Stripe.Event) {
  const pi = event.data.object as Stripe.PaymentIntent;
  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
      if (pi.status === "requires_capture") events.onHeld(pi.id);
      break;
    case "payment_intent.payment_failed":
      events.onFailed(pi.id, pi.last_payment_error?.message ?? "Card declined");
      break;
    case "payment_intent.succeeded":
      events.onCaptured(pi.id);
      break;
    case "payment_intent.canceled":
      events.onCanceled(pi.id);
      break;
  }
}
