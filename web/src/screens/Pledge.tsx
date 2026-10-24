import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { EVENTS, type Campaign, type CampaignUpdatedPayload, type PledgeStatus } from "@wishit/shared";
import { api, getConfig, money } from "../lib/api.ts";
import { useRoom, useSocketEvent } from "../lib/socket.ts";
import { pref, setPref } from "../lib/wishlist.ts";
import { fanfare } from "../lib/sound.ts";
import { Celebration, Countdown, DemandBar, PurchaseOrder } from "../ui/Campaign.tsx";

const Stage = lazy(() => import("../three/Stage.tsx"));

let stripePromise: Promise<Stripe | null> | null = null;

type Step = "email" | "card" | "placing" | "done";

const TEST_CARDS = [
  { label: "4242 works", number: "4242 4242 4242 4242" },
  { label: "0002 declines", number: "4000 0000 0000 0002" },
  { label: "9995 no funds", number: "4000 0000 0000 9995" },
];

/** Mobile pledge page: email, card, hold. Nothing is charged unless the wish is funded. */
export default function Pledge() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Campaign | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<"stripe" | "mock" | null>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(pref("email", ""));
  const [pledgeId, setPledgeId] = useState<string | null>(pref(`pledge:${id}`, null));
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<PledgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);

  useEffect(() => {
    void api.campaign(id).then(setC).catch(() => setMissing(true));
    void getConfig().then((cfg) => {
      setMode(cfg.paymentMode);
      if (cfg.paymentMode === "stripe" && cfg.stripePublishableKey) stripePromise ??= loadStripe(cfg.stripePublishableKey);
    });
    // Let the text paint first; the 3D product loads right after.
    const t = setTimeout(() => setShowStage(true), 150);
    return () => clearTimeout(t);
  }, [id]);

  useRoom(`campaign:${id}`);
  useSocketEvent<CampaignUpdatedPayload>(EVENTS.campaignUpdated, (p) => {
    if (p.campaign.id !== id) return;
    setC(p.campaign);
    const mine = pledgeId && p.campaign.pledges.find((x) => x.id === pledgeId);
    if (mine) setMyStatus(mine.status);
  });

  const prevStatus = useRef<Campaign["status"] | null>(null);
  useEffect(() => {
    if (!c) return;
    if (prevStatus.current && prevStatus.current !== "funded" && c.status === "funded") {
      setCelebrate(true);
      setCelebrateKey((k) => k + 1);
      fanfare();
    }
    prevStatus.current = c.status;
  }, [c?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (!pledgeId) return;
    const s = await api.pledgeStatus(pledgeId).catch(() => null);
    if (!s) return;
    setMyStatus(s.status as PledgeStatus);
    if (s.status === "failed") setError(s.failReason ?? "Your card was declined.");
  }, [pledgeId]);

  // Restore a returning backer, and poll every 3 s as a fallback for slow webhooks.
  useEffect(() => {
    if (!pledgeId) return;
    void refresh();
    const t = setInterval(() => {
      if (myStatus === "created" || myStatus === "held" || myStatus === null) void refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [pledgeId, myStatus, refresh]);

  useEffect(() => {
    if (myStatus && myStatus !== "created" && myStatus !== "failed") setStep("done");
    if (myStatus === "failed") setStep("card");
  }, [myStatus]);

  const startPledge = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Please enter a valid email.");
    setBusy(true);
    setError(null);
    try {
      setPref("email", email);
      const p = await api.pledge(id, email);
      setPledgeId(p.pledgeId);
      setPref(`pledge:${id}`, p.pledgeId);
      setMyStatus("created");
      setClientSecret(p.clientSecret);
      setStep("card");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onHoldPlaced = () => {
    setStep("placing");
    setError(null);
    void refresh();
  };
  const onDeclined = (msg: string) => {
    setError(msg);
    setStep("card");
  };
  const tryAgain = () => {
    setPledgeId(null);
    setPref(`pledge:${id}`, null);
    setMyStatus(null);
    setClientSecret(null);
    setError(null);
    setStep("email");
  };

  if (missing) {
    return (
      <div className="pledge-page">
        <div className="pledge-card glass">
          <h1>This wish has vanished</h1>
          <p className="fineprint">We couldn't find that campaign. <Link to="/">Make a wish of your own</Link>.</p>
        </div>
      </div>
    );
  }
  if (!c) return <div className="boot"><div className="boot-orb" /></div>;

  const open = c.status === "funding";
  const mine = pledgeId ? c.pledges.find((p) => p.id === pledgeId) : null;
  const status = myStatus ?? mine?.status ?? null;

  return (
    <div className="pledge-page">
      {celebrate && <Celebration onDone={() => setCelebrate(false)} />}
      <div className="pledge-hero glass">
        <div className="mini-stage">
          {showStage && (
            <Suspense fallback={null}>
              <Stage spec={c.spec} heroUrl={c.modelUrl} framing="mini" celebrateKey={celebrateKey} bloom={false} />
            </Suspense>
          )}
        </div>
      </div>

      {c.status === "funded" && status === "captured" ? null : (
        <div className="pledge-card glass">
          <div>
            <h1>{c.name}</h1>
            <div className="price-line" style={{ marginTop: 6 }}>
              {money(c.priceCents)} · charged only if {c.targetBackers} people commit
            </div>
          </div>
          <DemandBar c={c} />
          <Countdown to={c.deadlineAt} status={c.status} />

          {status === "held" && open && (
            <div className="pledge-msg ok">
              <b>Hold placed.</b> You'll only be charged {money(c.priceCents)} if this gets made. Your bank may show it as pending.
            </div>
          )}
          {step === "placing" && status !== "held" && status !== "failed" && (
            <div className="pledge-msg info">Confirming your hold with the bank…</div>
          )}
          {status === "released" && <div className="pledge-msg info"><b>Released, you were not charged.</b> The wish didn't reach its goal in time.</div>}
          {status === "capture_failed" && <div className="pledge-msg bad">We couldn't capture your hold (it may have expired). You were not charged.</div>}
          {(c.status === "capturing" || (c.status === "funded" && status !== "captured")) && status === "held" && (
            <div className="pledge-msg ok">Goal reached! Capturing holds…</div>
          )}

          {open && !status && step === "email" && (
            <>
              <div className="field">
                <label>Your email</label>
                <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <div className="pledge-msg bad">{error}</div>}
              <button className="btn primary block" disabled={busy} onClick={startPledge}>
                I want this too ✨
              </button>
            </>
          )}

          {open && step === "card" && (status === "created" || status === "failed") && (
            <>
              {status === "failed" ? (
                <>
                  <div className="pledge-msg bad">{error ?? "Your card was declined."} Your pledge wasn't counted.</div>
                  <button className="btn block" onClick={tryAgain}>Try another card</button>
                </>
              ) : mode === "stripe" && clientSecret && stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "night",
                      variables: { colorPrimary: "#b9a3f0", colorBackground: "#1d1640", borderRadius: "14px", fontFamily: "Inter, system-ui, sans-serif" },
                    },
                  }}
                >
                  <StripeForm price={money(c.priceCents)} onHeld={onHoldPlaced} onDeclined={onDeclined} />
                </Elements>
              ) : mode === "mock" && pledgeId ? (
                <MockCardForm pledgeId={pledgeId} price={money(c.priceCents)} onHeld={onHoldPlaced} onDeclined={onDeclined} />
              ) : (
                <div className="pledge-msg info">Your pledge session expired. <button className="btn" onClick={tryAgain}>Start again</button></div>
              )}
              {error && status !== "failed" && <div className="pledge-msg bad">{error}</div>}
            </>
          )}

          {!open && !status && c.status !== "funded" && (
            <div className="pledge-msg info">This wish is no longer taking pledges.</div>
          )}

          <p className="fineprint">
            This places a card hold, not a charge. If the goal isn't reached by the deadline, the hold is released automatically.
            {mode === "mock" && " Payments are simulated on this server (no Stripe keys configured)."}
            {mode === "stripe" && " Stripe test mode: use test card 4242 4242 4242 4242."}
          </p>
        </div>
      )}

      {c.status === "funded" && (
        <>
          {status === "captured" && (
            <div className="pledge-msg ok">
              <b>Wish granted!</b> Your card was charged {money(c.priceCents)}. The order is on its way to the maker.
            </div>
          )}
          <PurchaseOrder c={c} />
        </>
      )}
      <Link to="/" className="next-wish">Make a wish of your own ✦</Link>
    </div>
  );
}

function StripeForm({ price, onHeld, onDeclined }: { price: string; onHeld: () => void; onDeclined: (m: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    setBusy(false);
    if (error) onDeclined(error.message ?? "Your card was declined.");
    else if (paymentIntent?.status === "requires_capture" || paymentIntent?.status === "processing") onHeld();
    else onHeld();
  };
  return (
    <>
      <PaymentElement options={{ layout: "tabs" }} />
      <button className="btn primary block" disabled={busy || !stripe} onClick={submit}>
        {busy ? "Placing hold…" : `Place a ${price} hold`}
      </button>
    </>
  );
}

function MockCardForm({ pledgeId, price, onHeld, onDeclined }: { pledgeId: string; price: string; onHeld: () => void; onDeclined: (m: string) => void }) {
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("12/34");
  const [cvc, setCvc] = useState("123");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    setBusy(true);
    const r = await api.mockConfirm(pledgeId, card).catch((e) => ({ ok: false, reason: (e as Error).message }));
    setBusy(false);
    if (r.ok) onHeld();
    else onDeclined(r.reason ?? "Your card was declined.");
  };
  const fmt = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  return (
    <>
      <div className="field">
        <label>Card (test numbers only)</label>
        <div className="card-row">
          <input ref={input} inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" value={card} onChange={(e) => setCard(fmt(e.target.value))} />
          <input inputMode="numeric" placeholder="MM/YY" value={exp} onChange={(e) => setExp(e.target.value)} />
          <input inputMode="numeric" placeholder="CVC" value={cvc} onChange={(e) => setCvc(e.target.value)} />
        </div>
      </div>
      <div className="test-cards">
        {TEST_CARDS.map((t) => (
          <button key={t.number} onClick={() => setCard(t.number)}>{t.label}</button>
        ))}
      </div>
      <button className="btn primary block" disabled={busy} onClick={submit}>
        {busy ? "Placing hold…" : `Place a ${price} hold`}
      </button>
    </>
  );
}
