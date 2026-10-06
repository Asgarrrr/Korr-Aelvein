import { species as gameSpecies } from "../../src/content/species";
import { rat } from "../../src/content/species/rat";
import { stoat } from "../../src/content/species/stoat";
import type { Engine } from "../../src/core/engine";
import { spawn } from "../../src/core/lifecycle/lifecycle";
import type { Species } from "../../src/core/lifecycle/species";
import type { AnyModule } from "../../src/core/module/api";
import { bounded, draw, PHASE, SUBJECT } from "../../src/core/random/rng";
import { createEngine } from "../../src/core/setup/registration";
import { modules as gameModules } from "../../src/registry";
import { age } from "./age";
import { metabolism } from "./metabolism";
import { scent } from "./scent";
import { thirst } from "./thirst";

export const SEED = 1;
export const FLOORS = 50;
export const SIDE = 128;
export const RATS = 7800;
export const STOATS = 200;
// Items: cheese fills whatever the stairs leave of the 2000.
const MUSHROOMS = 300;
const MOSS = 400;
const PUDDLES = 340;
const EMBERS = 16;
const ITEMS = 2000;
// Bounds flora's regrowth a little above the starting 10k rows; arrivals ignore it.
export const POP_CAP = 10_500;
// Two players, far apart: floors 0 and 25 run every LOD tier on both sides of a player.
const SECOND_PLAYER = 25;
export const PLAYER_FLOORS: readonly number[] = [0, SECOND_PLAYER];

// Stairs down at (x, DOWN_Y) lead to (x + 1, UP_Y) one floor below, where stairs lead back.
const STAIRS = 5;
const FIRST_STAIR_X = 16;
const STAIR_GAP = 24;
const STAIR_XS = Array.from(
	{ length: STAIRS },
	(_, i) => FIRST_STAIR_X + STAIR_GAP * i,
);
const DOWN_Y = 24;
const UP_Y = 104;

const STOCK = 1000;
// Per 20 creatures: 14 sated, 3 hungry, 1 restless (may take stairs), 2 thirsty.
const MIX = 20;
const SATED_END = 14;
const HUNGRY_END = 17;
const RESTLESS_END = 18;
const HUNGRY_SATIETY = 470;
const RESTLESS_SATIETY = 380;
const THIRSTY_HYDRATION = 350;
// One creature in 200 starts close enough to its lifespan to die of age while sampled.
const OLD_EVERY = 200;
const OLD_LEFT = 60;
const LIFESPAN = 60_000;
const ADULT_AT = 300;
const ELDER_AT = 40_000;
const AGE_SPREAD = 2000;
const MUSK = 8;

export const referenceModules = [
	...gameModules,
	thirst,
	scent,
	age,
	metabolism,
] as const satisfies readonly AnyModule[];

type Ref = Species<typeof referenceModules>;

const body = {
	mass: 0,
	fat: 40,
	muscle: 200,
	lean: 300,
	energy: 500,
	stamina: 50,
	temperature: 370,
	size: 8,
	rate: 2,
};

// A game creature with the bench modules' components; each spawn sets its needs and age.
function creature(base: Ref, extra: Ref["components"]): Ref {
	return {
		actor: true,
		components: {
			...base.components,
			...extra,
			satiety: { value: STOCK },
			hydration: { value: STOCK, max: STOCK, drank: 0 },
			age: {
				turns: 0,
				adultAt: ADULT_AT,
				elderAt: ELDER_AT,
				lifespan: LIFESPAN,
				stage: 0,
			},
			body,
		},
	};
}

// One object for every spawn: the engine reads values during the call and keeps none.
const needs = {
	satiety: { value: 0 },
	hydration: { value: 0 },
	age: { turns: 0 },
};

// The i-th creature of a kind: its needs follow MIX, its age the spread.
function needsOf(i: number) {
	const k = i % MIX;
	needs.satiety.value =
		k < SATED_END || k >= RESTLESS_END
			? STOCK
			: k < HUNGRY_END
				? HUNGRY_SATIETY
				: RESTLESS_SATIETY;
	needs.hydration.value = k >= RESTLESS_END ? THIRSTY_HYDRATION : STOCK;
	needs.age.turns =
		i % OLD_EVERY === 0 ? LIFESPAN - OLD_LEFT - (i % OLD_LEFT) : i % AGE_SPREAD;
	return needs;
}

const puddle: Ref = {
	actor: false,
	components: { spring: { gives: 200, left: 30 } },
};

export const referenceSpecies = {
	...gameSpecies,
	puddle,
	scentedRat: creature(rat, { musk: { strength: MUSK, fade: 1 } }),
	trackingStoat: creature(stoat, { tracker: { keen: 1, trail: 0, since: 0 } }),
	player: creature(rat, {}),
} satisfies Readonly<Record<string, Ref>>;

const way = { link: { floor: 0, x: 0, y: 0 } };
const stairsTo = (floor: number, x: number, y: number) => {
	way.link.floor = floor;
	way.link.x = x;
	way.link.y = y;
	return way;
};

export function buildReference(
	list: readonly AnyModule[] = referenceModules,
	floorOrder?: readonly number[],
): Engine {
	const e = createEngine(
		{
			seed: SEED,
			floors: FLOORS,
			width: SIDE,
			height: SIDE,
			popCap: POP_CAP,
			events: true,
		},
		list,
		referenceSpecies,
	);
	if (floorOrder) e.floorOrder = [...floorOrder];
	// Generation spawns have no client to inform: events go on once the world is built.
	e.events.enabled.fill(0);
	let n = 0;
	const coord = () =>
		bounded(draw(SEED, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	for (let f = 0; f < FLOORS; f++) {
		const taken = new Uint8Array(SIDE * SIDE);
		const free = () => {
			for (;;) {
				const x = coord();
				const y = coord();
				if (taken[y * SIDE + x]) continue;
				taken[y * SIDE + x] = 1;
				return [x, y] as const;
			}
		};
		let items = 0;
		const item = (
			kind: string,
			x = coord(),
			y = coord(),
			values?: Ref["components"],
		) => {
			spawn(e, f, kind, x, y, false, values);
			items++;
		};
		for (const x of STAIR_XS) {
			if (f + 1 < FLOORS)
				item("stairs", x, DOWN_Y, stairsTo(f + 1, x + 1, UP_Y));
			if (f > 0) item("stairs", x, UP_Y, stairsTo(f - 1, x + 1, DOWN_Y));
		}
		for (let i = 0; i < RATS; i++)
			spawn(e, f, "scentedRat", ...free(), false, needsOf(i));
		for (let i = 0; i < STOATS; i++)
			spawn(e, f, "trackingStoat", ...free(), false, needsOf(i));
		if (PLAYER_FLOORS.includes(f))
			spawn(e, f, "player", ...free(), true, needsOf(1));
		for (let i = 0; i < MUSHROOMS; i++) item("mushroom");
		for (let i = 0; i < MOSS; i++) item("moss");
		for (let i = 0; i < PUDDLES; i++) item("puddle");
		for (let i = 0; i < EMBERS; i++) item("ember");
		while (items < ITEMS) item("cheese");
	}
	e.events.enabled.fill(1);
	return e;
}

// Bytes each slot holds: saved columns, mask words and free list, then the derived state beside
// them (the scheduler's queued flag, the id index), and what each actor adds in the scheduler's
// run and later lists, an (id, slot) pair in each.
export function bytesPerSlot(e: Engine) {
	const columns = e.storage.columns.reduce(
		(sum, column) => sum + column.BYTES_PER_ELEMENT,
		0,
	);
	const word = Int32Array.BYTES_PER_ELEMENT;
	const saved = columns + e.storage.maskWords * word + word;
	const queued = Uint8Array.BYTES_PER_ELEMENT;
	const index = 2 * word;
	const perActor = 2 * 2 * word;
	return { columns, saved, resident: saved + queued + index, perActor };
}
