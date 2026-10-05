import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import type { EntityId } from "../src/core/ids";
import { bounded, draw, PHASE, SUBJECT } from "../src/core/rng";
import { createWorld } from "../src/core/world";
import { hungerConfig } from "../src/modules/hunger/config";
import { modules } from "../src/registry";

const SEED = 1;
const SIDE = 128;
const RATS = 8000;
const CHEESE = 2000;
const WARMUP = 20;
const ROUNDS = 100;
const HUNGRY_MARGIN = 50;
const P95 = 0.95;
const NS_PER_MS = 1e6;

function regime(name: string, satiety: number): void {
	const world = createWorld({
		seed: SEED,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules,
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

	world.runRounds(WARMUP);
	const samples: number[] = [];
	for (let r = 0; r < ROUNDS; r++) {
		const start = Bun.nanoseconds();
		world.runRounds(1);
		samples.push(Bun.nanoseconds() - start);
	}
	// Every rat acts once per round only while all of them are alive.
	if (!rats.every((id) => world.alive(id)))
		throw new Error(`${name}: a rat died, ns per actor turn would be wrong`);

	samples.sort((a, b) => a - b);
	const median = samples[samples.length >> 1] ?? 0;
	const p95 = samples[Math.floor(samples.length * P95)] ?? 0;
	const ms = (ns: number) => (ns / NS_PER_MS).toFixed(2);
	const perTurn = (ns: number) => (ns / RATS).toFixed(0);
	console.log(`${name} (satiety ${satiety})`);
	console.log(`  floor round     median ${ms(median)} ms   p95 ${ms(p95)} ms`);
	console.log(
		`  per actor turn  median ${perTurn(median)} ns   p95 ${perTurn(p95)} ns`,
	);
	console.log(`  checksum ${world.hash()}`);
}

console.log(
	`slice1: 1 floor ${SIDE}x${SIDE}, ${RATS} rats + ${CHEESE} cheese, ${ROUNDS} rounds after ${WARMUP} warmup`,
);
regime("sated", rat.components.satiety.value);
regime("hungry", hungerConfig.hungryBelow - HUNGRY_MARGIN);
