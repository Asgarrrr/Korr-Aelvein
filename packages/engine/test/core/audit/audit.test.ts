import { expect, test } from "bun:test";
import { moss } from "../../../src/content/species/moss";
import { stoat } from "../../../src/content/species/stoat";
import { type AnyModule, defineModule, type Slot } from "../../../src/core/api";
import { CAP } from "../../../src/core/config";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world";
import { modules } from "../../../src/registry";
import { populatedWorld } from "../../fixtures";

const TURN = 100;
type Phase = "tick" | "propose" | "action";
type Write = (slot: Slot) => void;

const culprit = (phase: Phase, write: () => Write | undefined) =>
	defineModule({
		name: "culprit",
		schema: { mark: { n: "u8" } },
		config: {},
		setup(b) {
			const rows = b.query(["mark"]);
			const act = b.action("act", "none", (_ctx, actor) => {
				if (phase === "action") write()?.(actor);
				return TURN;
			});
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				if (phase === "tick")
					for (let i = 0; i < list.length; i++) write()?.(list.at(i));
			});
			b.propose((_ctx, actor, _p, out) => {
				if (phase === "propose") write()?.(actor);
				out.push(act, null, 1);
			});
		},
	});

let leaked: Uint8Array | undefined;
const owner = defineModule({
	name: "owner",
	schema: { secret: { level: "u8" } },
	config: {},
	setup(b) {
		leaked = b.write("secret").level;
	},
});
const BODY = { actor: true, components: { mark: {}, secret: {} } };

for (const phase of ["tick", "propose", "action"] as const)
	test(`a ${phase} writing another module's column throws in audit mode, naming it`, () => {
		const steal: Write = (slot) => {
			if (leaked) leaked[slot] = 7;
		};
		const run = (audit: boolean) => {
			const world = createWorld({
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				modules: [owner, culprit(phase, () => steal)],
				audit,
			});
			world.spawn(0, BODY, 1, 1);
			world.runRounds(1);
		};
		expect(() => run(false)).not.toThrow();
		expect(() => run(true)).toThrow(
			/culprit .*secret\.level.* slot 0|culprit .*slot 0.*secret\.level/,
		);
	});

const ranged = (kind: "i8" | "u8" | "i16" | "u16" | "i32", value: number) =>
	defineModule({
		name: "ranged",
		schema: { gauge: { v: kind } },
		config: {},
		setup(b) {
			const gauge = b.write("gauge");
			const rows = b.query(["gauge"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				for (let i = 0; i < list.length; i++) gauge.v[list.at(i)] = value;
			});
		},
	});

for (const [kind, value] of [
	["u8", 256],
	["u8", -1],
	["i8", 128],
	["i16", -32769],
	["u16", 65536],
	["i32", 2 ** 31],
	["i32", 1.5],
] as const)
	test(`an owned ${kind} write of ${value} throws in audit mode only`, () => {
		const run = (audit: boolean) => {
			const world = createWorld({
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				modules: [ranged(kind, value)],
				audit,
			});
			world.spawn(0, { actor: false, components: { gauge: {} } }, 0, 0);
			world.runRounds(1);
		};
		expect(() => run(false)).not.toThrow();
		expect(() => run(true)).toThrow(new RegExp(`gauge\\.v.*${value}`));
	});

type Gauge = { readonly v: Uint8Array };
const bulk = (name: string, use: (v: Uint8Array, first: Slot) => void) =>
	defineModule({
		name,
		schema: { gauge: { v: "u8" } },
		config: {},
		setup(b) {
			const gauge: Gauge = b.write("gauge");
			const rows = b.query(["gauge"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				if (list.length > 0) use(gauge.v, list.at(0));
			});
		},
	});

for (const [what, use, error] of [
	["fill(256)", (v: Uint8Array) => v.fill(256), /gauge\.v.*256/],
	["set([300])", (v: Uint8Array) => v.set([300]), /gauge\.v.*300/],
	[
		"a write through subarray",
		(v: Uint8Array) => {
			v.subarray(0, 2)[0] = 300;
		},
		/gauge\.v.*300/,
	],
	["copyWithin", (v: Uint8Array) => v.copyWithin(0, 1), /copyWithin/],
] as const)
	test(`an owned column refuses ${what} in audit mode`, () => {
		const world = createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: [bulk("bulk", use)],
			audit: true,
		});
		world.spawn(0, { actor: false, components: { gauge: {} } }, 0, 0);
		expect(() => world.runRounds(1)).toThrow(error);
	});

test("a propose writing even its own column throws in audit mode", () => {
	const selfish = defineModule({
		name: "selfish",
		schema: { mine: { v: "u8" } },
		config: {},
		setup(b) {
			const mine = b.write("mine");
			b.propose((_ctx, actor) => {
				mine.v[actor] = 1;
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [selfish],
		audit: true,
	});
	world.spawn(0, { actor: true, components: { mine: {} } }, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/mine\.v.*slot 0/);
});

test("a write above the floor's high water throws in audit mode", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [
			bulk("beyond", (v, first) => {
				v[first + 5] = 1;
			}),
		],
		audit: true,
	});
	world.spawn(0, { actor: false, components: { gauge: {} } }, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/gauge\.v.*slot 5.*high water/);
});

const engineWith = (floors: number, list: readonly AnyModule[]) =>
	createEngine(
		{
			seed: 1,
			floors,
			width: 4,
			height: 4,
			popCap: 16,
			events: true,
			audit: true,
		},
		list,
	);

for (const scalar of ["highWater", "freeCount", "counters"] as const)
	test(`a module changing the allocator's ${scalar} throws in audit mode`, () => {
		let poke: (() => void) | undefined;
		const engine = engineWith(1, [bulk("alloc", () => poke?.())]);
		poke = () => {
			const array = engine.storage[scalar];
			array[0] = (array[0] ?? 0) + 1;
		};
		spawn(engine, 0, { actor: false, components: { gauge: {} } }, 0, 0, 0);
		expect(() => engine.runRound()).toThrow(new RegExp(scalar));
	});

for (const [writer, victim] of [
	[0, 1],
	[1, 0],
] as const)
	test(`floor ${writer} writing floor ${victim}'s rows throws in audit mode`, () => {
		const engine = engineWith(2, [
			bulk("elsewhere", (v, first) => {
				if (first >= writer * CAP && first < (writer + 1) * CAP)
					v[first + (victim - writer) * CAP] = 9;
			}),
		]);
		for (const floor of [0, 1])
			spawn(
				engine,
				floor,
				{ actor: false, components: { gauge: {} } },
				0,
				0,
				0,
			);
		expect(() => engine.runRound()).toThrow(
			new RegExp(`floor ${victim} changed while floor ${writer} ran`),
		);
	});

test("the last floor writing above an earlier floor's high water throws at round end", () => {
	const engine = engineWith(2, [
		bulk("late", (v, first) => {
			if (first >= CAP) v[first - CAP + 3] = 9;
		}),
	]);
	for (const floor of [0, 1])
		spawn(engine, floor, { actor: false, components: { gauge: {} } }, 0, 0, 0);
	expect(() => engine.runRound()).toThrow(/gauge\.v at slot 3 .*floor 0/);
});

test("a stray write to the row the next spawn will take throws in audit mode", () => {
	const litter = defineModule({
		name: "litter",
		schema: { gauge: { v: "u8" } },
		config: {},
		setup(b) {
			const gauge = b.write("gauge");
			const rows = b.query(["gauge"]);
			const pup = b.species({ actor: false, components: {} });
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				if (list.length !== 1) return;
				const s = list.at(0);
				gauge.v[s + 1] = 9;
				ctx.spawn(pup, 1, 1, ctx.idOf(s));
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [litter],
		audit: true,
	});
	world.spawn(0, { actor: false, components: { gauge: {} } }, 0, 0);
	expect(() => world.runRounds(1)).toThrow(
		/litter wrote gauge\.v at free slot 1/,
	);
});

test("a write to a killed entity's freed slot throws in audit mode", () => {
	const reaper = defineModule({
		name: "reaper",
		schema: { gauge: { v: "u8" } },
		config: {},
		setup(b) {
			const gauge = b.write("gauge");
			const rows = b.query(["gauge"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				if (list.length === 2) {
					const s = list.at(1);
					ctx.kill(ctx.idOf(s), ctx.idOf(s));
				} else gauge.v[(list.at(0) ?? 0) + 1] = 4;
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [reaper],
		audit: true,
	});
	world.spawn(0, { actor: false, components: { gauge: {} } }, 0, 0);
	world.spawn(0, { actor: false, components: { gauge: {} } }, 1, 0);
	world.runRounds(1);
	expect(() => world.runRounds(1)).toThrow(
		/reaper wrote gauge\.v at free slot 1/,
	);
});

const ROUNDS = 150;
const busyWorld = (list: readonly AnyModule[], audit: boolean) => {
	const { world } = populatedWorld(1, list, 30, { audit });
	for (let i = 0; i < 6; i++) {
		world.spawn(0, moss, (i * 7) % 32, (i * 13) % 32);
		world.spawn(0, stoat, (i * 5 + 1) % 32, 30);
	}
	world.runRounds(ROUNDS);
	return world.hash();
};

test("the game's registry runs in audit mode and reaches the same state", () => {
	expect(busyWorld(modules, true)).toBe(busyWorld(modules, false));
});
