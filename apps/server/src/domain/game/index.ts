/**
 * Public surface of the game module. External callers (WS handler, tests,
 * client-shared types via Eden) should import from here, not from the
 * internal files. Internal modules (`./tick`, `./creatures`, `./zones`,
 * `./state`, …) import from each other directly to keep the barrel's role
 * single: a contract, not a control-flow hub.
 *
 * Deep-dive docs:
 *  - `docs/GAME-LOOP.md` — Phase 1-2 mental model.
 *  - `docs/LIVING-WORLD.md` — multi-zone architecture, Phase 3+ design.
 */

export { type Brand, type ZoneId, zoneId } from "./brands";
export { type AttackResult, attack, runAi } from "./creatures";
export { updatePerception, VISION_RADIUS } from "./perception";
export {
  activeLevel,
  activeWorld,
  activeZoneStatus,
  entityAt,
  getZone,
} from "./state";
export { tick } from "./tick";
export type {
  Action,
  Dir,
  GameState,
  GlobalEvent,
  Time,
  ZoneStatus,
} from "./types";
export {
  applyAbstract,
  concretize,
  enterZone,
  newGame,
  parkActiveZone,
} from "./zones";
