# Step P4: Stretch (only if P1 to P3 are done)

Owner: whoever is free · Phase 3 · Hard stop at the Sat 10pm freeze.

Pick one:
- **Apify `findMakers` mode:** add `mode: "findMakers"` to `wish-matcher` that searches for manufacturers of the category and returns 3 candidate makers. I4 uses the top one for the purchase order.
- **Sketch or photo input:** upload an image on the voice screen and send it to Claude as an image block with the current spec. The model returns an `update_spec` patch as usual.
- **Focus mode (nice to have): open the product up, zoom into a part and edit it directly.** Judges like to poke at one piece ("show me the pocket", "open it up"). Building blocks already in place on `judge-edits`:
  - Every editable piece is a `part:<name>` group in the scene (see `PARTS` in `shared/spec.ts`).
  - `web/src/three/anchors.ts` knows where each placement sits on every model.
  - `spec.parts`, `spec.decals` and `spec.addons` already hold per-part edits.

  What to build:
  1. **Zoom to a part.** Clicking a part (raycast, walk up to the `part:` group) or saying "zoom in on the straps" eases the camera to that part's anchor. The rest of the model dims, and Esc or "zoom out" returns.
  2. **Exploded view ("open it up").** Each part slides out along its pivot's outward normal by about 0.15 units, with labels from `PARTS`. Moving parts animate: the laptop stand folds out, the convertible seam separates, the front pocket unzips.
  3. **Scoped edits.** While a part is focused, voice and text edits apply to that part by default ("make it red" means `parts.<focused>.color`). The brain gets `focused: "<part>"` in the turn message.
  4. **Direct handles.** Drag a corner handle to set `parts.<name>.scale`; pick from a small swatch row for `parts.<name>.color`; drag a decal across the surface to snap it to the nearest placement; and a trash icon on decals and add-ons. Every handle writes the same spec patch the brain would, so undo, the eval and Meshy keep working.

  Done when: a judge can click the straps, see them come forward, drag them thicker, say "make these red", and zoom back out, all on the deployed URL.

## Done when
It works in the demo, or it's cut. Nothing half-done gets merged after 10pm.
