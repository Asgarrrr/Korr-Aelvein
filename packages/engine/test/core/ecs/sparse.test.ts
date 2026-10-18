import { expect, test } from "bun:test";
import { SPARSE_CAP } from "../../../src/core/config";
import { NONE, type Slot } from "../../../src/core/ecs/ids";
import { Storage } from "../../../src/core/ecs/storage";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import {
	type AnyModule,
	type Builder,
	defineModule,
	type Schema,
} from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";

const FLOORS = 2;

const pooled = () => {
	const storage = new Storage(FLOORS, 0);
	const value = storage.sparse.column("u8") as Uint8Array;
	const enter = (floor: number, v: number) => {
		const slot = storage.alloc(floor);
		value[storage.sparse.take(floor, slot)] = v;
		return slot;
	};
	const values = (slots: readonly Slot[]) =>
		slots.map((s) => value[storage.sparse.row(s)]);
	return { storage, value, enter, values };
};

test("a pool row lies in its floor's row space, and a slot without one has none", () => {
	const { storage, enter } = pooled();
	const first = enter(0, 1);
	const other = enter(1, 2);
	const bare = storage.alloc(0);
	expect(storage.sparse.row(first)).toBe(0);
	expect(storage.sparse.row(other)).toBe(SPARSE_CAP);
	expect(storage.sparse.row(bare)).toBe(NONE);
});

test("a release moves the floor's last row into the freed one, and every slot keeps its value", () => {
	const { storage, value, enter, values } = pooled();
	const [a, b, c, d] = [10, 20, 30, 40].map((v) => enter(0, v)) as Slot[];
	storage.release(0, b as Slot);
	expect(storage.sparse.counts[0]).toBe(3);
	expect(values([a, c, d] as Slot[])).toEqual([10, 30, 40]);
	storage.release(0, d as Slot);
	expect(values([a, c] as Slot[])).toEqual([10, 30]);
	expect([...value.subarray(0, 4)]).toEqual([10, 30, 0, 0]);
});

test("releasing the last row or the only row moves nothing", () => {
	const { storage, value, enter, values } = pooled();
	const only = enter(1, 7);
	storage.release(1, only);
	expect(storage.sparse.counts[1]).toBe(0);
	expect(value[SPARSE_CAP]).toBe(0);
	const first = enter(0, 1);
	const last = enter(0, 2);
	storage.release(0, last);
	expect(values([first])).toEqual([1]);
	expect(value[1]).toBe(0);
});

test("a recycled slot starts without a pool row", () => {
	const { storage, enter } = pooled();
	const slot = enter(0, 5);
	storage.release(0, slot);
	const again = storage.alloc(0);
	expect(again).toBe(slot);
	expect(storage.sparse.row(again)).toBe(NONE);
});

test("take refuses a full floor and a slot that already holds a row", () => {
	const { storage, enter } = pooled();
	const held = enter(0, 1);
	expect(() => storage.sparse.take(0, held)).toThrow(/already/);
	for (let i = 1; i < SPARSE_CAP; i++) enter(0, 1);
	expect(storage.sparse.full(0)).toBe(true);
	expect(() => storage.sparse.take(0, storage.alloc(0))).toThrow(/full/);
	expect(storage.sparse.full(1)).toBe(false);
});

test("rebuild restores the back-pointers a later release needs", () => {
	const { storage, value, enter } = pooled();
	const [a, , c] = [1, 2, 3].map((v) => enter(0, v)) as Slot[];
	const copy = new Storage(FLOORS, 0);
	const copied = copy.sparse.column("u8");
	copy.sparse.rowOf.set(storage.sparse.rowOf);
	copy.sparse.counts.set(storage.sparse.counts);
	copied.set(value);
	copy.sparse.rebuild(0, storage.highWater[0] ?? 0);
	copy.sparse.release(0, a as Slot);
	expect(copy.sparse.row(c as Slot)).toBe(0);
	expect(copied[0]).toBe(3);
});

const twoSparse = defineModule({
	name: "pair",
	schema: { a: { v: "u8" }, b: { v: "u8" }, plain: { v: "u8" } },
	sparse: ["a", "b"],
	config: {},
	setup() {},
});

test("a sparse list names only own components, once; dense and sparse access do not mix", () => {
	const shape = { seed: 1, floors: 1, width: 4, height: 4, popCap: 8 };
	const build = (
		sparse: readonly string[],
		setup: (b: Builder<Schema>) => void = () => {},
	) =>
		createEngine({ ...shape, events: false }, [
			{ ...twoSparse, sparse, setup } as AnyModule,
		]);
	expect(() => build(["a", "nope"])).toThrow(/nope/);
	expect(() => build(["a", "a"])).toThrow(/twice/);
	expect(() => build(["a"], (b) => b.write("a"))).toThrow(
		/a is sparse: use b.sparse/,
	);
	expect(() => build(["a"], (b) => b.sparse("plain"))).toThrow(/plain/);
	const reader = defineModule({
		name: "reader",
		schema: {},
		config: {},
		setup(b) {
			(b.read as (name: string) => unknown)("a");
		},
	});
	expect(() =>
		createEngine({ ...shape, events: false }, [twoSparse, reader]),
	).toThrow(/a is sparse and has no read view/);
});

test("a range on a sparse component throws", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 4, height: 4, popCap: 8, events: false },
		[twoSparse],
	);
	expect(() =>
		spawn(
			engine,
			0,
			{ actor: false, components: { a: { v: { min: 1, max: 2 } } } },
			0,
			0,
		),
	).toThrow(/sparse: it takes no range/);
});

test("the audit refuses a pool write to a free row or to a component the owner lacks", () => {
	const culprit = (
		write: (columns: Record<string, Uint8Array>, row: number) => void,
	) =>
		defineModule({
			name: "pair",
			schema: { a: { v: "u8" }, b: { v: "u8" } },
			sparse: ["a", "b"],
			config: {},
			setup(b) {
				const a = b.sparse("a");
				const bee = b.sparse("b");
				const rows = b.query(["a"]);
				b.tick((ctx) => {
					const list = rows.slots(ctx);
					for (let i = 0; i < list.length; i++)
						write({ a: a.columns.v, b: bee.columns.v }, a.row(list.at(i)));
				});
			},
		});
	const run = (
		write: (columns: Record<string, Uint8Array>, row: number) => void,
	) => {
		const engine = createEngine(
			{
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				popCap: 8,
				events: false,
				audit: true,
			},
			[culprit(write)],
		);
		spawn(engine, 0, { actor: false, components: { a: { v: 1 } } }, 0, 0);
		engine.runRound();
	};
	expect(() =>
		run((c, row) => {
			(c.a as Uint8Array)[row] = 2;
		}),
	).not.toThrow();
	expect(() =>
		run((c, row) => {
			(c.a as Uint8Array)[row + 1] = 2;
		}),
	).toThrow(/audit/);
	expect(() =>
		run((c, row) => {
			(c.b as Uint8Array)[row] = 2;
		}),
	).toThrow(/audit: pair wrote b.v/);
});
