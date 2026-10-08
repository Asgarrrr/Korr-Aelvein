import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import type { EntityId } from "../../../src/core/module/api";
import {
	createWorld,
	loadWorld,
	type World,
} from "../../../src/core/world/world";
import { game } from "../../fixtures";

const FLOORS = 3;
const SIDE = 12;
type GameWorld = World<typeof game.modules>;

const setup = (seed = 1) => {
	const world = createWorld({
		seed,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		...game,
	});
	world.spawn(
		0,
		{ actor: false, components: { link: { floor: 1, x: 5, y: 5 } } },
		4,
		4,
	);
	world.spawn(
		1,
		{ actor: false, components: { link: { floor: 0, x: 4, y: 4 } } },
		5,
		5,
	);
	for (let f = 0; f < FLOORS; f++)
		for (let i = 0; i < 6; i++) {
			world.spawn(f, rat, (i * 5 + f) % SIDE, (i * 2 + 7) % SIDE);
			world.spawn(f, cheese, (i * 3 + 1) % SIDE, (i * 7 + f) % SIDE);
		}
	const players = [
		world.spawnPlayer(0, rat, 3, 3),
		world.spawnPlayer(2, rat, 8, 8),
	];
	return { world, players };
};

// A scripted session: inputs drawn from (round, player), some of them invalid on purpose.
const scripted = (round: number, player: number): [string, number | null] => {
	const pick = (round * 7 + player) % 6;
	if (pick === 0) return ["wander/roam", null];
	if (pick === 1) return ["core/step", (round * 13 + player) % (SIDE * SIDE)];
	if (pick === 2) return ["no/such", null];
	if (pick === 3) return ["core/step", null];
	if (pick === 4) return ["core/travel", 1];
	return ["core/idle", null];
};

const play = (world: GameWorld, rounds: number, from = 0) => {
	let round = from;
	while (round < from + rounds) {
		const due = world.advance();
		if (due.length === 0) {
			round++;
			continue;
		}
		for (const player of due) world.input(player, ...scripted(round, player));
	}
};

test("advance returns the due players and stops; each input moves the round on", () => {
	const { world, players } = setup();
	const [first, second] = players as [EntityId, EntityId];
	expect(world.advance()).toEqual([first, second]);
	const paused = world.hash();
	// A due player without input stays due, and nothing else moves.
	expect(world.advance()).toEqual([first, second]);
	expect(world.hash()).toBe(paused);
	world.input(first, "core/idle", null);
	expect(world.advance()).toEqual([second]);
	expect(() => world.input(first, "core/idle", null)).toThrow(/not due/);
	world.input(second, "wander/roam", null);
	expect(world.advance()).toEqual([]);
	expect(world.advance()).toEqual([first, second]);
	expect(() => world.runRounds(1)).toThrow(/due/);
});

type Input = [string, number | null];
const oneRound = (firstInput: Input, secondInput: Input) => {
	const { world, players } = setup();
	const [first, second] = players as [EntityId, EntityId];
	world.advance();
	world.input(first, ...firstInput);
	world.input(second, ...secondInput);
	expect(world.advance()).toEqual([]);
	return { world, first, second };
};

test("an input moves its player; an invalid one is recorded and played as core/idle", () => {
	const step = 3 * SIDE + 4;
	const { world, first, second } = oneRound(
		["core/step", step],
		["no/such", null],
	);
	const idle = {
		round: 0,
		time: 0,
		player: second,
		action: "core/idle",
		target: null,
	};
	expect(world.inputs()).toEqual([
		{
			round: 0,
			time: 0,
			player: first,
			action: "core/step",
			target: step,
		},
		idle,
	]);
	expect(
		oneRound(["core/idle", null], ["no/such", null]).world.hash(),
	).not.toBe(world.hash());
	expect(oneRound(["core/step", step], ["core/idle", null]).world.hash()).toBe(
		world.hash(),
	);
	for (const invalid of [
		["core/step", null],
		["core/step", -3],
		["core/step", SIDE * SIDE],
		["core/step", 1.5],
		["core/idle", 4],
		["core/travel", 0],
	] as Input[]) {
		const other = oneRound(["core/step", step], invalid);
		expect(other.world.inputs()[1]).toEqual(idle);
		expect(other.world.hash()).toBe(world.hash());
	}
});

// Feeds the log back to a fresh world as it stands, then finishes the round the last input was in.
const replay = (world: GameWorld, log: ReturnType<GameWorld["inputs"]>) => {
	let next = 0;
	while (next < log.length) {
		for (const player of world.advance()) {
			const input = log[next++];
			if (input?.player !== player)
				throw new Error(`replay diverged at input ${next - 1}`);
			world.input(input.player, input.action, input.target);
		}
	}
	expect(world.advance()).toEqual([]);
};

for (const seed of [1, 2])
	test(`replaying (seed, setup, inputs) on a fresh world gives the same hash (seed ${seed})`, () => {
		const { world } = setup(seed);
		play(world, 40);
		const fresh = setup(seed).world;
		replay(fresh, world.inputs());
		expect(fresh.inputs()).toEqual(world.inputs());
		expect(fresh.hash()).toBe(world.hash());
	});

test("save while paused on a due player, load, continue equals the uninterrupted run", () => {
	const straight = setup(3).world;
	play(straight, 30);
	const first = setup(3).world;
	play(first, 12);
	const due = first.advance();
	expect(due.length).toBe(2);
	const [player] = due as [EntityId];
	first.input(player, ...scripted(12, player));
	expect(first.advance()).toEqual(due.slice(1));
	const resumed = loadWorld(first.save(), game) as GameWorld;
	expect(resumed.save()).toEqual(first.save());
	for (const p of resumed.advance()) resumed.input(p, ...scripted(12, p));
	expect(resumed.advance()).toEqual([]);
	play(resumed, 17, 13);
	expect(resumed.hash()).toBe(straight.hash());
});

test("spawnPlayer refuses a creature that does not act", () => {
	const { world } = setup();
	expect(() => world.spawnPlayer(1, cheese, 0, 0)).toThrow(/actor/);
});

test("a creature spawned mid-round on a floor that finished it acts from the next round", () => {
	const { world } = setup();
	expect(world.advance().length).toBe(2);
	// Floor 1 holds no player, so it has finished round 0.
	world.spawn(1, rat, 0, 0);
	const resumed = loadWorld(world.save(), game) as GameWorld;
	expect(resumed.hash()).toBe(world.hash());
});

const crowd = () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		...game,
	});
	const players = [0, 1, 2, 3, 4].map((i) => world.spawnPlayer(0, rat, i, 0));
	const plain = world.spawn(0, rat, 6, 6);
	return { world, players, plain };
};

test("one input per floor between advances: the next due player waits for advance", () => {
	const { world, players } = crowd();
	expect(world.advance()).toEqual(players.slice(0, 1));
	world.input(players[0] as EntityId, "core/idle", null);
	expect(() => world.input(players[1] as EntityId, "core/idle", null)).toThrow(
		/not due/,
	);
	for (const p of players.slice(1)) {
		expect(world.advance()).toEqual([p]);
		world.input(p, "core/idle", null);
	}
	expect(world.advance()).toEqual([]);
	const loaded = loadWorld(world.save(), game) as GameWorld;
	expect(loaded.hash()).toBe(world.hash());
	const fresh = crowd().world;
	replay(fresh, world.inputs());
	expect(fresh.hash()).toBe(world.hash());
});

test("only a player can take an input, even when a load put a creature first in line", () => {
	const { world, players, plain } = crowd();
	for (const p of players) {
		world.advance();
		world.input(p, "core/idle", null);
	}
	// The plain rat is now first in line on a paused-looking floor; the input rule must still hold.
	const loaded = loadWorld(world.save(), game) as GameWorld;
	expect(() => loaded.input(plain, "core/idle", null)).toThrow(/not due/);
});

test("a player on a floor that finished the round is not due", () => {
	const { world, players } = setup();
	const [first, second] = players as [EntityId, EntityId];
	world.advance();
	world.input(first, "core/idle", null);
	expect(world.advance()).toEqual([second]);
	expect(() => world.input(first, "core/idle", null)).toThrow(/not due/);
	expect(() => loadWorld(world.save(), game)).not.toThrow();
});

test("a player whose next turn falls in the next round is not due, even after a load", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		...game,
	});
	const player = world.spawnPlayer(0, rat, 1, 1);
	expect(world.advance()).toEqual([player]);
	world.input(player, "core/idle", null);
	const loaded = loadWorld(world.save(), game) as GameWorld;
	expect(() => loaded.input(player, "core/idle", null)).toThrow(/not due/);
});

test("before advance starts the round, no player is due, not even the first in line", () => {
	const { world, players } = crowd();
	expect(() => world.input(players[0] as EntityId, "core/idle", null)).toThrow(
		/not due/,
	);
});
