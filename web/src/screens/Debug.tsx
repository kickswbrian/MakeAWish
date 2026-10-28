import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fashionById, outfitProduct, parseProduct, TEMPLATES, templateProduct, type OutfitSpec, type Product } from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { PartRegistry, type PartHit } from "../three/parts/ProductView.tsx";
import { sendView } from "../three/signals.ts";

/**
 * 3D bench: load a template, a bench result (?src=/bench/lamp.json) or paste product JSON, and
 * inspect it with the real stage (tap parts to see their ids).
 * Fashion templates: `?t=jacket&c.length=cropped&c.fit=oversized` sets controls, and
 * `?spec=<url-encoded OutfitSpec JSON>` loads a whole outfit (template, materials, modules).
 * Screenshots (with `bare`): `still` (no motion), `focus=<part id>` (zoom to it),
 * `view=front,zoom_in` (camera commands, one every 0.4 s after load).
 */
export default function Debug() {
  const [params, setParams] = useSearchParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [hit, setHit] = useState<PartHit | null>(null);
  const [key, setKey] = useState(0);
  const registry = useMemo(() => new PartRegistry(), []);
  const src = params.get("src");
  const tpl = params.get("t");
  const bare = params.has("bare");

  const load = (p: Product | null) => {
    if (!p) return setErr("Could not read that product");
    setErr(null);
    setProduct(p);
    setText(JSON.stringify(p, null, 1));
    setKey((k) => k + 1);
  };

  useEffect(() => {
    if (src) {
      void fetch(src).then((r) => r.json()).then((j) => load(parseProduct(j))).catch(() => setErr(`Could not load ${src}`));
    } else if (params.get("spec")) {
      try {
        load(outfitProduct(JSON.parse(params.get("spec")!) as OutfitSpec, "debug"));
      } catch {
        setErr("Bad spec JSON");
      }
    } else if (tpl && fashionById(tpl)) {
      const controls: Record<string, string> = {};
      for (const [k, v] of params.entries()) if (k.startsWith("c.")) controls[k.slice(2)] = v;
      load(outfitProduct({ template: tpl, controls }, "debug"));
    } else {
      const t = TEMPLATES.find((x) => x.id === tpl) ?? TEMPLATES[0];
      if (t) load(templateProduct(t));
    }
  }, [src, tpl, params]);

  useEffect(() => {
    const views = params.get("view")?.split(",").filter(Boolean) ?? [];
    const timers = views.map((v, i) => setTimeout(() => sendView(v as Parameters<typeof sendView>[0]), 1200 + i * 400));
    return () => timers.forEach(clearTimeout);
  }, [params, key]);

  if (bare) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 40%, #FFFFFF, #FFFCF7 55%, #EEF4F1)" }}>
        {product && <Stage key={key} product={product} framing="debug" transparent registry={registry} effects={!params.has("noeffects")} pedestal={!params.has("nopedestal")} animate={!params.has("still")} selectedId={hit?.partId ?? params.get("focus")} onHit={setHit} onMiss={() => setHit(null)} />}
      </div>
    );
  }

  return (
    <div className="debug-page">
      <aside className="debug-side">
        <h2 className="title-m">3D bench</h2>
        <div className="chips-wrap">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`chip sm ${tpl === t.id ? "on" : ""}`} onClick={() => setParams({ t: t.id })}>{t.name}</button>
          ))}
        </div>
        {hit && (
          <div className="msg">
            <b>{hit.partId}</b> · point [{hit.point.join(", ")}] · normal [{hit.normal.join(", ")}]
          </div>
        )}
        {err && <div className="msg bad">{err}</div>}
        <textarea
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const p = parseProduct(JSON.parse(e.target.value));
              if (p) {
                setProduct(p);
                setErr(null);
              }
            } catch {
              setErr("Not valid JSON yet");
            }
          }}
        />
      </aside>
      <main className="debug-stage">
        {product && <Stage key={key} product={product} framing="debug" registry={registry} selectedId={hit?.partId ?? null} onHit={setHit} onMiss={() => setHit(null)} />}
      </main>
    </div>
  );
}
