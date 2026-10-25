import { seedWorld } from "../src/worldSeed.ts";

/** Fill (or refresh) the Wish World with its demo wishes and votes:  npm run world:seed */
console.log(`[world] seeded ${seedWorld()} wishes with demo votes`);
