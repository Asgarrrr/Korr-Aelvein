export const CAP = 1 << 14;
export const MAX_FLOORS = 64;
export const ID_FLOOR_STRIDE = 1 << 25;
export const TICKS_PER_TURN = 100;
export const MAX_TICK = 0x7fffffff;
export const MAX_COORD = 0x7fff;
export const MAX_SEED = 0xffffffff;
export const SCORE_MAX = 10_000;
export const INERTIA = 5;
export const MAX_ALTERNATES = 4;
export const MAX_CANDIDATES = 256;
export const PERCEPTION_RADIUS = 3;
export const MAX_PERCEIVED = 1024;
export const EVENT_CAP_PER_TURN = 1 << 15;
export const STAIR_TIME = 150;
const NEXT_FLOOR_PERIOD = 4;
const NEAR_FLOOR_PERIOD = 16;
const FAR_FLOOR_PERIOD = 64;
// Turns between full decisions, by floor distance to the nearest player; the last entry covers every farther floor.
export const LOD_PERIODS: readonly number[] = [
	1,
	NEXT_FLOOR_PERIOD,
	NEAR_FLOOR_PERIOD,
	NEAR_FLOOR_PERIOD,
	FAR_FLOOR_PERIOD,
];
