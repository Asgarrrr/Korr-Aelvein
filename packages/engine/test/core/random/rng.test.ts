import { expect, test } from "bun:test";
import { type Cell, defineModule, type EntityId } from "../../../src/core/api";
import {
	bounded,
	draw,
	hashName,
	PHASE,
	SUBJECT,
} from "../../../src/core/random/rng";
import { createWorld } from "../../../src/core/world";

const E = SUBJECT.entity;
const C = SUBJECT.cell;

test("draw returns pinned golden values", () => {
	const key = hashName("wander");
	expect([
		key,
		draw(1, key, PHASE.propose, 0, E, 1, 0),
		draw(1, key, PHASE.propose, 0, E, 1, 1),
		draw(2, key, PHASE.tick, 300, C, 33554433, 0),
		draw(0xffffffff, key, PHASE.action, 0, E, 1, 0),
	]).toEqual([4047560748, 701526728, 2602044480, 139169998, 3360131658]);
});

test("every input of draw changes the result", () => {
	const base = draw(7, 11, PHASE.action, 100, E, 5, 3);
	expect(draw(8, 11, PHASE.action, 100, E, 5, 3)).not.toBe(base);
	expect(draw(7, 12, PHASE.action, 100, E, 5, 3)).not.toBe(base);
	expect(draw(7, 11, PHASE.tick, 100, E, 5, 3)).not.toBe(base);
	expect(draw(7, 11, PHASE.action, 101, E, 5, 3)).not.toBe(base);
	expect(draw(7, 11, PHASE.action, 100, C, 5, 3)).not.toBe(base);
	expect(draw(7, 11, PHASE.action, 100, E, 6, 3)).not.toBe(base);
	expect(draw(7, 11, PHASE.action, 100, E, 5, 4)).not.toBe(base);
});

test("bounded draws spread evenly over 16 buckets", () => {
	const buckets = 16;
	const samples = 65536;
	const counts = new Array<number>(buckets).fill(0);
	for (let n = 0; n < samples; n++) {
		const b = bounded(
			draw(1, hashName("chi"), PHASE.tick, 0, E, 1, n),
			buckets,
		);
		counts[b] = (counts[b] ?? 0) + 1;
	}
	const expected = samples / buckets;
	const chi = counts.reduce(
		(sum, c) => sum + (c - expected) ** 2 / expected,
		0,
	);
	// 15 degrees of freedom: 37.7 is the p = 0.001 critical value.
	expect(chi).toBeLessThan(37.7);
});

test("cell draws differ across floors and from entity draws", () => {
	const roll = defineModule({
		name: "roll",
		schema: { roll: { cell: "u16", entity: "u16" } },
		config: {},
		setup(b) {
			const out = b.write("roll");
			const rows = b.query(["roll"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				for (let i = 0; i < list.length; i++) {
					const s = list.at(i);
					const cell = ctx.cellAt(1, 0);
					out.cell[s] = ctx.rngCell(cell, 0, 60000);
					out.entity[s] = ctx.rng(cell as number as EntityId, 0, 60000);
				}
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 3,
		width: 8,
		height: 8,
		modules: [roll],
	});
	const ids = [0, 1, 2].map((f) =>
		world.spawn(f, { actor: false, components: { roll: {} } }, 0, 0),
	);
	world.runRounds(1);
	const cells = ids.map((id) => world.peek("roll", "cell", id));
	expect(new Set(cells).size).toBe(3);
	const first = ids[0] as EntityId;
	expect(world.peek("roll", "entity", first)).not.toBe(cells[0]);
});

test("rngCell rejects a cell that is not on the floor", () => {
	for (const cell of [-1, 64]) {
		const roller = defineModule({
			name: "roller",
			schema: { roll: { v: "u8" } },
			config: {},
			setup(b) {
				b.tick((ctx) => {
					ctx.rngCell(cell as Cell, 0, 2);
				});
			},
		});
		const world = createWorld({
			seed: 1,
			floors: 1,
			width: 8,
			height: 8,
			modules: [roller],
		});
		expect(() => world.runRounds(1)).toThrow(/not on the floor/);
	}
});

test("a seed outside u32 is rejected", () => {
	for (const seed of [-1, 2 ** 32, 1.5, Number.NaN])
		expect(() =>
			createWorld({ seed, floors: 1, width: 4, height: 4, modules: [] }),
		).toThrow(/seed/);
});
