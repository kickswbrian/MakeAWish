/**
 * Reset the demo to its starting state.
 *   npm run demo:reset -- --planter-deadline=120
 *   npm run demo:reset -- --remote=https://wishit.example.com --planter-deadline=180
 * Talks to the running server (local by default), so it works the same against the deploy.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const base = (arg("remote") ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
const planterDeadlineSecs = Number(arg("planter-deadline") ?? 120);

const res = await fetch(`${base}/api/admin/demo/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(process.env.ADMIN_TOKEN ? { "x-admin-token": process.env.ADMIN_TOKEN } : {}) },
  body: JSON.stringify({ planterDeadlineSecs }),
}).catch((e: Error) => {
  console.error(`Could not reach ${base}: ${e.message}\nIs the server running? (npm run dev, or pass --remote=<url>)`);
  process.exit(1);
});
const body = (await res.json()) as any;
if (!res.ok) {
  console.error(`Reset failed (${res.status}): ${body.error ?? JSON.stringify(body)}`);
  process.exit(1);
}

const deadline = new Date(body.planterDeadlineAt).toLocaleTimeString();
console.log(`
✦ Wish it demo reset (${base})
  payments: ${body.paymentMode}${body.paymentMode === "stripe" ? " (test mode)" : " (simulated)"}   demoMode: ${body.demoMode}   apify: ${body.apifyCache}

  Studio (start here)      ${body.urls.studio}
  Demo wish, pre-warmed    ${body.urls.demoWish}
  Planter, laptop + admin  ${body.urls.planterLaptop}
  Planter, phone           ${body.urls.planterPhone}
  Wishlist                 ${body.urls.wishlist}

  Planter: 2 of 4 holds placed, deadline ${deadline} (${planterDeadlineSecs}s from now).

Checklist
  [ ] Mic tested, volume up, headset or lapel mic on
  [ ] Phone hotspot ready as backup Wi-Fi
  [ ] Stripe dashboard open in a background tab, test mode, Payments filtered to "Uncaptured"
  [ ] Teammate's phone ready with decline card 4000 0000 0000 0002
  [ ] Planter tab open on the laptop with ?admin (Force deadline button as backup)
`);
export {};
