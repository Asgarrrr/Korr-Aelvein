import {
  type EntityHandle,
  getComponent,
  isLiveHandle,
  setComponent,
} from "../../ecs/index";
import type { ZoneStatus } from "../types";

/**
 * Apply one off-zone NPC schedule event against the dormant zone the entity
 * lives in. The caller (the drain loop) has already verified the zone is
 * dormant, so this function takes the narrowed value directly — no second
 * dispatch on `zone.kind` here.
 *
 * Side effects on success:
 *  - moves the entity's `position` to `waypoints[nextIndex]`,
 *  - advances `nextIndex` to `(nextIndex + 1) % waypoints.length`.
 *
 * Returns the schedule's `period` (the delay until the entity's next event)
 * if the event was applied, `undefined` if the entity is no longer
 * schedulable (despawned, or its `Schedule` component was removed). The
 * caller uses the return to decide whether to reschedule.
 */
export function applyAbstract(
  zone: ZoneStatus & { kind: "dormant" },
  entity: EntityHandle,
): number | undefined {
  if (!isLiveHandle(zone.world, entity)) return undefined;
  const sched = getComponent(zone.world, entity, "schedule");
  if (sched === undefined) return undefined;
  const waypoint = sched.waypoints[sched.nextIndex];
  if (waypoint === undefined) {
    // `cloneAndValidateSchedule` rejects `nextIndex` out of range, so any
    // schedule that survived boundary validation has a valid waypoint
    // here. Reaching this branch means the column got mutated through a
    // non-public path — surface it loudly.
    throw new Error(
      `applyAbstract: schedule.nextIndex=${sched.nextIndex} out of range for waypoints.length=${sched.waypoints.length}`,
    );
  }
  setComponent(zone.world, entity, "position", {
    x: waypoint[0],
    y: waypoint[1],
  });
  setComponent(zone.world, entity, "schedule", {
    waypoints: sched.waypoints,
    nextIndex: (sched.nextIndex + 1) % sched.waypoints.length,
    period: sched.period,
  });
  return sched.period;
}
