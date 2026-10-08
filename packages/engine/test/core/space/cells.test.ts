import { expect, test } from "bun:test";
import {
	type Cell,
	type CellField,
	type CellView,
	defineModule,
	type EntityId,
	NO_CELL,
	type WriteCtx,
} from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";

// Each round, every entity heats its own cell by its `heat.add`; `seen.level` records the
// heat under each actor when it proposes.
let field: CellField<"u8"> | undefined;
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
		b.tick((ctx) => {
			const list = rows.slots(ctx);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				const cell = ctx.cellAt(ctx.x(s), ctx.y(s));
				const level = warmth.level.write(ctx);
				level.set(cell, level.get(cell) + (heat.add[s] ?? 0));
			}
		});
		const look = b.action("look", "none", ["seen"], (ctx, actor) => {
			seen.level[actor] = warmth.level
				.read(ctx)
				.get(ctx.cellAt(ctx.x(actor), ctx.y(actor)));
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

test("in audit mode, an actor without seen proposes look and records nothing", () => {
	const world = createWorld(options(true));
	world.spawn(0, STOVE, 5, 6);
	world.spawn(0, { actor: true, components: { heat: { add: 1 } } }, 4, 6);
	const watcher = world.spawn(0, WATCHER, 5, 6);
	world.runRounds(2);
	expect(world.peek("seen", "level", watcher)).toBeGreaterThan(0);
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
	const level = field as CellField<"u8">;
	const reader = defineModule({
		name: "reader",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				const cells = level.read(ctx);
				expect(cells.get(NO_CELL)).toBe(0);
				expect(() => cells.get(42 as Cell)).toThrow(/not on the floor/);
				expect(() => cells.get(-2 as Cell)).toThrow(/not on the floor/);
				const writer = level.write(ctx);
				expect(() => writer.set(NO_CELL, 1)).toThrow(/not on the floor/);
				expect(() => writer.set(42 as Cell, 1)).toThrow(/not on the floor/);
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
			b.tick((ctx) => (field as CellField<"u8">).write(ctx).set(0 as Cell, 1));
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
					if (write === "set") glow.write(writer).set(0 as Cell, 1);
					else glow.write(writer).clear();
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
				const cells = dust.write(ctx);
				cells.set(last, 7);
				cells.set(0 as Cell, 7);
				cells.clear();
				seen.push(cells.get(0 as Cell), cells.get(last));
			});
		},
	});
	createWorld({ ...options(), modules: [sweeper] }).runRounds(1);
	expect(seen).toEqual([0, 0, 0, 0]);
});

// Each round, every `heat` row adds `heat.add` to what its cell held at the previous tick,
// read from the buffer, and records the result in `seen`.
const ripple = (buffered: boolean) =>
	defineModule({
		name: "ripple",
		schema: { heat: { add: "u8" }, seen: { level: "u8" } },
		cells: { wave: { v: "u8" } },
		config: {},
		setup(b) {
			const now = b.cells("wave").v;
			const was = buffered ? b.previous("wave").v : now;
			const heat = b.write("heat");
			const seen = b.write("seen");
			const rows = b.query(["heat"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				for (let i = 0; i < list.length; i++) {
					const s = list.at(i);
					const cell = ctx.cellAt(ctx.x(s), ctx.y(s));
					const wave = now.write(ctx);
					wave.set(cell, was.read(ctx).get(cell) + (heat.add[s] ?? 0));
					seen.level[s] = wave.get(cell);
				}
			});
		},
	});
const rippled = (buffered = true) => {
	const world = createWorld({ ...options(), modules: [ripple(buffered)] });
	const ids = [1, 2].map((add, floor) =>
		world.spawn(
			floor,
			{ actor: false, components: { heat: { add }, seen: {} } },
			2,
			3,
		),
	);
	return { world, ids };
};

test("a buffered cell column reads, per floor, what the previous tick left", () => {
	const { world, ids } = rippled();
	world.runRounds(3);
	expect(ids.map((id) => world.peek("seen", "level", id))).toEqual([3, 6]);
});

test("the previous buffer is not saved, and a load continues as if it never stopped", () => {
	const straight = rippled().world;
	straight.runRounds(5);
	const { world, ids } = rippled();
	world.runRounds(2);
	const unbuffered = rippled(false).world;
	unbuffered.runRounds(2);
	expect(world.save().length).toBe(unbuffered.save().length);
	const resumed = loadWorld(world.save(), { modules: [ripple(true)] });
	resumed.runRounds(3);
	expect(resumed.hash()).toBe(straight.hash());
	expect(resumed.peek("seen", "level", ids[1] as EntityId)).toBe(10);
});

test("the previous buffer holds the floor's last cell too", () => {
	const world = createWorld({ ...options(), modules: [ripple(true)] });
	const ids = [1, 2].map((add, floor) =>
		world.spawn(
			floor,
			{ actor: false, components: { heat: { add }, seen: {} } },
			5,
			6,
		),
	);
	world.runRounds(3);
	expect(ids.map((id) => world.peek("seen", "level", id))).toEqual([3, 6]);
});

test("a module buffers only its own cells, once", () => {
	const greedy = (name: string, twice: boolean) =>
		defineModule({
			name: "greedy",
			schema: {},
			cells: { mine: { v: "u8" } },
			config: {},
			setup(b) {
				b.previous(name as "mine");
				if (twice) b.previous(name as "mine");
			},
		});
	const build = (name: string, twice: boolean) => () =>
		createWorld({ ...options(), modules: [heater, greedy(name, twice)] });
	expect(build("warmth", false)).toThrow(/greedy does not own cells warmth/);
	expect(build("mine", true)).toThrow(/mine is already buffered/);
	expect(build("mine", false)).not.toThrow();
});

const KINDS = {
	a: "u8",
	b: "i8",
	c: "u16",
	d: "i16",
	e: "i32",
	f: "entity",
} as const;
// Values per kind, and the cells they go to: around word edges, the first cell and the last.
const VALUES = { a: 200, b: -3, c: 60_000, d: -2, e: -70_000, f: 9 } as const;
const SPOTS = [0, 3, 4, 7, 8, 9, 17, 41];

test("next walks exactly the nonzero cells of every kind, in order, from NO_CELL", () => {
	const walked: Record<string, number[][]> = {};
	const marker = defineModule({
		name: "marker",
		schema: {},
		cells: { marks: KINDS },
		config: {},
		setup(b) {
			const marks = b.cells("marks");
			b.tick((ctx) => {
				for (const field of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
					const cells = marks[field].write(ctx);
					for (const spot of SPOTS)
						cells.set(spot as Cell, VALUES[field] as never);
					for (const walker of [cells, marks[field].read(ctx)]) {
						const seen: number[][] = [];
						for (
							let c = walker.next(NO_CELL);
							c !== NO_CELL;
							c = walker.next(c)
						)
							seen.push([c, walker.get(c)]);
						expect(walker.next(41 as Cell)).toBe(NO_CELL);
						expect(walker.next(4 as Cell)).toBe(7 as Cell);
						expect(walker.next(13 as Cell)).toBe(17 as Cell);
						walked[field] = seen;
					}
				}
			});
		},
	});
	createWorld({ ...options(), modules: [marker] }).runRounds(1);
	for (const field of Object.keys(KINDS) as (keyof typeof KINDS)[])
		expect({ field, seen: walked[field] }).toEqual({
			field,
			seen: SPOTS.map((spot) => [spot, VALUES[field]]),
		});
});

test("a previous buffer is readable only in its owner's tick", () => {
	const reads: string[] = [];
	let shared: CellView<"u8"> | undefined;
	const owner = defineModule({
		name: "owner",
		schema: {},
		cells: { wave: { v: "u8" } },
		config: {},
		setup(b) {
			const was = b.previous("wave").v;
			shared = was;
			b.tick((ctx) => {
				reads.push(`tick ${was.read(ctx).get(0 as Cell)}`);
			});
			const look = b.action("look", "none", [], (ctx) => {
				expect(() => was.read(ctx)).toThrow(/only in its owner's tick/);
				reads.push("action refused");
				return 100;
			});
			b.propose((ctx, _actor, _p, out) => {
				expect(() => was.read(ctx)).toThrow(/only in its owner's tick/);
				out.push(look, null, 1);
			});
		},
	});
	const other = defineModule({
		name: "other",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				expect(() => shared?.read(ctx)).toThrow(/only in its owner's tick/);
				reads.push("other refused");
			});
		},
	});
	const world = createWorld({
		...options(),
		floors: 1,
		modules: [owner, other],
	});
	world.spawn(0, { actor: true, components: {} }, 0, 0);
	world.runRounds(1);
	expect(reads).toEqual(["tick 0", "other refused", "action refused"]);
});
