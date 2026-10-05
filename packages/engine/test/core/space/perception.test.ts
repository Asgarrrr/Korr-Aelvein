import { expect, test } from "bun:test";
import {
	defineModule,
	type EntityId,
	type Perception,
} from "../../../src/core/api";
import { MAX_PERCEIVED } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world";

test("perception lists rings outward, rows top to bottom, newest first in a cell", () => {
	const seen: number[][] = [];
	const eye = defineModule({
		name: "eye",
		schema: { eye: { on: "u8" } },
		config: {},
		setup(b) {
			const eyes = b.query(["eye"]);
			b.propose((_ctx, actor, p) => {
				if (!eyes.has(actor) || seen.length > 0) return;
				for (let i = 0; i < p.count; i++)
					seen.push([p.id(i), p.dist(i), p.dx(i), p.dy(i)]);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [eye],
	});
	const item = { actor: false, components: {} };
	world.spawn(0, { actor: true, components: { eye: {} } }, 3, 3);
	const a = world.spawn(0, item, 3, 3);
	const b = world.spawn(0, item, 4, 4);
	const c = world.spawn(0, item, 2, 3);
	const d = world.spawn(0, item, 3, 2);
	const e = world.spawn(0, item, 6, 0);
	const f = world.spawn(0, item, 0, 6);
	const g = world.spawn(0, item, 5, 3);
	const h = world.spawn(0, item, 5, 3);
	world.spawn(0, item, 7, 3);
	world.runRounds(1);
	expect(seen).toEqual([
		[a, 0, 0, 0],
		[d, 1, 0, -1],
		[c, 1, -1, 0],
		[b, 1, 1, 1],
		[h, 2, 2, 0],
		[g, 2, 2, 0],
		[e, 3, 3, -3],
		[f, 3, -3, 3],
	]);
});

const watcher = (record: (p: Perception) => void) =>
	defineModule({
		name: "watcher",
		schema: { eye: { on: "u8" } },
		config: {},
		setup(b) {
			const eyes = b.query(["eye"]);
			b.propose((_ctx, actor, p) => {
				if (eyes.has(actor)) record(p);
			});
		},
	});
const observer = { actor: true, components: { eye: {} } };
const item = { actor: false, components: {} };

test("a crowd past MAX_PERCEIVED is cut at the limit, nearest first", () => {
	let seen: number[] = [];
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [
			watcher((p) => {
				seen = [];
				for (let i = 0; i < p.count; i++) seen.push(p.id(i));
			}),
		],
	});
	world.spawn(0, observer, 0, 0);
	const near = world.spawn(0, item, 0, 0);
	const crowd: EntityId[] = [];
	for (let i = 0; i < MAX_PERCEIVED + 5; i++)
		crowd.push(world.spawn(0, item, 1, 1));
	expect(() => world.runRounds(1)).not.toThrow();
	expect(seen.length).toBe(MAX_PERCEIVED);
	expect(seen[0]).toBe(near);
	expect(seen.slice(1)).toEqual(crowd.reverse().slice(0, MAX_PERCEIVED - 1));
});

test("every accessor reads the acting creature's own perception", () => {
	const seen: number[][] = [];
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [
			watcher((p) =>
				seen.push([p.id(0), p.dx(0), p.dist(0), p.slot(0), p.count]),
			),
		],
	});
	world.spawn(0, observer, 0, 0);
	world.spawn(0, observer, 7, 7);
	const nearA = world.spawn(0, item, 1, 0);
	const nearB = world.spawn(0, item, 6, 7);
	world.runRounds(1);
	expect(seen.map(([id, dx, dist, , count]) => [id, dx, dist, count])).toEqual([
		[nearA, 1, 1, 1],
		[nearB, -1, 1, 1],
	]);
});
