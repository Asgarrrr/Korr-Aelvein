/**
 * Public surface of the game module. External callers (WS handler, tests,
 * client-shared types via Eden) should import from here, not from the
 * internal sibling files. Internal files (`./tick`, `./ai`, `./abstract`,
 * `./state`, `./newGame`) import from each other directly to keep the
 * barrel's role single: a contract, not a control-flow hub.
 *
 * Deep-dive docs:
 *  - `docs/GAME-LOOP.md` — Phase 1-2 mental model.
 *  - `docs/LIVING-WORLD.md` — multi-zone architecture, Phase 3+ design.
 */

export { applyAbstract } from "./abstract";
export { runAi } from "./ai";
export { type AttackResult, attack } from "./combat";
export { newGame } from "./newGame";
export { updatePerception, VISION_RADIUS } from "./perception";
export {
  activeLevel,
  activeWorld,
  activeZoneStatus,
  entityAt,
  getZone,
} from "./state";
export { tick } from "./tick";
export { concretize, enterZone, parkActiveZone } from "./transition";
export type {
  Action,
  Dir,
  GameState,
  GlobalEvent,
  Time,
  ZoneId,
  ZoneStatus,
} from "./types";
