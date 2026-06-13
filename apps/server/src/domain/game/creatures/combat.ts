import {
  type EntityHandle,
  getComponent,
  setComponent,
  type World,
} from "../../ecs/index";
import type { Rng } from "../../rng/index";

/**
 * Outcome of one attack against `target`.
 *
 * `damage` is the **rolled** damage (the raw `rng.int(MIN, MAX)` result),
 * not the **applied** damage after the `Math.max(0, ...)` clamp. For an
 * overkill — target hp=1, damage=3 — the report is `{damage: 3, killed:
 * true}`, even though only 1 hp was actually consumed. UI consumers that
 * want "you dealt N damage" should clamp themselves: `min(damage, hp_pre)`.
 *
 * `killed` is `true` iff the new HP is ≤ 0 after damage — the caller
 * decides what to do with the dying entity (despawn for mobs, leave it at
 * hp=0 for the player so `gameOver` can be surfaced through the snapshot).
 */
export type AttackResult = {
  readonly damage: number;
  readonly killed: boolean;
};

/**
 * Damage range for a basic bump-attack. Fixed `(1, 3)` — no weapons, no
 * stats, no criticals; the only variability is the dice roll. The range
 * will move to an attacker-driven component when a weapon or strength
 * system appears.
 */
const MIN_DAMAGE = 1;
const MAX_DAMAGE = 3;

/**
 * Apply one bump-attack against `target`. Pure-on-world (no scheduler, no
 * `GameState`) so it can also be reused by Phase 6 abstract combat between
 * NPCs in dormant zones.
 *
 * Side effects: writes `target.hp` clamped to `[0, max]`. Does NOT despawn
 * — the caller decides. Throws if the target has no `hp` component, since
 * the project rule is "validate at boundaries"; an attacker trying to hit
 * something with no health is a state-machine bug, not gameplay.
 */
export function attack(
  world: World,
  rng: Rng,
  target: EntityHandle,
): AttackResult {
  const hp = getComponent(world, target, "hp");
  if (hp === undefined) {
    throw new Error("attack: target has no hp component");
  }
  const damage = rng.int(MIN_DAMAGE, MAX_DAMAGE);
  const newCurrent = Math.max(0, hp.current - damage);
  setComponent(world, target, "hp", { current: newCurrent, max: hp.max });
  return { damage, killed: newCurrent <= 0 };
}
