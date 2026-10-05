import { expect, test } from "bun:test";
import {
	type Cell,
	type CellField,
	defineModule,
	NO_CELL,
	type WriteCtx,
} from "../../../src/core/api";
import { createWorld, loadWorld } from "../../../src/core/world";

// Each round, every entity heats its own cell by its `heat.add`; `seen.level` records the
// heat under each actor when it proposes.
let field: CellField | undefined;
const heater = defineModule({
	name: "heater",
	schema: { heat: { add: "u8" }, seen: { level: "u8" } },
	cells: { warmth: { level: "u8" } },
	config: {},
	setup(b) {
		const warmth = b.cells("warmth");
		field = warmth.level;
		const heat = b.write("heat");
		const seen = b.write("seen");
		const rows = b.query(["heat"]);
		b.tick((ctx, floor) => {
			const list = rows.slots(floor);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				const cell = ctx.cellAt(ctx.x(s), ctx.y(s));
				warmth.level.set(
					ctx,
					cell,
					warmth.level.get(ctx, cell) + (heat.add[s] ?? 0),
				);
			}
		});
		const look = b.action("look", "none", (ctx, actor) => {
			seen.level[actor] = warmth.level.get(
				ctx,
				ctx.cellAt(ctx.x(actor), ctx.y(actor)),
			);
			return 100;
		});
		b.propose((_ctx, _actor, _p, out) => out.push(look, null, 1));
	},
});

const options = (audit = false) =>
	({
		seed: 1,
		floors: 2,
		width: 6,
		height: 7,
		modules: [heater],
		audit,
	}) as const;
const STOVE = { actor: false, components: { heat: { add: 3 } } };
const WATCHER = { actor: true, components: { heat: { add: 1 }, seen: {} } };

test("a cell column keeps per-floor values that its owner reads back", () => {
	const world = createWorld(options());
	world.spawn(0, STOVE, 5, 6);
	const near = world.spawn(0, WATCHER, 5, 6);
	const far = world.spawn(1, WATCHER, 5, 6);
	world.runRounds(2);
	expect(world.peek("seen", "level", near)).toBe(8);
	expect(world.peek("seen", "level", far)).toBe(2);
});

test("cell columns are saved with their floor, padding and all", () => {
	const world = createWorld(options());
	world.spawn(1, STOVE, 5, 6);
	const watcher = world.spawn(1, WATCHER, 5, 6);
	world.runRounds(3);
	const bytes = world.save();
	const loaded = loadWorld(bytes, { modules: [heater] });
	expect(loaded.save()).toEqual(bytes);
	expect(loaded.hash()).toBe(world.hash());
	world.runRounds(1);
	loaded.runRounds(1);
	expect(loaded.peek("seen", "level", watcher)).toBe(
		world.peek("seen", "level", watcher),
	);
	expect(loaded.peek("seen", "level", watcher)).toBe(16);
});

test("the hash covers cell columns", () => {
	const hot = createWorld(options());
	hot.spawn(0, STOVE, 1, 1);
	const cold = createWorld(options());
	cold.spawn(0, { ...STOVE, components: { heat: { add: 0 } } }, 1, 1);
	hot.runRounds(1);
	cold.runRounds(1);
	expect(hot.hash()).not.toBe(cold.hash());
});

test("a cell off the floor reads zero; any other bad cell throws", () => {
	createWorld(options());
	const level = field as CellField;
	const reader = defineModule({
		name: "reader",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				expect(level.get(ctx, NO_CELL)).toBe(0);
				expect(() => level.get(ctx, 42 as Cell)).toThrow(/not on the floor/);
				expect(() => level.set(ctx, NO_CELL, 1)).toThrow(/not on the floor/);
			});
		},
	});
	createWorld({ ...options(), modules: [heater, reader] }).runRounds(1);
});

test("a cell column name clashing with any component throws", () => {
	const clash = defineModule({
		name: "clash",
		schema: {},
		cells: { heat: { level: "u8" } },
		config: {},
		setup() {},
	});
	expect(() => createWorld({ ...options(), modules: [heater, clash] })).toThrow(
		/heat is owned by both heater and clash/,
	);
});

test("in audit mode, a write to another module's cells or out of range throws", () => {
	const meddler = defineModule({
		name: "meddler",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => (field as CellField).set(ctx, 0 as Cell, 1));
		},
	});
	const audited = createWorld({ ...options(true), modules: [heater, meddler] });
	audited.spawn(0, WATCHER, 0, 0);
	expect(() => audited.runRounds(1)).toThrow(
		/meddler wrote warmth\.level at cell 0/,
	);

	const blazing = createWorld(options(true));
	blazing.spawn(0, { ...STOVE, components: { heat: { add: 200 } } }, 0, 0);
	blazing.runRounds(1);
	expect(() => blazing.runRounds(1)).toThrow(/warmth\.level.*400/);
});

for (const write of ["set", "clear"] as const)
	test(`a cell ${write} from propose throws`, () => {
		const peeker = defineModule({
			name: "peeker",
			schema: {},
			cells: { glow: { v: "u8" } },
			config: {},
			setup(b) {
				const glow = b.cells("glow").v;
				b.propose((ctx) => {
					const writer = ctx as WriteCtx;
					if (write === "set") glow.set(writer, 0 as Cell, 1);
					else glow.clear(writer);
				});
			},
		});
		const world = createWorld({ ...options(), modules: [peeker] });
		world.spawn(0, { actor: true, components: {} }, 1, 1);
		expect(() => world.runRounds(1)).toThrow(
			/cell write is not allowed in propose/,
		);
	});

test("clear empties every cell of the floor, the last one included", () => {
	const seen: number[] = [];
	const sweeper = defineModule({
		name: "sweeper",
		schema: {},
		cells: { dust: { v: "u8" } },
		config: {},
		setup(b) {
			const dust = b.cells("dust").v;
			b.tick((ctx) => {
				const last = ctx.cellAt(5, 6);
				dust.set(ctx, last, 7);
				dust.set(ctx, 0 as Cell, 7);
				dust.clear(ctx);
				seen.push(dust.get(ctx, 0 as Cell), dust.get(ctx, last));
			});
		},
	});
	createWorld({ ...options(), modules: [sweeper] }).runRounds(1);
	expect(seen).toEqual([0, 0, 0, 0]);
});
