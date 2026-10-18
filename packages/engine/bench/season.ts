import { catalogue } from "../src/content/catalogue";
import { foodWeb } from "../src/content/catalogue/web";
import {
	CAP,
	ID_FLOOR_STRIDE,
	LOD_PERIODS,
	MAX_TICK,
	TICKS_PER_TURN,
} from "../src/core/config";
import { ACTOR, ALIVE } from "../src/core/ecs/storage";
import type { Engine } from "../src/core/engine";
import type { AnyModule } from "../src/core/module/api";
import { engineDigest, hashHex } from "../src/core/persistence/hash";
import { hunger } from "../src/modules/hunger";
import { modules as gameModules } from "../src/registry";
import { stats } from "./floor";
import { SIDE } from "./reference/world";
import { KS_REJECT, KS_SEEDS, ksStatistic } from "./season/fidelity";
import { buildSeason } from "./season/world";

const SEED = 1;
const PERIODS = [...new Set(LOD_PERIODS)];
const RERUN_PERIOD = 16;
const WINDOW = 200;
const DEFAULT_ROUNDS = 2000;
const DEFAULT_FLOORS = 40;
const MEMORY_ROUNDS = 60;
const FIDELITY_FLOORS = 4;
const FIDELITY_SIDE = 64;
const DEFAULT_SEEDS = KS_SEEDS;
const DEFAULT_FIDELITY_ROUNDS = 1000;
const STARVING = 2;
const PERCENT = 100;
const RSS_BUDGET_MB = 160;
// The checkpoint model holds two worlds at once, the live one and the loaded result, each
// within the per-world budget; the checkpoint image fits in their slack.
const PEAK_BUDGET_MB = 2 * RSS_BUDGET_MB;
const NS_PER_MS = 1e6;
const NS_PER_S = 1e9;
const BYTES_PER_MB = 1e6;
const LABEL = 40;
const P_CELL = 6;

const arg = (value: string | undefined, fallback: number) =>
	Number(value ?? fallback);
const mb = (bytes: number) => `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
const verdict = (pass: boolean) => (pass ? "PASS" : "FAIL");

const hashOf = (e: Engine) => {
	engineDigest(e);
	return hashHex(e.digest);
};

// Runs whole rounds as a server would, draining every floor's events after each; returns deaths.
function play(e: Engine, rounds: number, after?: (r: number) => void): number {
	const died = e.died.key;
	let deaths = 0;
	const count = (type: number) => {
		if (type === died) deaths++;
	};
	for (let r = 0; r < rounds; r++) {
		e.runRound();
		for (let f = 0; f < e.storage.floors; f++) e.events.drain(f, count);
		after?.(r);
	}
	return deaths;
}

// Live entities by species name, live actors by floor, and the actors' mean boldness x100.
function census(e: Engine) {
	const { masks, maskWords, floors, highWater } = e.storage;
	const bySpecies = new Int32Array(e.speciesNames.length + 1);
	const actors = new Int32Array(floors);
	const temperament = e.components.get("temperament");
	const boldness = temperament?.columns.boldness;
	let bold = 0;
	let tempered = 0;
	for (let f = 0; f < floors; f++)
		for (let s = f * CAP; s < f * CAP + (highWater[f] ?? 0); s++) {
			const head = masks[s * maskWords] ?? 0;
			if ((head & ALIVE) === 0) continue;
			const index = e.speciesIndex[s] ?? 0;
			bySpecies[index] = (bySpecies[index] ?? 0) + 1;
			if ((head & ACTOR) === 0) continue;
			actors[f] = (actors[f] ?? 0) + 1;
			if (!temperament || !boldness) continue;
			const word = masks[s * maskWords + temperament.bit.word] ?? 0;
			if ((word & temperament.bit.bit) === 0) continue;
			bold += boldness[s] ?? 0;
			tempered++;
		}
	const population = new Map(
		e.speciesNames.map((name, i) => [name, bySpecies[i + 1] ?? 0]),
	);
	const boldness100 =
		tempered === 0 ? 0 : Math.floor((bold * PERCENT) / tempered);
	return { population, actors, boldness100 };
}

function timed(period: number, rounds: number, floors: number) {
	const e = buildSeason(SEED, floors, SIDE);
	e.unwatchedPeriod = period;
	const born = e.storage.counters.slice();
	const windows = new Float64Array(Math.ceil(rounds / WINDOW));
	const start = Bun.nanoseconds();
	let last = start;
	play(e, rounds, (r) => {
		const now = Bun.nanoseconds();
		const w = Math.floor(r / WINDOW);
		windows[w] = (windows[w] ?? 0) + now - last;
		last = now;
	});
	const { actors } = census(e);
	const { counters, highWater, freeCount } = e.storage;
	let births = 0;
	let live = 0;
	for (let f = 0; f < floors; f++) {
		births = Math.max(births, (counters[f] ?? 0) - (born[f] ?? 0));
		live += (highWater[f] ?? 0) - (freeCount[f] ?? 0);
	}
	const perRound = windows.map(
		(ns, w) => ns / NS_PER_MS / Math.min(WINDOW, rounds - w * WINDOW),
	);
	return {
		period,
		seconds: (last - start) / NS_PER_S,
		perRound,
		actors: [...actors],
		live,
		births: births / rounds,
		hash: hashOf(e),
	};
}

function timeMode(rounds: number, floors: number): void {
	console.log(
		`season time: ${floors} floors ${SIDE}x${SIDE}, seed ${SEED}, ${rounds} rounds, no player`,
	);
	const runs = PERIODS.map((p) => timed(p, rounds, floors));
	for (const run of runs) {
		const sorted = [...run.actors].sort((a, b) => a - b);
		console.log(
			`P=${run.period}`.padEnd(P_CELL),
			`${run.seconds.toFixed(1)} s total;`,
			`ms/round per ${WINDOW}-round window: ${[...run.perRound].map((ms) => ms.toFixed(1)).join(" ")};`,
			`actors per floor ${sorted[0]}/${stats(sorted).median}/${sorted.at(-1)} (min/median/max);`,
			`live ids ${run.live}`,
		);
	}
	const rerun = timed(RERUN_PERIOD, rounds, floors);
	if (rerun.hash !== runs.find((r) => r.period === RERUN_PERIOD)?.hash)
		throw new Error(`a rerun at P=${RERUN_PERIOD} gave another hash`);
	console.log(`rerun at P=${RERUN_PERIOD}: same hash ${rerun.hash}`);
	console.log(
		"per-floor time: needs a core timing seam that is not built; the population spread above stands in for it",
	);
	for (const run of runs)
		console.log(
			`id budget P=${run.period}: ${run.births.toFixed(1)} births per round on the busiest floor,`,
			run.births === 0
				? "no birth"
				: `${Math.floor(ID_FLOOR_STRIDE / run.births).toLocaleString("en")} rounds until 2^25 ids per floor`,
		);
	console.log(
		`time budget: MAX_TICK / TICKS_PER_TURN = ${Math.floor(MAX_TICK / TICKS_PER_TURN).toLocaleString("en")} rounds`,
	);
}

async function memoryMode(): Promise<void> {
	const floors = DEFAULT_FLOORS;
	const child = Bun.spawn(
		[
			process.execPath,
			`${import.meta.dir}/season/memory.ts`,
			...[SEED, floors, SIDE, MEMORY_ROUNDS].map(String),
		],
		{ stdout: "pipe" },
	);
	const out = await new Response(child.stdout).text();
	if ((await child.exited) !== 0) throw new Error("the memory run failed");
	const m = JSON.parse(out) as Record<string, number>;
	if (m.restored !== m.played)
		throw new Error("the loaded world is not at the saved round");
	const peak = child.resourceUsage()?.maxRSS ?? 0;
	console.log(
		`season memory: ${floors} floors ${SIDE}x${SIDE}, seed ${SEED}, ${MEMORY_ROUNDS} rounds, fresh process`,
	);
	const over = (bytes: number) =>
		bytes > RSS_BUDGET_MB * BYTES_PER_MB ? `over ${RSS_BUDGET_MB} MB` : "";
	for (const [label, bytes] of [
		["empty Bun process", m.empty ?? 0],
		["built", m.built ?? 0],
		["running", m.running ?? 0],
		[`after saveWorld (image ${mb(m.image ?? 0)})`, m.saved ?? 0],
		["after loadWorld into a second engine", m.loaded ?? 0],
	] as const)
		console.log(
			`${label.padEnd(LABEL)}${mb(bytes).padEnd(LABEL / 2)}${over(bytes)}`,
		);
	const pass = peak <= PEAK_BUDGET_MB * BYTES_PER_MB;
	console.log(
		`${"peak (maxRSS)".padEnd(LABEL)}${mb(peak).padEnd(LABEL / 2)}budget ${PEAK_BUDGET_MB} MB ${verdict(pass)}`,
	);
	if (!pass) process.exitCode = 1;
}

// One seed's end state: the KS metrics, the hash, and every species' population.
function measure(
	seed: number,
	period: number,
	rounds: number,
	modules: readonly AnyModule[],
	actors: readonly string[],
) {
	const e = buildSeason(seed, FIDELITY_FLOORS, FIDELITY_SIDE, modules);
	e.unwatchedPeriod = period;
	const deaths = play(e, rounds);
	const { population, boldness100 } = census(e);
	const counts = actors.map((name) => population.get(name) ?? 0);
	const extinct = counts.filter((c) => c === 0).length;
	return {
		metrics: [...counts, deaths, boldness100, extinct],
		hash: hashOf(e),
		population,
	};
}

function fidelityMode(seeds: number, rounds: number): void {
	if (seeds !== KS_SEEDS)
		throw new Error(`KS_REJECT holds for ${KS_SEEDS} seeds, not ${seeds}`);
	const table = catalogue(SEED).species;
	const actors = Object.keys(table)
		.filter((name) => table[name]?.actor)
		.sort();
	const metrics = [
		...actors.map((name) => `${name} population`),
		"deaths",
		"boldness x100",
		"extinct species",
	];
	const sample = (
		first: number,
		period: number,
		modules: readonly AnyModule[] = gameModules,
	) => {
		const runs = Array.from({ length: seeds }, (_, i) =>
			measure(first + i, period, rounds, modules, actors),
		);
		return {
			metric: (m: number) =>
				Int32Array.from(runs, (run) => run.metrics[m] ?? 0),
			hashes: runs.map((run) => run.hash),
			populations: runs.map((run) => run.population),
		};
	};
	console.log(
		`season fidelity: ${FIDELITY_FLOORS} floors ${FIDELITY_SIDE}x${FIDELITY_SIDE}, seeds 1..${seeds}, ${rounds} rounds, reject at D*n >= ${KS_REJECT}`,
	);
	const byPeriod = new Map(PERIODS.map((p) => [p, sample(1, p)]));
	const base = byPeriod.get(1) ?? sample(1, 1);
	for (const [period, set] of byPeriod) {
		if (period === 1) continue;
		metrics.forEach((name, m) => {
			const d = ksStatistic(base.metric(m), set.metric(m));
			console.log(
				`P=${period} ${name}`.padEnd(LABEL),
				`D*n ${d}`.padEnd(LABEL / 2),
				verdict(d < KS_REJECT),
			);
		});
	}
	const calibration: [string, boolean][] = [];
	const other = sample(seeds + 1, 1);
	const nulls = metrics.map((_, m) =>
		ksStatistic(base.metric(m), other.metric(m)),
	);
	calibration.push([
		`null: seeds 1..${seeds} against ${seeds + 1}..${2 * seeds}, D*n ${nulls.join(" ")}`,
		nulls.every((d) => d < KS_REJECT),
	]);
	const starving = gameModules.map((m) =>
		m === hunger
			? {
					...hunger,
					config: {
						...hunger.config,
						decayPerTurn: STARVING * hunger.config.decayPerTurn,
					},
				}
			: m,
	);
	const rat = metrics.indexOf("rat population");
	const power = ksStatistic(
		base.metric(rat),
		sample(1, 1, starving).metric(rat),
	);
	calibration.push([
		`power: hunger decay x${STARVING}, rat population D*n ${power}`,
		power >= KS_REJECT,
	]);
	const replayed = byPeriod.get(RERUN_PERIOD)?.hashes ?? [];
	calibration.push([
		`sanity: P=${RERUN_PERIOD} hash differs from P=1 in every seed`,
		base.hashes.every((h, i) => h !== replayed[i]),
	]);
	for (const [label, pass] of calibration)
		console.log(`calibration ${label}: ${verdict(pass)}`);
	if (calibration.some(([, pass]) => !pass)) process.exitCode = 1;
	const median = (name: string) =>
		stats(base.populations.map((p) => p.get(name) ?? 0)).median;
	console.log("food web at P=1, median end population over seeds:");
	for (const { eater, food } of foodWeb(table))
		console.log(`  ${eater} (${median(eater)}) eats ${food} (${median(food)})`);
}

const [mode = "time", first, second] = Bun.argv.slice(2);
if (mode === "time")
	timeMode(arg(first, DEFAULT_ROUNDS), arg(second, DEFAULT_FLOORS));
else if (mode === "memory") await memoryMode();
else if (mode === "fidelity")
	fidelityMode(arg(first, DEFAULT_SEEDS), arg(second, DEFAULT_FIDELITY_ROUNDS));
else throw new Error(`unknown mode ${mode}: time, memory or fidelity`);
