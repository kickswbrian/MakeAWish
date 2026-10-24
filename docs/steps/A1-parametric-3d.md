# Step A1: Parametric 3D models and magic effects

Owner: A · Phase 1 (Fri 9:30pm to Sat 9am) · Runs in parallel with B1, B2, C1, C2. Work only in `web/`.

## Task
Build a `<WishModel spec={ProductSpec} heroUrl?={string} />` r3f component plus a `/debug` route: a JSON textarea for the spec on one side, the canvas on the other.

Models (all driven by `ProductSpec` from `shared`):
- **Mannequin:** stylized, smooth, neutral, no face.
- **Dress / skirt:** a `LatheGeometry` skirt whose radius curve comes from `silhouette` (fitted, a_line, wrap, flowy) and `length` (mini, knee, midi, maxi). Dress adds a bodice, with `neckline` variants and sleeve tubes for `sleeves`. A top is the bodice and sleeves only.
- **Backpack:** rounded body plus straps; `laptop_stand` feature shows a fold-out stand.
- **Helmet:** bike helmet shell; `headphones` feature adds ear cups.
- **Generic:** a glowing "wish orb" with orbiting sparkles (also the idle orb on the voice screen).
- **Material:** `MeshPhysicalMaterial`. Satin and knit use `sheen`; linen and cotton use higher roughness. `pattern` floral and stripe use a procedural/canvas texture tinted by `color`.
- **Features:** `phone_pockets` = visible pocket panels; `converts_to_skirt` = glowing waist seam that animates apart.
- **Hero swap:** when `heroUrl` is set, load the GLB with `useGLTF`, normalize its scale/center, dissolve the parametric model into particles, and re-form the particles as the GLB.

Effects and feel:
- First appearance: particles swirl in and assemble into the model (under 1 s).
- Every spec change: smooth 400 ms morph (color lerp, length/sleeve interpolation, never a pop), plus a shimmer burst on the changed part (use the `changed` list from `spec:updated`).
- Floating on a slowly turning pedestal, soft studio light, faint glow underneath, bloom via `@react-three/postprocessing`, `OrbitControls` drag to spin.
- Palette: lavender, mint, gold accents on a deep twilight background.
- 60 fps on a laptop: one canvas, instanced particles, no per-frame allocations.

Export small hooks the integration steps will need: `useOrbState('idle'|'listening'|'thinking'|'speaking', level)` for the orb to react to mic and voice volume.

## Done when
On `/debug`, editing the spec JSON (category, length, silhouette, sleeves, neckline, color, fabric, pockets) visibly changes the model in under 1 s with a morph and shimmer, at 60 fps.
