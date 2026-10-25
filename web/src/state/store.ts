import { create } from "zustand";
import { temporal } from "zundo";
import { applyPatches, emptyProduct, setMeta, type FashionState, type Patch, type Product, type ProductMeta } from "@wishit/shared";
import type { PartHit } from "../three/parts/ProductView.tsx";

/**
 * The product being designed, with undo/redo. Every user edit (a fast-path tweak, a gizmo drag,
 * or a whole genie turn however many patches it streams) is exactly one undo step.
 */
interface ProductState {
  product: Product;
  /** Bumped on every change (persisting, thumbnails). */
  rev: number;
  /** Bumped only by edits (not loads), so a freshly loaded product is never saved back over itself. */
  edits: number;
  /** Apply patches. Recorded as an undo step unless a turn is streaming (see beginTurn). */
  apply: (patches: Patch[]) => void;
  meta: (m: ProductMeta) => void;
  /** A fashion product's controls / slot materials (sent alongside the patches that re-cut it). */
  fashion: (f: FashionState) => void;
  /** Replace the whole product (load, reset, new design). Clears history when `fresh`. */
  load: (p: Product, fresh?: boolean) => void;
}

export const useProduct = create<ProductState>()(
  temporal(
    (set) => ({
      product: emptyProduct(),
      rev: 0,
      edits: 0,
      apply: (patches) =>
        set((s) => {
          if (!patches.length) return s;
          const r = applyPatches(s.product, patches);
          if (!r.applied.length) return s;
          return { product: r.product, rev: s.rev + 1, edits: s.edits + 1 };
        }),
      meta: (m) => set((s) => ({ product: setMeta(s.product, m), rev: s.rev + 1, edits: s.edits + 1 })),
      fashion: (f) => set((s) => ({ product: { ...s.product, fashion: f }, rev: s.rev + 1, edits: s.edits + 1 })),
      load: (p) => set((s) => ({ product: p, rev: s.rev + 1 })),
    }),
    {
      partialize: (s) => ({ product: s.product }),
      equality: (a, b) => a.product === b.product,
      limit: 80,
    },
  ),
);

const history = () => useProduct.temporal.getState();

/** Start a streamed genie turn: one undo step for everything it does until endTurn. */
export function beginTurn() {
  const h = history();
  h.resume();
  // Record the pre-turn state as the undo point, then stop recording the stream's patches.
  useProduct.setState((s) => ({ product: { ...s.product }, rev: s.rev }));
  h.pause();
}
export function endTurn() {
  history().resume();
}

export function loadFresh(p: Product) {
  const h = history();
  h.pause();
  useProduct.getState().load(p);
  h.clear();
  h.resume();
}

/** Undo/redo count as edits (they change what should be saved). */
export const undo = () => {
  history().undo();
  useProduct.setState((s) => ({ edits: s.edits + 1, rev: s.rev + 1 }));
};
export const redo = () => {
  history().redo();
  useProduct.setState((s) => ({ edits: s.edits + 1, rev: s.rev + 1 }));
};

// ---------- Selection and editor UI (not part of history) ----------

interface EditorState {
  selection: PartHit | null;
  /** Show the move/rotate/scale gizmo on the selected part. */
  gizmo: boolean;
  /** Re-run camera focus (e.g. after the selected part changed size). */
  focusKey: number;
  select: (hit: PartHit | null) => void;
  setGizmo: (on: boolean) => void;
  refocus: () => void;
}

export const useEditor = create<EditorState>()((set) => ({
  selection: null,
  gizmo: false,
  focusKey: 0,
  select: (hit) => set((s) => ({ selection: hit, gizmo: hit ? s.gizmo : false })),
  setGizmo: (on) => set({ gizmo: on }),
  refocus: () => set((s) => ({ focusKey: s.focusKey + 1 })),
}));

/** Drop the selection if its part disappeared (removed, undone). */
useProduct.subscribe((s) => {
  const sel = useEditor.getState().selection;
  if (sel && !s.product.parts[sel.partId]) useEditor.getState().select(null);
});
