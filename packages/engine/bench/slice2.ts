import { species } from "../src/content/species";
import { moss } from "../src/content/species/moss";
import { rat } from "../src/content/species/rat";
import { CAP } from "../src/core/config";
import { saveFloor } from "../src/core/image";
import { createEngine } from "../src/core/registration";
import { loadFloor } from "../src/core/validate";
import { hungerConfig } from "../src/modules/hunger/config";
import { modules } from "../src/registry";
import { benchFloor, CHEESE, ms, RATS, SEED, SIDE, stats } from "./floor";

const WARMUP = 20;
const SAMPLES = 50;
const ROUNDS = 100;
const HUNGRY_MARGIN = 50;
const SPROUTS = 1000;
const POP_CAP = 12_000;
const BYTES_PER_KB = 1024;
const LABEL_WIDTH = 14;

const time = (run: () => void) => {
	const start = Bun.nanoseconds();
	run();
	return Bun.nanoseconds() - start;
};

function report(label: string, samples: number[]): void {
	const { median, p95 } = stats(samples);
	console.log(
		`  ${label.padEnd(LABEL_WIDTH)} median ${ms(median)} ms   p95 ${ms(p95)} ms`,
	);
}

function snapshot(): void {
	const { world } = benchFloor(rat.components.satiety.value);
	world.runRounds(WARMUP);
	let image = world.saveFloor(0);
	const saves: number[] = [];
	const loads: number[] = [];
	const hashes: number[] = [];
	const worldSaves: number[] = [];
	// Unrecorded passes first, so every metric is taken warm like the round timings.
	for (let i = -WARMUP; i < SAMPLES; i++) {
		const keep = i >= 0;
		const save = time(() => (image = world.saveFloor(0)));
		const engine = createEngine(
			{
				seed: SEED,
				floors: 1,
				width: SIDE,
				height: SIDE,
				popCap: CAP,
				events: true,
			},
			modules,
			species,
		);
		engine.round = WARMUP;
		const load = time(() => loadFloor(engine, image, 0));
		if (!saveFloor(engine, 0).every((byte, j) => byte === image[j]))
			throw new Error("a restored floor saves different bytes");
		const hash = time(() => world.hash());
		const worldSave = time(() => world.save());
		if (!keep) continue;
		saves.push(save);
		loads.push(load);
		hashes.push(hash);
		worldSaves.push(worldSave);
	}
	console.log(
		`snapshot (image ${(image.length / BYTES_PER_KB).toFixed(0)} KiB)`,
	);
	report("saveFloor", saves);
	report("restore floor", loads);
	report("hash", hashes);
	report("save world", worldSaves);
	console.log(`  checksum ${world.hash()}`);
}

function regrowth(): void {
	const satiety = hungerConfig.hungryBelow - HUNGRY_MARGIN;
	const { world, rats, coord } = benchFloor(satiety, POP_CAP);
	for (let i = 0; i < SPROUTS; i++) world.spawn(0, moss, coord(), coord());
	world.runRounds(WARMUP);
	const perTurn: number[] = [];
	let spawned = 0;
	const spawnedType = world.eventType("core/spawned");
	world.drainEvents(0, () => {});
	for (let r = 0; r < ROUNDS; r++) {
		const actors = rats.filter((id) => world.alive(id)).length;
		perTurn.push(time(() => world.runRounds(1)) / actors);
		world.drainEvents(0, (type) => {
			if (type === spawnedType) spawned++;
		});
	}
	const { median, p95 } = stats(perTurn);
	const alive = rats.filter((id) => world.alive(id)).length;
	console.log(
		`regrowth (satiety ${satiety}, ${SPROUTS} sprouts, popCap ${POP_CAP})`,
	);
	console.log(
		`  per actor turn  median ${median.toFixed(0)} ns   p95 ${p95.toFixed(0)} ns`,
	);
	console.log(`  ${spawned} mushrooms spawned, ${alive} of ${RATS} rats alive`);
	console.log(`  checksum ${world.hash()}`);
}

console.log(
	`slice2: 1 floor ${SIDE}x${SIDE}, ${RATS} rats + ${CHEESE} cheese, ${WARMUP} warmup rounds`,
);
snapshot();
regrowth();
