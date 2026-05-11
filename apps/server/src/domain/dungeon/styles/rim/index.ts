// RIM style — Brogue-inspired room accretion + addLoops + placeStairs.
//
// Public exports: the `RIM` pipeline (consumed by the top-level
// `generateLevel` dispatcher) and the individual passes so test code in this
// folder can import them as siblings without going through `../../`.

import type { Pipeline } from "../../types";
import { accreteRooms } from "./accrete-rooms";
import { addLoops } from "./add-loops";
import { placeFirstRoom } from "./place-first-room";
import { placeStairs } from "./place-stairs";

export { accreteRooms, addLoops, placeFirstRoom, placeStairs };

export const RIM: Pipeline = [
  placeFirstRoom({ minSize: 5, maxSize: 9 }),
  accreteRooms({ maxAttempts: 400, maxRooms: 25, minSize: 4, maxSize: 8 }),
  addLoops({ maxAttempts: 200, maxLoops: 15, minPathDistance: 5 }),
  placeStairs,
];
