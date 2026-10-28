import type { FashionTemplate } from "../types.ts";
import { earrings } from "./earrings.ts";
import { necklace } from "./necklace.ts";
import { bracelet } from "./bracelet.ts";

/** Every fashion template, hero categories first. */
export const FASHION_TEMPLATES: FashionTemplate[] = [earrings, necklace, bracelet];
