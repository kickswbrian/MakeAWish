# Step B1: Voice client (Cartesia STT + TTS)

Owner: B · Phase 1 · Runs in parallel with A1, C1, C2.

## Before writing any code
Fetch `https://docs.cartesia.ai/llms.txt` and read the pages for STT streaming (Ink 2), TTS websocket streaming (Sonic 3.5), and access tokens. Use the exact model ids, event names and `Cartesia-Version` header value the docs give, even if they differ from the names below. **Do not use Cartesia Line.**

## Task
- **Server:** `GET /api/cartesia/token` mints a short-lived access token with `CARTESIA_API_KEY`. The API key never reaches the browser. Send the `Cartesia-Version` header on every Cartesia request.
- **Browser** (`web/src/voice/`):
  1. Mic → AudioWorklet → 16 kHz PCM → Cartesia STT websocket (`ink-2`) using the token.
  2. Show interim and final transcript live. Expose the interim text so the I1 step can run a keyword guesser on it.
  3. On end of turn, call `onTurn(finalText)`. For this step, a stub echoes "You said: …".
  4. Speak the reply with Sonic 3.5 over websocket, streaming playback through Web Audio. Tune voice speed and emotion via `generation_config`. Add a small voice picker with 3 candidate voices.
  5. **Barge-in:** if the user starts talking while TTS is playing, stop playback immediately.
  6. Expose mic level and TTS output level for the orb.
  7. Fallbacks: push-to-talk button and a text box that calls the same `onTurn`.
- Put it behind a `useVoice()` hook: `{ state, interim, captions, micLevel, speakLevel, speak(text), stop(), mute }`.
- Log timing: end of speech → first audio byte.

## Done when
Speak a sentence, see the transcript, and hear the echoed reply start in under 1.5 s. Talking over the reply stops it.
