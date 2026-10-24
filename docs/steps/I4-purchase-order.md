# Step I4: Purchase order when funded

Owner: C · Phase 2 · Needs C1, C2 merged.

## Task
- When a campaign becomes `funded`, generate `maker_json`: a simulated maker. Use Apify `findMakers` results if P4 exists, otherwise a plausible stub picked by category. Include name, location and a contact link.
- Show the goal-hit celebration on every screen showing the campaign: full-screen confetti, golden glow, the product spins, and "Wish granted".
- Then show the purchase order view: PO number, spec table, model thumbnail (canvas snapshot or the GLB), maker, backer count, unit price, total captured, and the captured/failed status of each pledge.
- Label it clearly as a simulated order. Payments are real (test mode); manufacturing isn't.

## Done when
Hitting the goal shows the celebration and then the order screen, on both the laptop and the phone.
