// CAVERNS style — cellular-automata cave generation.
//
// Public exports: the `CAVERNS` pipeline (consumed by the top-level
// `generateLevel` dispatcher) and the individual passes so test code in this
// folder can import them as siblings without going through `../../`.

import type { Pipeline } from "../../types";
import { connectComponents } from "./connect-components";
import { iterateCA } from "./iterate-ca";
import { placeCavernSpawn } from "./place-cavern-spawn";
import { placeCavernStairs } from "./place-cavern-stairs";
import { seedCA } from "./seed-ca";

export {
  connectComponents,
  iterateCA,
  placeCavernSpawn,
  placeCavernStairs,
  seedCA,
};

export const CAVERNS: Pipeline = [
  seedCA({ wallProbability: 0.45 }),
  iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
  connectComponents,
  placeCavernSpawn,
  placeCavernStairs,
];
