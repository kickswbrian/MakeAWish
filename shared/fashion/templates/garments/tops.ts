import type { FashionTemplate } from "../../types.ts";
import { tankFitted } from "./tank_fitted.ts";
import { tankSport } from "./tank_sport.ts";
import { topBlouse } from "./top_blouse.ts";
import { topCropZip } from "./top_crop_zip.ts";
import { skirtMidi } from "./skirt_midi.ts";
import { skirtMini } from "./skirt_mini.ts";
import { skirtPleated } from "./skirt_pleated.ts";

/** Tops (and skirts) over prepared base models: one file per template in this folder, listed here. */
export const TOPS: (FashionTemplate | null)[] = [tankFitted, tankSport, topBlouse, topCropZip, skirtPleated, skirtMidi, skirtMini];
