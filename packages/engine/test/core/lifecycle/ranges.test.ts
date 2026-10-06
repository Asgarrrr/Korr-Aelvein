import { expect, test } from "bun:test";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { probe } from "../../fixtures";
import { aimAt, climber, climberBody, stairsTo } from "../travel/climber";

const traits = defineModule({
	name: "traits",
	schema: { traits: { bold: "u8", calm: "i16", wide: "i32" } },
	config: {},
	setup() {},
});
const extra = defineModule({
	name: "extra",
	schema: { extra: { v: "u8" } },
	config: {},
	setup() {},
});

const ranged = {
	actor: false,
	components: {
		traits: { bold: { min: 20, max: 140 }, calm: { min: -5, max: 5 }, wide: 7 },
	},
};
const narrow = {
	actor: false,
	components: { traits: { bold: { min: 3, max: 7 } } },
};

const world = (
	seed = 1,
	modules: readonly AnyModule[] = [traits],
	table: Readonly<Record<string, unknown>> = { ranged, narrow },
) =>
	createWorld({
		seed,
		floors: 1,
		width: 4,
		height: 4,
		modules,
		species: table as { ranged: typeof ranged },
	});

interface Peeks {
	peek(component: "traits", field: "bold" | "calm", id: EntityId): number;
}
const traitsOf = (w: Peeks, ids: readonly EntityId[]) =>
	ids.map((id) => [w.peek("traits", "bold", id), w.peek("traits", "calm", id)]);

const spawnMany = (w: ReturnType<typeof world>, n: number, name = "ranged") =>
	Array.from({ length: n }, () => w.spawn(0, name, 0, 0));

test("1000 draws stay in [min, max], triangular around the middle", () => {
	const w = world();
	const counts = [0, 0, 0, 0, 0];
	let sum = 0;
	for (const id of spawnMany(w, 1000, "narrow")) {
		const bold = w.peek("traits", "bold", id);
		expect(bold).toBeGreaterThanOrEqual(3);
		expect(bold).toBeLessThanOrEqual(7);
		counts[bold - 3] = (counts[bold - 3] ?? 0) + 1;
		sum += bold;
	}
	expect(Math.abs(sum / 1000 - 5)).toBeLessThan(0.15);
	const [low = 0, lower = 0, middle = 0, upper = 0, high = 0] = counts;
	expect(low).toBeGreaterThan(0);
	expect(high).toBeGreaterThan(0);
	expect(middle).toBeGreaterThan(Math.max(lower, upper));
	expect(Math.min(lower, upper)).toBeGreaterThan(Math.max(low, high));
});

test("one seed draws the same values; another seed draws others", () => {
	const a = world(1);
	const b = world(1);
	const c = world(2);
	const values = traitsOf(a, spawnMany(a, 20));
	expect(traitsOf(b, spawnMany(b, 20))).toEqual(values);
	expect(traitsOf(c, spawnMany(c, 20))).not.toEqual(values);
	expect(a.peek("traits", "wide", spawnMany(a, 1)[0] as EntityId)).toBe(7);
});

test("registering another module, before or after the owner, shifts no drawn value", () => {
	const alone = world(1, [traits]);
	const values = traitsOf(alone, spawnMany(alone, 20));
	for (const modules of [
		[extra, traits],
		[traits, extra],
	]) {
		const w = world(1, modules);
		expect(traitsOf(w, spawnMany(w, 20))).toEqual(values);
	}
});

test("a field inserted before a ranged field shifts none of its draws", () => {
	const wider = defineModule({
		name: "traits",
		schema: { traits: { early: "u8", bold: "u8", calm: "i16", wide: "i32" } },
		config: {},
		setup() {},
	});
	const before = world();
	const after = world(1, [wider]);
	expect(traitsOf(after, spawnMany(after, 20))).toEqual(
		traitsOf(before, spawnMany(before, 20)),
	);
});

test("a module's deferred spawn draws what a direct spawn with the same id draws", () => {
	const breeder = defineModule({
		name: "breeder",
		schema: {},
		config: {},
		setup(b) {
			const child = b.species("ranged");
			b.tick((ctx) => ctx.spawn(child, 0, 0, 0 as EntityId));
		},
	});
	const bred = world(1, [traits, breeder]);
	const spawned = bred.eventType("core/spawned");
	bred.runRounds(20);
	const children: EntityId[] = [];
	bred.drainEvents(0, (type, _cause, a) => {
		if (type === spawned) children.push(a as EntityId);
	});
	const direct = world();
	const ids = spawnMany(direct, 20);
	expect(children).toEqual(ids);
	expect(traitsOf(bred, children)).toEqual(traitsOf(direct, ids));
});

test("an explicit spawn value wins and the other ranges draw what they would have", () => {
	const plain = world();
	const given = world();
	const drawn = traitsOf(plain, spawnMany(plain, 5));
	const ids = Array.from({ length: 5 }, () =>
		given.spawn(0, "ranged", 0, 0, { traits: { bold: 250 } }),
	);
	expect(traitsOf(given, ids)).toEqual(
		drawn.map(([, calm]) => [250, calm] as number[]),
	);
});

test("a load restores drawn and given values without drawing again", () => {
	const w = world();
	const ids = [
		...spawnMany(w, 5),
		w.spawn(0, "ranged", 0, 0, { traits: { bold: 250 } }),
	];
	const values = traitsOf(w, ids);
	const loaded = loadWorld(w.save(), {
		modules: [traits],
		species: { ranged, narrow },
	});
	expect(traitsOf(loaded as never, ids)).toEqual(values);
});

test("a range enters the fingerprint: a save refuses a world with other bounds", () => {
	const w = world();
	spawnMany(w, 1);
	const wider = {
		...ranged,
		components: {
			traits: { ...ranged.components.traits, bold: { min: 20, max: 141 } },
		},
	};
	expect(() =>
		loadWorld(w.save(), {
			modules: [traits],
			species: { ranged: wider, narrow },
		}),
	).toThrow(/fingerprint/);
});

test("a traveller arrives with its drawn and given values", () => {
	const w = createWorld({
		seed: 1,
		floors: 2,
		width: 8,
		height: 8,
		modules: [climber, probe, traits],
	});
	const body = {
		...climberBody,
		components: {
			...climberBody.components,
			traits: ranged.components.traits,
		},
	};
	aimAt("stairs");
	w.spawn(0, stairsTo(1, 5, 6), 2, 2);
	const id = w.spawn(0, body, 3, 3, { traits: { bold: 250 } });
	const before = traitsOf(w, [id]);
	w.runRounds(4);
	expect(w.locate(id)).toEqual({ floor: 1, x: 5, y: 6 });
	expect(traitsOf(w, [id])).toEqual(before);
});

test("a range that cannot be drawn into its column throws when the species compiles", () => {
	const bad: [string, object, RegExp][] = [
		["min above max", { bold: { min: 9, max: 8 } }, /min 9 above max 8/],
		["a bound above the kind", { bold: { min: 0, max: 256 } }, /does not fit/],
		[
			"a bound below the kind",
			{ calm: { min: -40000, max: 0 } },
			/does not fit/,
		],
		["a fraction", { bold: { min: 0.5, max: 2 } }, /not an integer/],
		["too wide", { wide: { min: 0, max: 0x10000 } }, /wider than 65536/],
	];
	for (const [name, fields, message] of bad) {
		const shape = { actor: false, components: { traits: fields } };
		expect(() => world(1, [traits], { shape }), name).toThrow(message);
		expect(() => world().spawn(0, shape as never, 0, 0), name).toThrow(message);
	}
	const full = {
		actor: false,
		components: { traits: { wide: { min: 0, max: 0xffff } } },
	};
	expect(() => world(1, [traits], { full })).not.toThrow();
});

test("a spawn value holding a range throws", () => {
	const range = { traits: { bold: { min: 1, max: 2 } } };
	expect(() => world().spawn(0, "ranged", 0, 0, range as never)).toThrow(
		/traits.bold is not an integer/,
	);
});

test("a core field takes no range", () => {
	const shape = {
		actor: true,
		components: { vitality: { hp: { min: 1, max: 2 }, max: 2 } },
	};
	expect(() => world(1, [traits], { shape })).toThrow(/vitality.hp/);
});
