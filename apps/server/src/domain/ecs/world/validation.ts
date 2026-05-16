// Boundary validation + per-component cloning.
//
// Components are stored by value (defensive shallow copy). Without this, a
// caller's `const p = {x:1,y:2}; spawn(w, {position:p}); p.x = 99` would
// silently mutate world state through an aliased reference — the `readonly`
// modifier on the public types is a compile-time hint, not a runtime guard.
//
// Validation rejects NaN / Infinity at boundary. JSON.stringify masks NaN
// to `null` and the snapshot would survive but the restored value would
// not match `Position.x: number`, breaking determinism downstream.

import type {
  Actor,
  Ai,
  ComponentKey,
  Components,
  HP,
  Position,
  Schedule,
} from "../components";
import type { EntityId, Generation } from "../entity";

export const MAX_SAFE_GENERATION = 0x7fff_ffff; // 2^31 - 1

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: expected finite number, got ${value}`);
  }
}

export function cloneAndValidatePosition(v: Position): Position {
  assertFinite("position.x", v.x);
  assertFinite("position.y", v.y);
  return { x: v.x, y: v.y };
}

export function cloneActor(v: Actor): Actor {
  return { glyph: v.glyph, name: v.name };
}

export function cloneAndValidateHP(v: HP): HP {
  assertFinite("hp.current", v.current);
  assertFinite("hp.max", v.max);
  return { current: v.current, max: v.max };
}

export function cloneAi(v: Ai): Ai {
  // The discriminant string IS the payload — a corrupt snapshot with
  // `{kind:"garbage"}` would silently restore and dead-end in `runAi`'s
  // exhaustive switch. Validate at the boundary, same policy as the
  // numeric cloners reject NaN/Infinity.
  if (v.kind !== "wanderer") {
    throw new Error(`cloneAi: unknown ai kind "${v.kind}"`);
  }
  return { kind: v.kind };
}

export function cloneAndValidateSchedule(v: Schedule): Schedule {
  if (!Array.isArray(v.waypoints) || v.waypoints.length === 0) {
    throw new Error("schedule.waypoints: must be a non-empty array");
  }
  if (!Number.isInteger(v.period) || v.period <= 0) {
    throw new Error(
      `schedule.period: expected positive integer, got ${v.period}`,
    );
  }
  if (
    !Number.isInteger(v.nextIndex) ||
    v.nextIndex < 0 ||
    v.nextIndex >= v.waypoints.length
  ) {
    throw new Error(
      `schedule.nextIndex: expected integer in [0, ${v.waypoints.length}), got ${v.nextIndex}`,
    );
  }
  const cloned: Array<readonly [number, number]> = [];
  for (const [i, pt] of v.waypoints.entries()) {
    if (!Array.isArray(pt) || pt.length !== 2) {
      throw new Error(
        `schedule.waypoints[${i}]: expected [number, number] tuple`,
      );
    }
    const [x, y] = pt;
    assertFinite(`schedule.waypoints[${i}].x`, x);
    assertFinite(`schedule.waypoints[${i}].y`, y);
    cloned.push([x, y]);
  }
  return { waypoints: cloned, nextIndex: v.nextIndex, period: v.period };
}

export function assertSafeGeneration(id: EntityId, gen: Generation): void {
  if (!Number.isInteger(gen) || gen < 0 || gen > MAX_SAFE_GENERATION) {
    throw new Error(
      `generation for id ${id} out of safe range [0, ${MAX_SAFE_GENERATION}]: ${gen}`,
    );
  }
}

// Per-key cloner dispatch. Routing snapshot/restore through this catches a
// missing wire-up at compile time the same way the column readers/writers
// do — adding a new component is a compile error in this table, not a
// silent "save/load drops the new column on round-trip".
type ColumnCloners = {
  [K in ComponentKey]: (
    v: NonNullable<Components[K]>,
  ) => NonNullable<Components[K]>;
};

export const columnCloners: ColumnCloners = {
  position: cloneAndValidatePosition,
  actor: cloneActor,
  hp: cloneAndValidateHP,
  ai: cloneAi,
  schedule: cloneAndValidateSchedule,
};
