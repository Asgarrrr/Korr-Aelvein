import { expect, test } from "bun:test";
import {
	type Builder,
	defineModule,
	type Schema,
} from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world/world";

test("a module's config is read once, so the fingerprint and the module see one value", () => {
	let reads = 0;
	const config = {
		get rate() {
			reads++;
			return reads;
		},
	};
	let seen = 0;
	const reader = defineModule({
		name: "reader",
		schema: {},
		config,
		setup(_b, cfg) {
			seen = cfg.rate;
		},
	});
	createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [reader] });
	expect(reads).toBe(1);
	expect(seen).toBe(1);
});

test("a module cannot change its config", () => {
	const meddler = defineModule({
		name: "meddler",
		schema: {},
		config: { rate: 1, steps: [1, 2] },
		setup(_b, cfg) {
			const loose = cfg as { rate: number; steps: number[] };
			expect(() => {
				loose.rate = 2;
			}).toThrow();
			expect(() => loose.steps.push(3)).toThrow();
		},
	});
	createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [meddler] });
});

test("a species is read once, so the fingerprint and the spawns see one shape", () => {
	let reads = 0;
	const counted = {
		actor: false,
		get components() {
			reads++;
			return { mark: { n: reads } };
		},
	};
	const breeder = defineModule({
		name: "breeder",
		schema: { mark: { n: "u8" } },
		config: {},
		setup(b) {
			b.species(counted);
			b.species("table");
		},
	});
	createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [breeder],
		species: { table: counted },
	});
	expect(reads).toBe(1);
});

test("a config holding a sparse array throws", () => {
	const holes: number[] = new Array(2);
	holes[1] = 1;
	const sparse = defineModule({
		name: "sparse",
		schema: {},
		config: { holes },
		setup() {},
	});
	expect(() =>
		createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [sparse] }),
	).toThrow(/sparse.*hole/);
});

test("cell columns take no mask bit", () => {
	const schema: Record<string, Record<string, "u8">> = {};
	// With the core's three tags and two components, 27 tags fill the first mask word exactly.
	for (let i = 0; i < 27; i++) schema[`tag${i}`] = {};
	const tagged = defineModule({
		name: "tagged",
		schema,
		cells: { glow: { v: "u8" } },
		config: {},
		setup() {},
	});
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 4, height: 4, popCap: 16, events: true },
		[tagged],
	);
	expect(engine.storage.maskWords).toBe(1);
});

test("an alarm takes only a u8 cell field of its own module", () => {
	const lender = defineModule({
		name: "lender",
		schema: { tag: {} },
		cells: { glow: { v: "u8" } },
		config: {},
		setup() {},
	});
	const own = { own: { v: "u8", w: "i16" } } as const;
	const borrower = (setup: (b: Builder<Schema, typeof own>) => void) =>
		createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: [
				lender,
				defineModule({
					name: "borrower",
					schema: {},
					cells: own,
					config: {},
					setup,
				}),
			],
		});
	expect(() => borrower((b) => b.alarm("own", "v", ["tag"]))).not.toThrow();
	expect(() => borrower((b) => b.alarm("glow" as never, "v", []))).toThrow(
		/borrower does not own cells glow/,
	);
	for (const field of ["w", "missing", "toString"])
		expect(() => borrower((b) => b.alarm("own", field as never, []))).toThrow(
			`borrower alarm: own.${field} is not a u8 cell field`,
		);
	expect(() => borrower((b) => b.alarm("own", "v", ["wings"]))).toThrow(
		/borrower requires wings, which no module owns/,
	);
});
