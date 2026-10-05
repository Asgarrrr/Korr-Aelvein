import { species } from "../src/content/species";
import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import { defineModule } from "../src/core/api";
import { CAP, LOD_PERIODS, TICKS_PER_TURN } from "../src/core/config";
import { NONE } from "../src/core/ecs/ids";
import { type Engine, FLOOR_STAGE } from "../src/core/engine";
import { spawn } from "../src/core/lifecycle/lifecycle";
import { bounded, draw, PHASE, SUBJECT } from "../src/core/random/rng";
import { createEngine } from "../src/core/setup/registration";
import { advance, playerTurn, startRound } from "../src/core/turns/round";
import { beginFloor, runActors } from "../src/core/turns/turn";
import { hungerConfig } from "../src/modules/hunger/config";
import { modules } from "../src/registry";
import { CHEESE, ms, RATS, SEED, SIDE, stats } from "./floor";

const DEFAULT_FLOORS = 8;
// `bun bench/slice5.ts 50` runs the reference world's floor count.
const FLOORS = Number(Bun.argv[2] ?? DEFAULT_FLOORS);
const WARMUP = 20;
const ROUNDS = 100;
const NS_PER_US = 1000;
const US_DECIMALS = 1;
const LABEL_WIDTH = 34;
const HUNGRY_MARGIN = 50;

function build(withPlayer: boolean, satiety: number): Engine {
	const e = createEngine(
		{
			seed: SEED,
			floors: FLOORS,
			width: SIDE,
			height: SIDE,
			popCap: CAP,
			events: true,
		},
		modules,
		species,
	);
	const body = {
		...rat,
		components: { ...rat.components, satiety: { value: satiety } },
	};
	let n = 0;
	const coord = () =>
		bounded(draw(SEED, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	for (let f = 0; f < FLOORS; f++) {
		const taken = new Uint8Array(SIDE * SIDE);
		let rats = 0;
		while (rats < RATS + (withPlayer && f === 0 ? 1 : 0)) {
			const x = coord();
			const y = coord();
			if (taken[y * SIDE + x]) continue;
			taken[y * SIDE + x] = 1;
			const player = withPlayer && f === 0 && rats === RATS;
			spawn(e, f, body, x, y, player);
			rats++;
		}
		for (let i = 0; i < CHEESE; i++) spawn(e, f, cheese, coord(), coord());
	}
	return e;
}

interface Sample {
	round: number;
	ticks: number[];
	actors: number[];
	turns: number[];
}

// One round, floor by floor, the due player idling: the phases a world's advance runs.
function round(e: Engine, sample: Sample): void {
	const start = Bun.nanoseconds();
	startRound(e);
	for (let f = 0; f < FLOORS; f++) {
		const turns = e.scheduler.size(f);
		const t0 = Bun.nanoseconds();
		beginFloor(e, f);
		const t1 = Bun.nanoseconds();
		for (let due = runActors(e, f); due !== NONE; due = runActors(e, f))
			playerTurn(e, f, due, e.idleIndex, 0);
		const t2 = Bun.nanoseconds();
		sample.ticks[f] = t1 - t0;
		sample.actors[f] = t2 - t1;
		sample.turns[f] = turns;
	}
	if (advance(e).length > 0 || e.stage[0] !== FLOOR_STAGE.waiting)
		throw new Error("the round did not close");
	sample.round = Bun.nanoseconds() - start;
}

function regime(label: string, withPlayer: boolean, satiety: number): void {
	const e = build(withPlayer, satiety);
	const samples: Sample[] = [];
	for (let r = -WARMUP; r < ROUNDS; r++) {
		const sample: Sample = { round: 0, ticks: [], actors: [], turns: [] };
		round(e, sample);
		if (r >= 0) samples.push(sample);
	}
	const { median, p95 } = stats(samples.map((s) => s.round));
	console.log(`${label} (satiety ${satiety})`);
	console.log(
		`  ${"world round".padEnd(LABEL_WIDTH)} median ${ms(median)} ms   p95 ${ms(p95)} ms`,
	);
	const tiers = new Map<number, number[]>();
	for (let f = 0; f < FLOORS; f++) {
		const period = withPlayer
			? (LOD_PERIODS[Math.min(f, LOD_PERIODS.length - 1)] ?? 1)
			: 1;
		tiers.set(period, [...(tiers.get(period) ?? []), f]);
	}
	for (const [period, floors] of tiers) {
		const perTurn = samples.flatMap((s) =>
			floors.map((f) => (s.actors[f] ?? 0) / (s.turns[f] ?? 1)),
		);
		const ticks = samples.flatMap((s) =>
			floors.map((f) => (s.ticks[f] ?? 0) / NS_PER_US),
		);
		const turn = stats(perTurn);
		const tick = stats(ticks);
		console.log(
			`  ${`P=${period} (floors ${floors.join(",")}) actor turn`.padEnd(LABEL_WIDTH)} median ${turn.median.toFixed(0)} ns   p95 ${turn.p95.toFixed(0)} ns`,
		);
		console.log(
			`  ${`P=${period} ticks per floor`.padEnd(LABEL_WIDTH)} median ${tick.median.toFixed(US_DECIMALS)} µs   p95 ${tick.p95.toFixed(US_DECIMALS)} µs`,
		);
	}
}

// The core's own cost per turn: one module whose single action only waits, on the floor
// farthest from the player, so 63 turns in 64 re-execute the cached decision.
const still = defineModule({
	name: "still",
	schema: {},
	config: {},
	setup(b) {
		const wait = b.action("wait", "none", [], () => TICKS_PER_TURN);
		b.propose((_ctx, _actor, _perception, out) => {
			out.push(wait, null, 1);
		});
	},
});

function overhead(withPlayer: boolean): number {
	const far = LOD_PERIODS.length - 1;
	const e = createEngine(
		{
			seed: SEED,
			floors: far + 1,
			width: SIDE,
			height: SIDE,
			popCap: CAP,
			events: true,
		},
		[still],
	);
	const body = { actor: true, components: {} };
	for (let i = 0; i < RATS; i++)
		spawn(e, far, body, i % SIDE, Math.floor(i / SIDE));
	if (withPlayer) spawn(e, 0, body, 0, 0, true);
	const samples: number[] = [];
	for (let r = -WARMUP; r < ROUNDS; r++) {
		startRound(e);
		for (let f = 0; f < far; f++) {
			beginFloor(e, f);
			for (let due = runActors(e, f); due !== NONE; due = runActors(e, f))
				playerTurn(e, f, due, e.idleIndex, 0);
		}
		beginFloor(e, far);
		const start = Bun.nanoseconds();
		runActors(e, far);
		if (r >= 0) samples.push((Bun.nanoseconds() - start) / RATS);
		advance(e);
	}
	return stats(samples).median;
}

console.log(
	`slice5: ${FLOORS} floors ${SIDE}x${SIDE}, ${RATS} rats + ${CHEESE} cheese each, ${ROUNDS} rounds after ${WARMUP} warmup`,
);
const sated = rat.components.satiety.value;
const hungry = hungerConfig.hungryBelow - HUNGRY_MARGIN;
regime("one player on floor 0, LOD on", true, sated);
regime("no player, P = 1 everywhere", false, sated);
regime("one player on floor 0, LOD on", true, hungry);
regime("no player, P = 1 everywhere", false, hungry);
console.log(`core overhead: ${RATS} actors whose one action waits`);
console.log(
	`  ${`P=${LOD_PERIODS.at(-1)}, cached re-execution`.padEnd(LABEL_WIDTH)} median ${overhead(true).toFixed(0)} ns per actor turn`,
);
console.log(
	`  ${"P=1, full arbitration".padEnd(LABEL_WIDTH)} median ${overhead(false).toFixed(0)} ns per actor turn`,
);
