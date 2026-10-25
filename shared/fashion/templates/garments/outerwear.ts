import type { FashionTemplate } from "../../types.ts";
import { blazerClassic } from "./blazer_classic.ts";
import { blazerOversized } from "./blazer_oversized.ts";
import { jacketBomber } from "./jacket_bomber.ts";
import { jacketPuffer } from "./jacket_puffer.ts";

/** Outerwear over prepared base models: one file per template in this folder, listed here. */
export const OUTERWEAR: (FashionTemplate | null)[] = [blazerClassic, jacketBomber, blazerOversized, jacketPuffer];
