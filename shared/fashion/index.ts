import { registerTemplates, setFashionDefaults } from "../templates/index.ts";
import { compileOutfit, fashionById, registerFashion, resolveControls } from "./compile.ts";
import type { FashionTemplate } from "./types.ts";
import { FASHION_TEMPLATES } from "./templates/all.ts";
import { GARMENT_TEMPLATES } from "./templates/garments.ts";
import { classifyWish } from "./classify.ts";
import { setStyler } from "./local.ts";
import { styleOutfit } from "./style-compiler.ts";

export * from "./types.ts";
export * from "./compile.ts";
export * from "./deform.ts";
export * from "./local.ts";
export * from "./styles.ts";
export * from "./classify.ts";
export * from "./style-compiler.ts";

/**
 * Fashion templates are also plain templates (same keyword matching, instant display): their
 * standard version is compiled from the defaults.
 */
export function installFashion(list: FashionTemplate[]): void {
  registerFashion(list);
  registerTemplates(
    list.flatMap((t) => {
      const c = compileOutfit({ template: t.id });
      if (!c) return [];
      return [{ id: t.id, name: t.name, keywords: t.keywords, category: t.category, description: t.description, targetPriceUsd: t.targetPriceUsd, parts: c.parts, fashion: t.id }];
    }),
  );
}

setFashionDefaults((id) => {
  const t = fashionById(id);
  return t ? resolveControls(t) : {};
});
installFashion([...GARMENT_TEMPLATES, ...FASHION_TEMPLATES]);

// The instant outfit for a wish: classify it (styles, colors, fabrics, controls), then compile.
setStyler((text, templateId) => styleOutfit(templateId, classifyWish(text)));
