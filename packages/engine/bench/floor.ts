import { species } from "../src/content/species";
import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import type { EntityId } from "../src/core/ids";
import { bounded, draw, PHASE, SUBJECT } from "../src/core/rng";
import { createWorld } from "../src/core/world";
import { modules } from "../src/registry";

export const SEED = 1;
export const SIDE = 128;
export const RATS = 8000;
export const CHEESE = 2000;
const P95 = 0.95;
const NS_PER_MS = 1e6;
const MS_DECIMALS = 3;

export function benchFloor(satiety: number, popCap?: number) {
	const world = createWorld({
		seed: SEED,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules,
		species,
		...(popCap === undefined ? {} : { popCap }),
	});
	const ratSpecies = { ...rat, components: { satiety: { value: satiety } } };
	const taken = new Uint8Array(SIDE * SIDE);
	let n = 0;
	const coord = () =>
		bounded(draw(SEED, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	const rats: EntityId[] = [];
	while (rats.length < RATS) {
		const x = coord();
		const y = coord();
		if (taken[y * SIDE + x]) continue;
		taken[y * SIDE + x] = 1;
		rats.push(world.spawn(0, ratSpecies, x, y));
	}
	for (let i = 0; i < CHEESE; i++) world.spawn(0, cheese, coord(), coord());
	return { world, rats, coord };
}

export function stats(samples: number[]) {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		median: sorted[sorted.length >> 1] ?? 0,
		p95: sorted[Math.floor(sorted.length * P95)] ?? 0,
	};
}

export const ms = (ns: number) => (ns / NS_PER_MS).toFixed(MS_DECIMALS);
