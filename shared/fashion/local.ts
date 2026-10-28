import type { OutfitSpec } from "./types.ts";

/**
 * The instant, no-LLM outfit for a wish: what the client shows the moment a fashion wish is heard
 * (and what the offline genie builds). Uses the style compiler once it is installed.
 */
let styler: ((text: string, templateId: string) => OutfitSpec) | null = null;

export function setStyler(fn: (text: string, templateId: string) => OutfitSpec): void {
  styler = fn;
}

export function localOutfit(text: string, templateId: string): OutfitSpec {
  try {
    if (styler) return styler(text, templateId);
  } catch (err) {
    console.warn("[fashion] style compiler failed, using the template default", err);
  }
  return { template: templateId };
}
