import type { Template } from "./index.ts";
import { backpack } from "./backpack.ts";
import { toteBag } from "./tote_bag.ts";
import { convertibleDress } from "./convertible_dress.ts";
import { sneaker } from "./sneaker.ts";
import { bikeHelmet } from "./bike_helmet.ts";
import { headphones } from "./headphones.ts";
import { speaker } from "./speaker.ts";
import { suitcase } from "./suitcase.ts";
import { deskLamp } from "./desk_lamp.ts";
import { waterBottle } from "./water_bottle.ts";
import { mug } from "./mug.ts";
import { planter } from "./planter.ts";
import { smartwatch } from "./smartwatch.ts";
import { sunglasses } from "./sunglasses.ts";
import { kettle } from "./kettle.ts";
import { umbrella } from "./umbrella.ts";
import { officeChair } from "./office_chair.ts";
import { skateboard } from "./skateboard.ts";
import { teddyBear } from "./teddy_bear.ts";
import { smartphone } from "./smartphone.ts";
import { hoodie } from "./hoodie.ts";
import { coffeeMaker } from "./coffee_maker.ts";
import { laptopStand } from "./laptop_stand.ts";
import { guitar } from "./guitar.ts";
import { sofa } from "./sofa.ts";
import { drone } from "./drone.ts";
import { keyboard } from "./keyboard.ts";
import { bicycle } from "./bicycle.ts";
import { DEMO_TEMPLATES } from "./demo.ts";

/** Every built-in template, in catalog order. */
export const ALL_TEMPLATES: Template[] = [
  backpack, toteBag, convertibleDress, sneaker, bikeHelmet, headphones, speaker, suitcase, deskLamp, waterBottle, mug, planter, smartwatch, sunglasses, kettle, umbrella, officeChair, skateboard, teddyBear, smartphone,
  hoodie, coffeeMaker, laptopStand, guitar, sofa, drone, keyboard, bicycle, ...DEMO_TEMPLATES,
].filter((t): t is Template => !!t);
