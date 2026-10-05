import { expect, test } from "bun:test";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import type { EntityId } from "../../../src/core/api";
import { PERCEPTION_RADIUS } from "../../../src/core/config";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createWorld } from "../../../src/core/world";
import { fear } from "../../../src/modules/fear";
import { hunger } from "../../../src/modules/hunger";
import { probe } from "../../fixtures";

// Without wander, sated stoats and obstacles stand still: only the rat moves.
const prey = { ...rat, components: { ...rat.components, where: {} } };
const OBSTACLE = { actor: true, components: {} };
type Point = readonly [number, number];
const chebyshev = (a: Point, b: Point) =>
	Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

const fleeOnce = (
	width: number,
	height: number,
	from: Point,
	stoats: readonly Point[],
	obstacles: readonly Point[] = [],
) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width,
		height,
		modules: [hunger, fear, probe],
	});
	const id: EntityId = world.spawn(0, prey, from[0], from[1]);
	for (const [x, y] of stoats) world.spawn(0, stoat, x, y);
	for (const [x, y] of obstacles) world.spawn(0, OBSTACLE, x, y);
	world.runRounds(2);
	return [world.peek("where", "x", id), world.peek("where", "y", id)] as const;
};

test("a rat between two stoats steps closer to neither", () => {
	const stoats: Point[] = [
		[0, 2],
		[4, 5],
	];
	const to = fleeOnce(6, 7, [2, 4], stoats);
	for (const s of stoats)
		expect(chebyshev(to, s)).toBeGreaterThanOrEqual(chebyshev([2, 4], s));
});

const SEEDS = 12;
const TRIALS = 25;

test("fuzz: a fleeing rat never ends closer to any stoat it could see", () => {
	let fled = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		let n = 0;
		const roll = (bound: number) =>
			bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), bound);
		for (let trial = 0; trial < TRIALS; trial++) {
			const width = 4 + roll(5);
			const height = 4 + roll(5);
			const taken = new Set<number>();
			const free = (): Point => {
				for (;;) {
					const p: Point = [roll(width), roll(height)];
					if (taken.has(p[1] * width + p[0])) continue;
					taken.add(p[1] * width + p[0]);
					return p;
				}
			};
			const from = free();
			const stoats = Array.from({ length: 1 + roll(3) }, free);
			const obstacles = Array.from({ length: roll(4) }, free);
			const to = fleeOnce(width, height, from, stoats, obstacles);
			if (to[0] !== from[0] || to[1] !== from[1]) fled++;
			for (const s of stoats)
				if (chebyshev(from, s) <= PERCEPTION_RADIUS)
					expect({ seed, trial, s, d: chebyshev(to, s) }).toEqual({
						seed,
						trial,
						s,
						d: Math.max(chebyshev(to, s), chebyshev(from, s)),
					});
		}
	}
	expect(fled).toBeGreaterThan(SEEDS * TRIALS * 0.3);
});
