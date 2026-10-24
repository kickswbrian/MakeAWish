# Step I1: Voice turns drive the 3D model

Owners: A + B · Phase 2 (Sat 9am to 3pm) · Needs A1, B1, B2 merged.

## Task
Build the voice screen (screen 1) at `/`:
- Top: "Wish it" logo left, wishlist heart right. Center: the sparkle orb (`WishModel` with category `generic`), reacting to `useVoice` state and levels (idle breathes, listening ripples with mic level, thinking swirls inward, speaking pulses).
- Under the orb, three example wishes cycle gently while idle. Tapping one submits it as a turn.
- Bottom: fading live captions for both sides, plus three controls: mute, type instead, end. Voice picker tucked in a corner.
- On first load, `POST /api/wish`. Each final transcript goes to `POST /api/wish/:id/turn`.
- Subscribe to `spec:updated` for this wish. The model updates on the socket event, and `speak(say)` starts only after that.
- On the first real spec, the orb bursts into particles that assemble into the product **in the same spot**. No route change.
- **Instant guess:** a small keyword matcher on interim captions (dress/skirt/top/backpack/helmet plus common color words) applies a local preview spec so particles start forming before the server replies. The server spec always wins.
- Play a soft sparkle hum while waiting on the brain, and a quick sparkle sound on each change.
- Hidden debug overlay (`?debug`) shows per-turn ms: end of speech, patch received, first audio.

## Done when
Saying "a midi dress", then "make it green", turns the model green with a shimmer, with under 1.5 s from end of speech to visible change.
