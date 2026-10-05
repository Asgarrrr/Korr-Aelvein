import { rat } from "../src/content/species/rat";
import { hungerConfig } from "../src/modules/hunger/config";
import { benchFloor, CHEESE, ms, RATS, SIDE, stats } from "./floor";

const WARMUP = 20;
const ROUNDS = 100;
const HUNGRY_MARGIN = 50;

function regime(name: string, satiety: number): void {
	const { world, rats } = benchFloor(satiety);
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

	const { median, p95 } = stats(samples);
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
