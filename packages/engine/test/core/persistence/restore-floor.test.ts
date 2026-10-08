import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import { createWorld } from "../../../src/core/world/world";
import { exploreConfig } from "../../../src/modules/explore/config";
import { game } from "../../fixtures";

const FLOORS = 3;
const SIDE = 12;
const hungry = {
	...rat,
	components: {
		...rat.components,
		satiety: { value: exploreConfig.restlessBelow - 50 },
	},
};
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

const build = (seed: number, audit = false) => {
	const world = createWorld({
		seed,
		audit,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		...game,
	});
	for (let f = 0; f < FLOORS; f++) {
		if (f + 1 < FLOORS) world.spawn(f, stairsTo(f + 1, 2, 9), 9, 2);
		if (f > 0) world.spawn(f, stairsTo(f - 1, 9, 2), 2, 9);
		for (let i = 0; i < 8; i++)
			world.spawn(f, hungry, (i * 5 + seed) % SIDE, (i * 3 + f) % SIDE);
		world.spawn(f, moss, (seed * 7 + f) % SIDE, 5);
	}
	for (let i = 0; i < 20; i++)
		world.spawn(FLOORS - 1, cheese, (i * 7) % SIDE, (i * 5) % SIDE);
	return world;
};

for (const seed of [1, 2])
	for (const [floor, at] of [
		[1, 6],
		[2, 25],
		[0, 40],
	] as const)
		test(`restoring floor ${floor} at round ${at} into a live world changes nothing (seed ${seed})`, () => {
			const straight = build(seed);
			straight.runRounds(at);
			const image = straight.saveFloor(floor);
			straight.runRounds(60);
			// Audit mode also proves the restore left no row above the image's high water.
			const live = build(seed, true);
			live.runRounds(at);
			// The live floor drifts from the image: more rows, a higher id counter, another layout.
			for (let i = 0; i < 6; i++) {
				live.spawn(floor, cheese, i, 11);
				live.spawn(floor, moss, 11, i);
			}
			live.loadFloor(floor, image);
			live.runRounds(60);
			expect(live.hash()).toBe(straight.hash());
		});

// A player on floor 0 beside stairs to floor 1, both floors otherwise quiet.
const stairway = (playerFloor: 0 | 1) => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		...game,
	});
	world.spawn(0, stairsTo(1, 5, 5), 3, 3);
	const player = world.spawnPlayer(playerFloor, rat, 2, 2);
	return { world, player };
};
const playRound = (
	world: ReturnType<typeof stairway>["world"],
	travel: boolean,
) => {
	for (let due = world.advance(); due.length > 0; due = world.advance())
		for (const p of due)
			if (travel) world.input(p, "core/travel", 1);
			else world.input(p, "core/idle", null);
};

test("restoring the floor a player left, from a run where nobody left, throws", () => {
	const quiet = stairway(0);
	const left = stairway(0);
	playRound(quiet.world, false);
	playRound(left.world, true);
	expect(() => left.world.loadFloor(0, quiet.world.saveFloor(0))).toThrow(
		/traffic/,
	);
});

test("equal traffic counts from different travellers still tell the floors apart", () => {
	const twoPlayers = () => {
		const { world, player } = stairway(0);
		const other = world.spawnPlayer(0, rat, 4, 4);
		return { world, players: [player, other] };
	};
	const a = twoPlayers();
	const b = twoPlayers();
	// Each world sends one player down the stairs, a different one.
	for (const [run, leaver] of [
		[a, 0],
		[b, 1],
	] as const) {
		for (
			let due = run.world.advance();
			due.length > 0;
			due = run.world.advance()
		)
			for (const p of due)
				if (p === run.players[leaver]) run.world.input(p, "core/travel", 1);
				else run.world.input(p, "core/idle", null);
	}
	expect(() => b.world.loadFloor(0, a.world.saveFloor(0))).toThrow(/traffic/);
});
