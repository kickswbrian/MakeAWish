import type { FashionTemplate } from "../../types.ts";
import { jeansBaggy } from "./jeans_baggy.ts";
import { jeansSlim } from "./jeans_slim.ts";
import { pantsCargo } from "./pants_cargo.ts";
import { pantsStraight } from "./pants_straight.ts";
import { pantsSuit } from "./pants_suit.ts";

/** Bottoms over prepared base models: one file per template in this folder, listed here. */
export const BOTTOMS: (FashionTemplate | null)[] = [jeansBaggy, jeansSlim, pantsCargo, pantsStraight, pantsSuit];
