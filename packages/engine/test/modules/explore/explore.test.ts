import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { LOD_PERIODS, STAIR_TIME } from "../../../src/core/config";
import {
	type AnyModule,
	type Builder,
	type CellField,
	type EntityId,
	type ModuleDef,
	NO_CELL,
	type Schema,
} from "../../../src/core/module/api";
import { createWorld, type World } from "../../../src/core/world/world";
import { explore } from "../../../src/modules/explore";
import { exploreConfig } from "../../../src/modules/explore/config";
import { hunger } from "../../../src/modules/hunger";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import {
	decider,
	decisions,
	forwardBuilder,
	game,
	idleRounds,
	populatedWorld,
	probe,
} from "../../fixtures";

const SIDE = 16;
const ARRIVAL = { x: 8, y: 8 } as const;
const restless = {
	...rat,
	components: {
		...rat.components,
		satiety: { value: exploreConfig.restlessBelow - 100 },
	},
};
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

interface Move {
	readonly id: number;
	readonly time: number;
}

const moves = <M extends readonly AnyModule[]>(
	world: World<M>,
	floor: number,
	into: { departed: Move[]; arrived: Move[] },
) => {
	const departed = world.eventType("core/departed");
	const arrived = world.eventType("core/arrived");
	world.drainEvents(floor, (type, _cause, a, _b, time) => {
		if (type === departed) into.departed.push({ id: a, time });
		if (type === arrived) into.arrived.push({ id: a, time });
	});
};

// Floor 0 has no food, only stairs to floor 1; floor 1 has cheese all around the arrival.
const famine = (list: readonly AnyModule[], seed = 1) => {
	const world = createWorld({
		seed,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: list,
		species: game.species,
	});
	world.spawn(0, stairsTo(1, ARRIVAL.x, ARRIVAL.y), 3, 3);
	world.spawn(1, stairsTo(0, 3, 3), 1, 1);
	for (let y = 5; y <= 11; y++)
		for (let x = 5; x <= 11; x++) world.spawn(1, cheese, x, y);
	const rats: EntityId[] = [];
	for (const [x, y] of [
		[1, 1],
		[3, 1],
		[5, 2],
		[1, 4],
		[5, 5],
		[2, 6],
	] as const)
		rats.push(world.spawn(0, restless, x, y));
	return { world, rats };
};

for (const seed of [1, 2, 3])
	test(`migrate-on-famine (seed ${seed}): hungry rats leave the empty floor and arrive on the fed one`, () => {
		const { world, rats } = famine(modules, seed);
		const floor0 = { departed: [] as Move[], arrived: [] as Move[] };
		const floor1 = { departed: [] as Move[], arrived: [] as Move[] };
		for (let r = 0; r < 30; r++) {
			world.runRounds(1);
			moves(world, 0, floor0);
			moves(world, 1, floor1);
		}
		const byId = (list: Move[]) => [...list].sort((a, b) => a.id - b.id);
		expect(byId(floor0.departed).map((m) => m.id)).toEqual([...rats].sort());
		expect(byId(floor1.arrived)).toEqual(
			byId(floor0.departed).map((m) => ({
				id: m.id,
				time: m.time + STAIR_TIME,
			})),
		);
		expect(floor0.arrived).toEqual([]);
		expect(floor1.departed).toEqual([]);
		// Every rat lives on floor 1 now, and has eaten there.
		for (const id of rats) {
			expect(world.alive(id)).toBe(true);
			expect(world.peek("satiety", "value", id)).toBeGreaterThan(
				exploreConfig.restlessBelow,
			);
		}
	});

test("a rat that is not yet restless stays", () => {
	const { world, rats } = famine(modules);
	const calm = world.spawn(0, rat, 4, 2);
	world.runRounds(10);
	const floor0 = { departed: [] as Move[], arrived: [] as Move[] };
	moves(world, 0, floor0);
	expect(floor0.departed.map((m) => m.id)).not.toContain(calm);
	expect(floor0.departed.length).toBe(rats.length);
});

test("the game runs without explore, and nobody leaves", () => {
	const without = modules.filter((m) => m !== explore);
	const { world } = famine(without);
	world.runRounds(60);
	const floor0 = { departed: [] as Move[], arrived: [] as Move[] };
	moves(world, 0, floor0);
	expect(floor0.departed).toEqual([]);
	populatedWorld(1, without).world.runRounds(300);
});

test("explore without hunger proposes nothing and does not throw", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [explore, wander],
	});
	world.spawn(0, stairsTo(1, 8, 8), 3, 3);
	const ids = [world.spawn(0, { actor: true, components: {} }, 2, 2)];
	world.runRounds(40);
	const floor0 = { departed: [] as Move[], arrived: [] as Move[] };
	moves(world, 0, floor0);
	expect(floor0.departed).toEqual([]);
	expect(ids.every((id) => world.alive(id))).toBe(true);
});

const statue = { actor: true, components: {} };
const tiny = (list: readonly AnyModule[]) => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: list,
		species: game.species,
	});
	world.spawn(0, stairsTo(1, 8, 8), 3, 3);
	const leavers = () => {
		const floor0 = { departed: [] as Move[], arrived: [] as Move[] };
		moves(world, 0, floor0);
		return floor0.departed.map((m) => m.id);
	};
	return { world, leavers };
};

test("a restless rat beside stairs that an actor stands on still leaves", () => {
	const { world, leavers } = tiny([hunger, explore]);
	world.spawn(0, statue, 3, 3);
	const id = world.spawn(0, restless, 4, 3);
	world.runRounds(3);
	expect(leavers()).toEqual([id]);
});

test("a restless rat walks around an actor on its straight step to the stairs", () => {
	const { world, leavers } = tiny([hunger, explore]);
	world.spawn(0, statue, 4, 3);
	const id = world.spawn(0, restless, 5, 3);
	world.runRounds(4);
	expect(leavers()).toEqual([id]);
});

test("a restless rat that sees food it eats stays, even when hunger does not call it yet", () => {
	const eager = {
		...explore,
		config: { ...exploreConfig, restlessBelow: hungerConfig.hungryBelow + 200 },
	};
	const { world, leavers } = tiny([hunger, eager]);
	const body = {
		...rat,
		components: {
			...rat.components,
			satiety: { value: hungerConfig.hungryBelow + 100 },
		},
	};
	world.spawn(0, cheese, 6, 6);
	const fed = tiny([hunger, eager]);
	const seen = world.spawn(0, body, 4, 4);
	const blind = fed.world.spawn(0, body, 4, 4);
	world.runRounds(3);
	fed.world.runRounds(3);
	expect(leavers()).not.toContain(seen);
	expect(fed.leavers()).toEqual([blind]);
});

test("a restless rat with no stairs in sight keeps wandering", () => {
	const { world, leavers } = tiny([hunger, explore, wander, probe]);
	const body = {
		...restless,
		components: { ...restless.components, where: {} },
	};
	const id = world.spawn(1, body, 8, 8);
	// Something in view that is neither food nor stairs: no reason to head for it.
	world.spawn(1, { actor: false, components: {} }, 9, 9);
	const start = [8, 8];
	const seen = new Set<string>();
	for (let r = 0; r < 6; r++) {
		world.runRounds(1);
		seen.add(`${world.peek("where", "x", id)},${world.peek("where", "y", id)}`);
	}
	expect(seen.size).toBeGreaterThan(1);
	expect(seen.has(start.join(","))).toBe(true);
	expect(leavers()).toEqual([]);
});

test("a restless rat walled off from the stairs idles on its cached decision", () => {
	decisions.clear();
	const far = 4;
	const world = createWorld({
		seed: 1,
		floors: far + 1,
		width: 4,
		height: 2,
		modules: [hunger, explore, decider],
	});
	world.spawnPlayer(0, statue, 0, 0);
	const id = world.spawn(far, restless, 0, 0);
	world.spawn(far, statue, 1, 0);
	world.spawn(far, statue, 1, 1);
	world.spawn(far, stairsTo(0, 0, 0), 2, 0);
	idleRounds(world, LOD_PERIODS[far] ?? 0);
	expect(decisions.get(id)).toBeLessThanOrEqual(2);
	expect(world.alive(id)).toBe(true);
});

// Explore as if stairs were in sight from every cell: its proposals never skip the scan.
function alwaysNear<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const near: Builder<S, K> = {
				...forwardBuilder(b),
				cells(name) {
					const real = b.cells(name);
					const fields: Record<string, CellField<"u8">> = {};
					for (const [field, column] of Object.entries(real) as [
						string,
						CellField<"u8">,
					][])
						fields[field] = {
							read: () => ({ get: () => 1, next: () => NO_CELL }),
							write: (ctx) => column.write(ctx),
						};
					return fields as typeof real;
				},
			};
			module.setup(near, cfg);
		},
	};
}

// Stairs between three floors, food on the last; rats start everywhere, some far from stairs.
// The limit: stairs spawned mid-round would be unmarked until the next tick; none are here.
const tower = (seed: number, list: readonly AnyModule[]) => {
	const world = createWorld({
		seed,
		floors: 3,
		width: SIDE,
		height: SIDE,
		modules: list,
		species: game.species,
	});
	for (let f = 0; f < 3; f++) {
		if (f < 2) world.spawn(f, stairsTo(f + 1, 2, 13), 13, 2);
		if (f > 0) world.spawn(f, stairsTo(f - 1, 13, 2), 2, 13);
		for (let i = 0; i < 12; i++)
			world.spawn(f, restless, (i * 5 + seed) % SIDE, (i * 7 + f) % SIDE);
	}
	for (let i = 0; i < 30; i++)
		world.spawn(2, cheese, (i * 7) % SIDE, (i * 3) % SIDE);
	world.runRounds(80);
	let left = 0;
	const departed = world.eventType("core/departed");
	for (let f = 0; f < 3; f++)
		world.drainEvents(f, (type) => {
			if (type === departed) left++;
		});
	return { hash: world.hash(), left };
};

test("skipping the scan away from stairs changes no decision", () => {
	const scanning = modules.map(
		(m): AnyModule => (m === explore ? alwaysNear(explore) : m),
	);
	for (let seed = 1; seed <= 4; seed++) {
		const marked = tower(seed, modules);
		expect(marked.left).toBeGreaterThan(0);
		expect({ seed, ...marked }).toEqual({ seed, ...tower(seed, scanning) });
	}
});
