import type { FashionTemplate } from "../../types.ts";
import { bagCanvas } from "./bag_canvas.ts";
import { bagCrossbody } from "./bag_crossbody.ts";
import { bagQuilted } from "./bag_quilted.ts";
import { bagShoulder } from "./bag_shoulder.ts";
import { toteLeather } from "./tote_leather.ts";

/** Bags over prepared base models: one file per template in this folder, listed here. */
export const BAGS: (FashionTemplate | null)[] = [toteLeather, bagQuilted, bagShoulder, bagCrossbody, bagCanvas];
