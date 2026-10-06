import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { ember } from "../../../src/content/species/ember";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import {
	type AnyModule,
	type Builder,
	type CellField,
	defineModule,
	type EntityId,
	type ModuleDef,
	NO_CELL,
	type Schema,
} from "../../../src/core/api";
import { PERCEPTION_RADIUS } from "../../../src/core/config";
import { kill, spawn } from "../../../src/core/lifecycle/lifecycle";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world";
import { fear } from "../../../src/modules/fear";
import { foodClass, hungerConfig } from "../../../src/modules/hunger/config";
import { modules } from "../../../src/registry";
import { forwardBuilder, idleRounds, probe, reversed } from "../../fixtures";

// Fear as if every cell were dangerous: its proposals never skip perception.
function alwaysAlert<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const alert: Builder<S, K> = {
				...forwardBuilder(b),
				cells(name) {
					const real = b.cells(name);
					const fields: Record<string, CellField<"u8">> = {};
					for (const [field, column] of Object.entries(real) as [
						string,
						CellField<"u8">,
					][])
						fields[field] = {
							read: () => ({ get: () => 0xff, next: () => NO_CELL }),
							write: (ctx) => column.write(ctx),
						};
					return fields as typeof real;
				},
			};
			module.setup(alert, cfg);
		},
	};
}

const SIDE = 20;
const tracked = <T extends { components: object }>(shape: T) => ({
	...shape,
	components: { ...shape.components, where: {} },
});

// `cached`: a player on a second floor sets this one's period to 4, so flee and avoid also run
// from cached decisions, after the scene that chose them has changed.
const outcomes = (
	seed: number,
	list: readonly AnyModule[],
	burning = false,
	cached = false,
) => {
	const world = createWorld({
		seed,
		floors: cached ? 2 : 1,
		width: SIDE,
		height: SIDE,
		modules: [...list, probe],
		species,
	});
	let n = 0;
	const roll = () =>
		bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	const taken = new Set<number>();
	const free = (): [number, number] => {
		for (;;) {
			const x = roll();
			const y = roll();
			if (taken.has(y * SIDE + x)) continue;
			taken.add(y * SIDE + x);
			return [x, y];
		}
	};
	const ids: EntityId[] = [];
	const hunting = {
		...stoat,
		components: {
			...stoat.components,
			satiety: { value: hungerConfig.hungryBelow - 1 },
		},
	};
	// Stoats first: lower ids act first, so they move between fear's tick and their prey's turn.
	for (let i = 0; i < 3; i++)
		ids.push(world.spawn(0, tracked(hunting), ...free()));
	for (let i = 0; i < 16; i++)
		ids.push(world.spawn(0, tracked(rat), ...free()));
	for (let i = 0; i < 20; i++) world.spawn(0, cheese, roll(), roll());
	if (burning) {
		for (let i = 0; i < 4; i++) world.spawn(0, ember, ...free());
		for (let i = 0; i < 120; i++) world.spawn(0, moss, roll(), roll());
	}
	if (cached) {
		world.spawnPlayer(1, rat, 0, 0);
		idleRounds(world, 120);
	} else world.runRounds(120);
	return ids.map((id) =>
		world.alive(id)
			? [
					world.peek("where", "x", id),
					world.peek("where", "y", id),
					world.peek("satiety", "value", id),
				]
			: "dead",
	);
};

test("skipping perception on calm cells changes no decision", () => {
	const alert = modules.map(
		(m): AnyModule => (m === fear ? alwaysAlert(fear) : m),
	);
	for (let seed = 1; seed <= 6; seed++)
		expect({ seed, fates: outcomes(seed, modules) }).toEqual({
			seed,
			fates: outcomes(seed, alert),
		});
});

test("with fire burning, skipping perception on calm cells changes no decision", () => {
	const alert = modules.map(
		(m): AnyModule => (m === fear ? alwaysAlert(fear) : m),
	);
	let burned = 0;
	for (let seed = 1; seed <= 6; seed++) {
		const fates = outcomes(seed, modules, true);
		expect({ seed, fates }).toEqual({
			seed,
			fates: outcomes(seed, alert, true),
		});
		burned += fates.filter((f) => f === "dead").length;
	}
	expect(burned).toBeGreaterThan(0);
});

test("with decisions cached between full ones, skipping on calm cells changes no outcome", () => {
	const alert = modules.map(
		(m): AnyModule => (m === fear ? alwaysAlert(fear) : m),
	);
	for (const burning of [false, true])
		for (let seed = 1; seed <= 6; seed++)
			expect({
				seed,
				burning,
				fates: outcomes(seed, modules, burning, true),
			}).toEqual({
				seed,
				burning,
				fates: outcomes(seed, alert, burning, true),
			});
});

const MOUSE = {
	actor: true,
	components: { edible: { nutrition: 50, class: foodClass.forage }, wary: {} },
};

test("danger does not depend on the order fear's tick visits rows", () => {
	const hash = (list: readonly AnyModule[]) => {
		const world = createWorld({
			seed: 3,
			floors: 1,
			width: SIDE,
			height: SIDE,
			modules: list,
			species,
		});
		// Mice are prey of the rats' class, so rats and stoats stamp different bits that overlap.
		for (let i = 0; i < 8; i++) {
			world.spawn(0, rat, (i * 7) % SIDE, (i * 3) % SIDE);
			world.spawn(0, stoat, (i * 5 + 2) % SIDE, (i * 11 + 4) % SIDE);
			world.spawn(0, MOUSE, (i * 3 + 10) % SIDE, (i * 13 + 2) % SIDE);
		}
		world.runRounds(60);
		return world.hash();
	};
	const flipped = modules.map(
		(m): AnyModule => (m === fear ? reversed(fear) : m),
	);
	expect(hash(flipped)).toBe(hash(modules));
});

test("danger marks every cell within reach of a creature that eats a wary class", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: SIDE, height: SIDE, popCap: 64, events: true },
		modules.filter((m) => m.name !== "wander"),
		species,
	);
	spawn(engine, 0, rat, 1, 1);
	const hunter = spawn(engine, 0, stoat, 10, 10);
	spawn(
		engine,
		0,
		{ ...rat, components: { diet: rat.components.diet } },
		18,
		2,
	);
	engine.runRound();
	const danger = engine.cellColumns.get("danger")?.eats as Uint8Array;
	// A creature moves at most one cell a round, so danger reaches one cell past perception.
	const reach = PERCEPTION_RADIUS + 1;
	for (let y = 0; y < SIDE; y++)
		for (let x = 0; x < SIDE; x++) {
			const near = Math.max(Math.abs(x - 10), Math.abs(y - 10)) <= reach;
			expect({ x, y, v: danger[y * SIDE + x] }).toEqual({
				x,
				y,
				v: near ? foodClass.meat : 0,
			});
		}
	kill(engine, 0, hunter, hunter);
	engine.runRound();
	expect(danger.every((v) => v === 0)).toBe(true);
});

// The pre-check assumes no creature that eats appears between fear's tick and a prey's turn.
test("no species a registered module spawns has a diet", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 4, height: 4, popCap: 16, events: true },
		modules,
		species,
	);
	const diet = engine.components.get("diet")?.bit;
	expect(diet).toBeDefined();
	expect(engine.species.length).toBeGreaterThan(0);
	for (const compiled of engine.species)
		expect((compiled.mask[diet?.word ?? 0] ?? 0) & (diet?.bit ?? 0)).toBe(0);
});

test("an eater spawned mid-round slips past the pre-check: the limit it relies on", () => {
	// Spawns a hungry stoat beside the first wary rat, in a tick after fear's.
	const ambush = defineModule({
		name: "ambush",
		schema: { lure: { done: "u8" } },
		config: {},
		setup(b) {
			const lure = b.write("lure");
			const rows = b.query(["lure"]);
			const hunter = b.species({
				...stoat,
				components: { ...stoat.components, satiety: { value: 1 } },
			});
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				for (let i = 0; i < list.length; i++) {
					const s = list.at(i);
					if ((lure.done[s] ?? 0) !== 0) continue;
					lure.done[s] = 1;
					ctx.spawn(hunter, ctx.x(s) + 1, ctx.y(s), ctx.idOf(s));
				}
			});
		},
	});
	const where = (list: readonly AnyModule[]) => {
		const world = createWorld({
			seed: 1,
			floors: 1,
			width: SIDE,
			height: SIDE,
			modules: [...list, ambush, probe],
			species,
		});
		const id = world.spawn(
			0,
			{ ...rat, components: { ...rat.components, where: {}, lure: {} } },
			5,
			5,
		);
		world.runRounds(2);
		return [world.peek("where", "x", id), world.peek("where", "y", id)];
	};
	const alert = modules.map(
		(m): AnyModule => (m === fear ? alwaysAlert(fear) : m),
	);
	expect(where(alert)).toEqual([4, 5]);
	expect(where(modules)).not.toEqual([4, 5]);
});

test("a prey whose eater steps into sight after fear's tick still flees: the stamp covers it", () => {
	// Steps one cell east every turn, whatever it sees.
	const stalker = defineModule({
		name: "stalker",
		schema: { stalks: {} },
		config: {},
		setup(b) {
			const creep = b.action("creep", "none", ["stalks"], (ctx, actor) =>
				ctx.instead(ctx.step, ctx.cellAt(ctx.x(actor) + 1, ctx.y(actor))),
			);
			b.propose((_ctx, _actor, _perception, out) => out.push(creep, null, 1));
		},
	});
	const hunger = modules.find((m) => m.name === "hunger") as AnyModule;
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: [hunger, fear, stalker],
		species,
	});
	const y = 10;
	// Spawned first, so it acts first: one cell outside perception at fear's tick, inside after.
	world.spawn(
		0,
		{ actor: true, components: { stalks: {}, diet: { eats: foodClass.meat } } },
		2,
		y,
	);
	const prey = world.spawn(0, rat, 2 + PERCEPTION_RADIUS + 1, y);
	world.runRounds(1);
	expect(world.locate(prey)).toEqual({
		floor: 0,
		x: 2 + PERCEPTION_RADIUS + 2,
		y,
	});
});
