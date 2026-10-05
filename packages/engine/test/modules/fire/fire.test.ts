import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { ember } from "../../../src/content/species/ember";
import { moss } from "../../../src/content/species/moss";
import { mushroom } from "../../../src/content/species/mushroom";
import { rat } from "../../../src/content/species/rat";
import type { AnyModule, EntityId } from "../../../src/core/api";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createWorld, loadWorld, type World } from "../../../src/core/world";
import { fire } from "../../../src/modules/fire";
import { fireConfig } from "../../../src/modules/fire/config";
import { hunger } from "../../../src/modules/hunger";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { reversed } from "../../fixtures";
import { WATCHER, watch } from "./watch";

const sure = { ...fire, config: { ...fireConfig, spreadChance: 100 } };

const deaths = (world: World<readonly AnyModule[]>) => {
	const died = world.eventType("core/died");
	const out: [number, number, number][] = [];
	world.drainEvents(0, (type, cause, a, _b, time) => {
		if (type === died) out.push([a, cause, time / 100]);
	});
	return out;
};

test("a moss line burns out in pinned rounds; the ember's cell keeps burning and consumes its fuel; a bare cell never catches", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 4,
		modules: [sure, watch],
	});
	const source = world.spawn(0, ember, 0, 0);
	const kindling = world.spawn(0, moss, 0, 0);
	const line = [1, 2, 3, 4].map((x) => world.spawn(0, moss, x, 0));
	const watchers = [0, 1, 2, 3, 4].map((x) => world.spawn(0, WATCHER, x, 0));
	const bare = world.spawn(0, WATCHER, 2, 1);
	world.drainEvents(0, () => {});
	const history: number[][] = [];
	for (let round = 0; round < 8; round++) {
		world.runRounds(1);
		history.push(
			[...watchers, bare].map((id) => world.peek("feel", "left", id)),
		);
	}
	expect(history).toEqual([
		[2, 0, 0, 0, 0, 0],
		[2, 3, 0, 0, 0, 0],
		[2, 2, 3, 0, 0, 0],
		[2, 1, 2, 3, 0, 0],
		[2, 0, 1, 2, 3, 0],
		[2, 0, 0, 1, 2, 0],
		[2, 0, 0, 0, 1, 0],
		[2, 0, 0, 0, 0, 0],
	]);
	const [m1, m2, m3, m4] = line as [EntityId, EntityId, EntityId, EntityId];
	expect(deaths(world)).toEqual([
		[kindling, source, 1],
		[m1, source, 1],
		[m2, m1, 2],
		[m3, m2, 3],
		[m4, m3, 4],
	]);
});

test("fire burns a rat standing on moss beside an ember: the moss it ignited is the cause", () => {
	const world = createWorld({
		seed: 7,
		floors: 1,
		width: 12,
		height: 12,
		modules: [hunger, fire],
		species,
	});
	world.spawn(0, ember, 5, 5);
	const fuel = world.spawn(0, moss, 6, 5);
	const victim = world.spawn(0, rat, 6, 5);
	world.drainEvents(0, () => {});
	world.runRounds(30);
	const died = deaths(world);
	expect(died.find(([id]) => id === fuel)?.[2]).toBe(2);
	expect(died.find(([id]) => id === victim)).toEqual([victim, fuel, 4]);
});

const SIDE = 24;
const ROUNDS = 100;

const field = (list: readonly AnyModule[], seed = 3, audit = false) => {
	const world = createWorld({
		seed,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: list,
		species,
		audit,
	});
	let n = 0;
	const roll = (bound: number) =>
		bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), bound);
	for (let y = 0; y < SIDE; y++)
		for (let x = 0; x < SIDE; x++) {
			if (roll(2) === 0) continue;
			world.spawn(0, moss, x, y);
			if (roll(4) === 0) world.spawn(0, mushroom, x, y);
		}
	// Two embers share the first cell.
	for (const [x, y] of [
		[4, 4],
		[4, 4],
		[18, 6],
		[10, 19],
	] as const)
		world.spawn(0, ember, x, y);
	const rats: EntityId[] = [];
	const taken = new Set<number>();
	while (rats.length < 10) {
		const x = roll(SIDE);
		const y = roll(SIDE);
		if (taken.has(y * SIDE + x)) continue;
		taken.add(y * SIDE + x);
		rats.push(world.spawn(0, rat, x, y));
	}
	return { world, rats };
};

test("fire spreads the same whatever order its tick visits rows and occupants", () => {
	const run = (list: readonly AnyModule[], seed: number) => {
		const { world } = field(list, seed);
		world.drainEvents(0, () => {});
		const died: [number, number, number][] = [];
		for (let round = 0; round < ROUNDS; round++) {
			world.runRounds(1);
			died.push(...deaths(world));
		}
		return { hash: world.hash(), died };
	};
	const flipped = modules.map(
		(m): AnyModule => (m === fire ? reversed(fire) : m),
	);
	for (let seed = 1; seed <= 4; seed++) {
		const straight = run(modules, seed);
		expect(straight.died.length).toBeGreaterThan(50);
		expect({ seed, ...run(flipped, seed) }).toEqual({ seed, ...straight });
	}
});

test("save and load in mid-fire: 50 + save + load + 50 equals 100", () => {
	const straight = field(modules).world;
	straight.runRounds(ROUNDS);
	const first = field(modules).world;
	first.runRounds(ROUNDS / 2);
	const resumed = loadWorld(first.save(), { modules, species });
	resumed.runRounds(ROUNDS / 2);
	expect(resumed.hash()).toBe(straight.hash());
});

test("the game runs without fire, deterministically, and nothing burns", () => {
	const without = modules.filter((m) => m !== fire);
	const run = () => {
		const { world, rats } = field(without);
		world.runRounds(ROUNDS);
		return {
			hash: world.hash(),
			hp: rats
				.filter((id) => world.alive(id))
				.map((id) => world.peek("vitality", "hp", id)),
		};
	};
	const once = run();
	expect(run()).toEqual(once);
	expect(once.hp.length).toBeGreaterThan(0);
	expect(once.hp.every((hp) => hp === rat.components.vitality.max)).toBe(true);
});

test("fire runs without hunger or fear and burns wandering rats", () => {
	const run = () => {
		const { world, rats } = field([fire, wander]);
		world.drainEvents(0, () => {});
		world.runRounds(ROUNDS);
		const burned = deaths(world).filter(([id]) =>
			rats.includes(id as EntityId),
		);
		return { hash: world.hash(), burned };
	};
	const once = run();
	expect(run()).toEqual(once);
	expect(once.burned.length).toBeGreaterThan(0);
});

test("a burning world runs in audit mode and reaches the same state", () => {
	const hashAfter = (audit: boolean) => {
		const { world } = field(modules, 3, audit);
		world.runRounds(30);
		return world.hash();
	};
	expect(hashAfter(true)).toBe(hashAfter(false));
});
