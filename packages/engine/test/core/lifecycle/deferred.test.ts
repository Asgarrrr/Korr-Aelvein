import { expect, test } from "bun:test";
import {
	defineModule,
	type EntityId,
	type Slot,
	type SpeciesRef,
	type SpeciesShape,
	type WriteCtx,
} from "../../../src/core/api";
import { EVENT_CAP_PER_TURN } from "../../../src/core/config";
import { DeferredKills } from "../../../src/core/lifecycle/deferred";
import { createWorld } from "../../../src/core/world";

const seed = { actor: false, components: { patch: { kind: 1 } } };

// Kills and spawns from several rows; `reverse` flips the row iteration order.
// It is not config: config is part of the world hash, which the test compares.
const gardener = (reverse: boolean) =>
	defineModule({
		name: "gardener",
		schema: { patch: { kind: "u8" } },
		config: {},
		setup(b) {
			const patch = b.write("patch");
			const rows = b.query(["patch"]);
			const sprout = b.species(seed);
			b.tick((ctx, floor) => {
				const list = rows.slots(floor);
				const slots: Slot[] = [];
				for (let i = 0; i < list.length; i++) slots.push(list.at(i));
				if (reverse) slots.reverse();
				const keeperSlot = slots.find((s) => patch.kind[s] === 2);
				if (keeperSlot === undefined) return;
				const keeper = ctx.idOf(keeperSlot);
				for (const s of slots) {
					if (patch.kind[s] !== 1) continue;
					const id = ctx.idOf(s);
					ctx.spawn(sprout, (ctx.x(s) + 1) % 8, ctx.y(s), id);
					ctx.spawn(sprout, ctx.x(s), (ctx.y(s) + 1) % 8, keeper);
					ctx.kill(id, keeper);
				}
			});
		},
	});

const hashFor = (reverse: boolean) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [gardener(reverse)],
	});
	world.spawn(0, { actor: false, components: { patch: { kind: 2 } } }, 0, 0);
	for (let i = 0; i < 4; i++) world.spawn(0, seed, (i * 3) % 8, i);
	world.runRounds(3);
	return world.hash();
};

test("tick kills and spawns do not depend on row iteration order", () => {
	expect(hashFor(true)).toBe(hashFor(false));
});

test("deferred kills apply in (cause, target id) order", () => {
	const kills = new DeferredKills();
	const pairs = [
		[5, 2],
		[3, 1],
		[9, 1],
		[4, 2],
		[1, 1],
		[7, 3],
		[2, 2],
	];
	for (const [id, cause] of pairs)
		kills.push(id as EntityId, cause as EntityId);
	kills.sort();
	const applied = Array.from(
		kills.order.subarray(0, kills.count),
		(n) => kills.ids[n],
	);
	expect(applied).toEqual([1, 3, 9, 2, 4, 5, 7]);
});

const tagged = (v: number) => ({ actor: false, components: { tag: { v } } });

const sower = defineModule({
	name: "sower",
	schema: { tag: { v: "u8" } },
	config: {},
	setup(b) {
		const tag = b.write("tag");
		const rows = b.query(["tag"]);
		const [t1, t2, t3, t4, t5, t6] = [1, 2, 3, 4, 5, 6].map((v) =>
			b.species(tagged(v)),
		) as SpeciesRef[] as [
			SpeciesRef,
			SpeciesRef,
			SpeciesRef,
			SpeciesRef,
			SpeciesRef,
			SpeciesRef,
		];
		b.tick((ctx, floor) => {
			const list = rows.slots(floor);
			let first: EntityId | undefined;
			let second: EntityId | undefined;
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				if (tag.v[s] === 200) first = ctx.idOf(s);
				if (tag.v[s] === 201) second = ctx.idOf(s);
			}
			if (first === undefined || second === undefined) return;
			const [one, two] = first < second ? [first, second] : [second, first];
			ctx.spawn(t1, 0, 1, two);
			ctx.spawn(t2, 2, 0, one);
			ctx.spawn(t3, 0, 1, one);
			ctx.spawn(t4, 0, 0, two);
			ctx.spawn(t5, 0, 1, one);
			ctx.spawn(t6, 1, 0, one);
			for (let i = 0; i < list.length; i++) tag.v[list.at(i)] = 0;
		});
	},
});

test("tick spawns apply in (cause, cell, emission) order", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [sower],
	});
	world.spawn(0, tagged(200), 5, 5);
	world.spawn(0, tagged(201), 6, 6);
	world.runRounds(1);
	const tags = [3, 4, 5, 6, 7, 8].map((id) =>
		world.peek("tag", "v", id as EntityId),
	);
	expect(tags).toEqual([6, 2, 3, 5, 4, 1]);
});

const body = { actor: true, components: { body: {} } };
const crumb = { actor: false, components: { body: {} } };
const NO_CAUSE = 0 as EntityId;

const once = (
	emit: (ctx: WriteCtx, body: SpeciesRef, crumb: SpeciesRef) => void,
) => {
	let fired = false;
	return defineModule({
		name: "once",
		schema: { body: { k: "u8" } },
		config: {},
		setup(b) {
			const refs = [body, crumb].map((s: SpeciesShape) => b.species(s));
			b.tick((ctx) => {
				if (fired) return;
				fired = true;
				emit(ctx, refs[0] as SpeciesRef, refs[1] as SpeciesRef);
			});
		},
	});
};

test("a deferred actor spawn onto an actor is refused, items still land", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [
			once((ctx, actor, item) => {
				ctx.spawn(actor, 1, 1, NO_CAUSE);
				ctx.spawn(actor, 1, 1, NO_CAUSE);
				ctx.spawn(item, 1, 1, NO_CAUSE);
			}),
		],
	});
	world.runRounds(1);
	expect([1, 2, 3].map((id) => world.alive(id as EntityId))).toEqual([
		true,
		true,
		false,
	]);
	expect(() => world.runRounds(1)).not.toThrow();
});

test("an invalid ctx.spawn throws where it is emitted", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [once((ctx, _actor, item) => ctx.spawn(item, 99, 0, NO_CAUSE))],
	});
	expect(() => world.runRounds(1)).toThrow(/outside the floor/);
});

test("a round that throws mid-way poisons the world", () => {
	let fired = false;
	// The second spawn's core/spawned event is one past the per-turn cap.
	const flood = defineModule({
		name: "flood",
		schema: { body: { k: "u8" } },
		config: {},
		setup(b) {
			const noise = b.event("noise");
			const item = b.species(crumb);
			b.tick((ctx) => {
				if (fired) return;
				fired = true;
				for (let i = 1; i < EVENT_CAP_PER_TURN; i++)
					ctx.emit(noise, NO_CAUSE, i, 0);
				ctx.spawn(item, 0, 0, NO_CAUSE);
				ctx.spawn(item, 0, 0, NO_CAUSE);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [flood],
	});
	expect(() => world.runRounds(1)).toThrow(/events/);
	const calls: (() => unknown)[] = [
		() => world.runRounds(1),
		() => world.hash(),
		() => world.save(),
		() => world.saveFloor(0),
		() => world.spawn(0, crumb, 1, 1),
		() => world.alive(1 as EntityId),
		() => world.peek("body", "k", 1 as EntityId),
		() => world.drainEvents(0, () => {}),
		() => world.setEvents(0, false),
		() => world.eventType("flood/noise"),
	];
	for (const call of calls) expect(call).toThrow(/poisoned/);
});
