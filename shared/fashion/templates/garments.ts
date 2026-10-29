import type { FashionTemplate } from "../types.ts";
import { tote } from "./tote.ts";
import { jacketTrucker } from "./garments/jacket_trucker.ts";
import { cardiganKnit } from "./garments/cardigan_knit.ts";
import { BAGS } from "./garments/bags.ts";
import { BOTTOMS } from "./garments/bottoms.ts";
import { OUTERWEAR } from "./garments/outerwear.ts";
import { TOPS } from "./garments/tops.ts";

/**
 * Garment and bag templates over prepared base models (see tools/prep-garments). A template whose
 * model hasn't been prepared yet is simply absent.
 */
export const GARMENT_TEMPLATES: FashionTemplate[] = [tote, jacketTrucker, cardiganKnit, ...OUTERWEAR, ...BOTTOMS, ...TOPS, ...BAGS].filter((t): t is FashionTemplate => !!t);
