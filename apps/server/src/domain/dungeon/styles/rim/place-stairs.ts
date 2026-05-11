import type { Pass, Room } from "../../types";

export const placeStairs: Pass = (level) => {
  if (level.spawn === null) {
    throw new Error(
      "placeStairs: precondition violated — level.spawn is null (run placeFirstRoom first)",
    );
  }
  if (level.rooms.length < 2) {
    throw new Error(
      `placeStairs: needs >= 2 rooms (got ${level.rooms.length}) — level too small`,
    );
  }
  const [sx, sy] = level.spawn;

  // Argmax over rooms by squared-Euclidean distance from spawn to the room's
  // center. Track the room directly (instead of just an index) so we never
  // need an unchecked indexed read afterwards.
  let best: Room | null = null;
  let bestDist = -1;
  for (const room of level.rooms) {
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    const dx = cx - sx;
    const dy = cy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestDist) {
      bestDist = d2;
      best = room;
    }
  }
  if (best === null) {
    throw new Error(
      "placeStairs: unreachable — empty rooms after length check",
    );
  }
  const dx = best.x + Math.floor(best.w / 2);
  const dy = best.y + Math.floor(best.h / 2);

  return { ...level, downStairs: [dx, dy] };
};
