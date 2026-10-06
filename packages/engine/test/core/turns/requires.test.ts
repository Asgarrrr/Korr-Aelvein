import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { defineModule, type EntityId } from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { foodClass } from "../../../src/modules/hunger/config";
import { game, idleRounds } from "../../fixtures";
import { climber, drain } from "../travel/climber";

const SIDE = 8;
const TURN = 100;

test("a player whose body lacks a component an action writes cannot run it, and the save loads", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		...game,
	});
	const gourmet = {
		actor: true,
		components: { diet: { eats: foodClass.forage } },
	};
	const bare = world.spawnPlayer(0, gourmet, 2, 2);
	world.spawnPlayer(0, rat, 5, 5);
	const near = world.spawn(0, cheese, 3, 2);
	const nearFed = world.spawn(0, cheese, 6, 5);
	for (let due = world.advance(); due.length > 0; due = world.advance())
		for (const p of due)
			world.input(p, "hunger/eat", p === bare ? near : nearFed);
	expect(world.alive(near)).toBe(true);
	expect(world.alive(nearFed)).toBe(false);
	// The record keeps what was sent: a replay meets the same miss.
	expect(world.inputs().find((r) => r.player === bare)?.action).toBe(
		"hunger/eat",
	);
	expect(() => loadWorld(world.save(), game)).not.toThrow();
});

test("an alternate reached through instead fails on an actor that lacks what it requires", () => {
	const inked: EntityId[] = [];
	const scribe = defineModule({
		name: "scribe",
		schema: { ink: { n: "u8" } },
		config: {},
		setup(b) {
			const ink = b.write("ink");
			const write = b.action("write", "none", ["ink"], (ctx, actor) => {
				inked.push(ctx.idOf(actor));
				ink.n[actor] = 1;
				return TURN;
			});
			const reach = b.action("reach", "none", [], (ctx) =>
				ctx.instead(write, null),
			);
			b.propose((_ctx, _actor, _p, out) => out.push(reach, null, 1));
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: [scribe],
	});
	world.spawn(0, { actor: true, components: {} }, 1, 1);
	const wet = world.spawn(0, { actor: true, components: { ink: {} } }, 5, 5);
	world.runRounds(1);
	expect(inked).toEqual([wet]);
});

// c0 lands in mask word 0, c31 in word 1. Returns the actors the action ran on.
const ranWith = (requires: readonly string[]) => {
	const ran: EntityId[] = [];
	const names = Array.from({ length: 32 }, (_, i) => `c${i}`);
	const wide = defineModule({
		name: "wide",
		schema: Object.fromEntries(names.map((n) => [n, {}])),
		config: {},
		setup(b) {
			const go = b.action("go", "none", requires, (ctx, actor) => {
				ran.push(ctx.idOf(actor));
				return TURN;
			});
			b.propose((_ctx, _actor, _p, out) => out.push(go, null, 1));
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: [wide],
	});
	const body = (...has: string[]) => ({
		actor: true,
		components: Object.fromEntries(has.map((n) => [n, {}])),
	});
	const ids = {
		low: world.spawn(0, body("c0"), 1, 1),
		high: world.spawn(0, body("c31"), 3, 3),
		both: world.spawn(0, body("c0", "c31"), 5, 5),
	};
	world.runRounds(1);
	return { ran, ...ids };
};

test("requires spanning two mask words need both", () => {
	const { ran, both } = ranWith(["c0", "c31"]);
	expect(ran).toEqual([both]);
});

test("a requirement in a later mask word is tested in that word", () => {
	const { ran, high, both } = ranWith(["c31"]);
	expect(ran).toEqual([high, both]);
});

test("an action needing a component no registered module owns throws at registration", () => {
	const hungry = defineModule({
		name: "hungry",
		schema: {},
		config: {},
		setup(b) {
			b.action("gulp", "none", ["satiety"], () => TURN);
		},
	});
	expect(() =>
		createWorld({
			seed: 1,
			floors: 1,
			width: SIDE,
			height: SIDE,
			modules: [hungry],
		}),
	).toThrow(/requires satiety/);
});

test("a decision whose action the actor cannot run is cleared, so the actor decides again next turn", () => {
	const ROUNDS = 16;
	const decided = new Map<EntityId, number>();
	const seeker = defineModule({
		name: "seeker",
		schema: { lens: {} },
		config: {},
		setup(b) {
			const peer = b.action("peer", "none", ["lens"], () => TURN);
			b.propose((ctx, actor, _p, out) => {
				const id = ctx.idOf(actor);
				decided.set(id, (decided.get(id) ?? 0) + 1);
				out.push(peer, null, 1);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 4,
		width: SIDE,
		height: SIDE,
		modules: [seeker],
	});
	// Three floors from the player, the actors would otherwise repeat a decision for many turns.
	const blind = world.spawn(3, { actor: true, components: {} }, 1, 1);
	const sighted = world.spawn(
		3,
		{ actor: true, components: { lens: {} } },
		5,
		5,
	);
	world.spawnPlayer(0, { actor: true, components: {} }, 1, 1);
	idleRounds(world, ROUNDS);
	expect(decided.get(blind)).toBe(ROUNDS);
	expect(decided.get(sighted)).toBeLessThan(ROUNDS / 4);
});

test("in audit mode, a player without climbs sending climber/mark plays a FAIL", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: [climber],
		audit: true,
	});
	const bare = world.spawnPlayer(0, { actor: true, components: {} }, 1, 1);
	for (let due = world.advance(); due.length > 0; due = world.advance())
		world.input(bare, "climber/mark", null);
	expect(drain(world, 0, "climber/marked")).toEqual([]);
});
