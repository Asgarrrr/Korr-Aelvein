import { PERCEPTION_RADIUS } from "../../core/module/api";

// One cell of slack on every stamp; fire spreads at most one cell a round, were fear ever to tick first.
// Sound only while every action costs one turn: an eater then moves at most one cell after the tick.
export const MARGIN = 1;

// Named because Biome forbids bare numbers in arrays. Rats (boldness 20-140) then split
// between fleeing and watching at 3 cells.
const SHY_UP_TO = 64;
const SHY_FLIGHT = 3;
const BOLD_FROM = 192;
const BOLD_FLIGHT = 1;

export const fearConfig = {
	// Above hunger's highest score: a starving creature still runs first.
	score: 1000,
	fireScore: 900,
	// Burning cells this close are threats to flee.
	fireRadius: 2,
	// [boldness, cells] points.
	flightByBoldness: [
		[SHY_UP_TO, SHY_FLIGHT],
		[BOLD_FROM, BOLD_FLIGHT],
	],
	flightMin: 1,
	// Below this satiety a creature risks one cell more.
	riskBelow: 250,
	watchWeight: 128,
	// A wary creature replaying a cached decision decides again when an eater first comes this
	// close. Beyond sight, far floors mostly decide on nothing and stay cheap; at 3 they turn
	// reactive and cost more.
	alarmRadius: PERCEPTION_RADIUS + MARGIN,
} as const;
