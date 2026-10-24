import { useMemo, useState } from "react";
import { childrenOf, MATERIAL_LABELS, type Part, type Product } from "@wishit/shared";

/**
 * The parts tree, for picking parts that are too small or hidden to tap (a screw, an inner liner).
 * Indented by parent, with a swatch per part. Choosing one selects it and flies the camera there.
 */
export function PartsList({ product, selectedId, onPick }: { product: Product; selectedId: string | null; onPick: (p: Part) => void }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const out: { part: Part; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      const p = product.parts[id];
      if (!p || p.csg) return;
      out.push({ part: p, depth });
      for (const c of childrenOf(product, id)) walk(c.id, depth + 1);
    };
    walk(product.rootId, 0);
    return out;
  }, [product]);

  return (
    <div className="plist-wrap">
      <button className={`ebar-label as-btn ${open ? "on" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {rows.length} parts
      </button>
      {open && (
        <div className="plist" role="listbox" aria-label="Parts">
          {rows.map(({ part, depth }) => (
            <button
              key={part.id}
              role="option"
              aria-selected={part.id === selectedId}
              className={`prow ${part.id === selectedId ? "on" : ""}`}
              style={{ paddingLeft: 10 + Math.min(depth, 5) * 14 }}
              onClick={() => {
                onPick(part);
                setOpen(false);
              }}
            >
              <span className="prow-sw" style={{ background: part.material.color }} />
              <span className="prow-name">{part.name}</span>
              <span className="prow-meta">{part.kind === "kit" ? "kit" : MATERIAL_LABELS[part.material.preset]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
