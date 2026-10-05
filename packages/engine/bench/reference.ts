import { LOD_PERIODS } from "../src/core/config";
import { MaskQuery } from "../src/core/ecs/query";
import type { Engine } from "../src/core/engine";
import { engineDigest, hashHex } from "../src/core/persistence/hash";
import { floorChecksum, saveFloor } from "../src/core/persistence/image";
import { type LoadCheck, loadFloor } from "../src/core/persistence/validate";
import { stats } from "./floor";
import {
	countTurns,
	drainEvents,
	newRound,
	playRound,
	type Round,
	withClock,
} from "./reference/run";
import {
	buildReference,
	bytesPerSlot,
	FLOORS,
	PLAYER_FLOORS,
	POP_CAP,
	RATS,
	referenceModules,
	SIDE,
	STOATS,
} from "./reference/world";

const WARMUP = 30;
const ROUNDS = 100;
const SNAPSHOT_WARMUP = 50;
const SNAPSHOTS = 400;
const RSS_ROUNDS = 60;
const SCANS = 100;
// Every creature carries it: the densest scan a bulk tick runs on this world.
const SCANNED = "age";
const CHECK_ROUNDS = 15;
const NS_PER_US = 1e3;
const NS_PER_MS = 1e6;
const BYTES_PER_MB = 1e6;
const BYTES_PER_KB = 1e3;
const LABEL = 52;
const CELL = 12;
const BUDGET_CELL = 16;
const MS_DECIMALS = 3;
const FAR_PERIOD = LOD_PERIODS.at(-1) ?? 1;

// Budgets of docs/plans/ecs-core.md section 1. A single bound applies to the median.
const BUDGET = {
	roundMedianMs: 80,
	roundP95Ms: 100,
	playerFloorMs: 20,
	cachedNs: 120,
	tickUs: 20,
	rssMb: 160,
	snapshotMs: 0.1,
	restoreMs: 0.2,
	hashMs: 0.5,
} as const;

interface Row {
	label: string;
	budget: string;
	median: string;
	p95: string;
	pass: boolean | undefined;
}
const rows: Row[] = [];
const add = (
	label: string,
	budget: string,
	median: string,
	p95: string,
	pass: boolean | undefined,
) => rows.push({ label, budget, median, p95, pass });

const time = (run: () => void) => {
	const start = Bun.nanoseconds();
	run();
	return Bun.nanoseconds() - start;
};

function machine(): string {
	const cpu = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"]);
	const name = cpu.success ? cpu.stdout.toString().trim() : process.arch;
	return `${name}, ${process.platform}, Bun ${Bun.version}`;
}

function rounds(): void {
	const { clock, modules } = withClock(referenceModules);
	const e = buildReference(modules);
	const counted = countTurns(e);
	for (let r = 0; r < WARMUP; r++) {
		playRound(e);
		drainEvents(e);
	}
	const samples: Round[] = [];
	for (let r = 0; r < ROUNDS; r++) {
		const round = newRound(FLOORS, modules.length);
		playRound(e, round, clock, counted);
		drainEvents(e);
		samples.push(round);
	}
	const round = stats(samples.map((s) => s.total));
	add(
		"world round, 50 floors",
		`${BUDGET.roundMedianMs} / ${BUDGET.roundP95Ms} ms`,
		`${(round.median / NS_PER_MS).toFixed(1)} ms`,
		`${(round.p95 / NS_PER_MS).toFixed(1)} ms`,
		round.median <= BUDGET.roundMedianMs * NS_PER_MS &&
			round.p95 <= BUDGET.roundP95Ms * NS_PER_MS,
	);
	const player = stats(
		samples.flatMap((s) =>
			PLAYER_FLOORS.map((f) => (s.ticks[f] ?? 0) + (s.actors[f] ?? 0)),
		),
	);
	add(
		"player floor alone, full arbitration",
		`${BUDGET.playerFloorMs} ms`,
		`${(player.median / NS_PER_MS).toFixed(2)} ms`,
		`${(player.p95 / NS_PER_MS).toFixed(2)} ms`,
		player.median <= BUDGET.playerFloorMs * NS_PER_MS,
	);
	// Each floor's period, from its distance to the nearest player as startRound sets it.
	const tiers = new Map<number, number[]>();
	for (let f = 0; f < FLOORS; f++) {
		const near = Math.min(...PLAYER_FLOORS.map((p) => Math.abs(f - p)));
		const period = LOD_PERIODS[Math.min(near, LOD_PERIODS.length - 1)] ?? 1;
		tiers.set(period, [...(tiers.get(period) ?? []), f]);
	}
	for (const [period, floors] of [...tiers].sort((a, b) => a[0] - b[0])) {
		const turn = stats(
			samples.flatMap((s) =>
				floors.map((f) => (s.actors[f] ?? 0) / Math.max(1, s.turns[f] ?? 0)),
			),
		);
		const far = period === FAR_PERIOD;
		add(
			`actor turn at P=${period} (${floors.length} floors)${far ? ", mostly cached" : ""}`,
			far ? `${BUDGET.cachedNs} ns` : "",
			`${turn.median.toFixed(0)} ns`,
			`${turn.p95.toFixed(0)} ns`,
			far ? turn.median <= BUDGET.cachedNs : undefined,
		);
	}
	const all = stats(
		samples.flatMap((s) => [...s.ticks].map((t) => t / NS_PER_US)),
	);
	rangeScan(e);
	add(
		"all ticks, per floor",
		"",
		`${all.median.toFixed(1)} µs`,
		`${all.p95.toFixed(1)} µs`,
		undefined,
	);
	clock.names.forEach((name, m) => {
		if (!clock.ticks[m]) return;
		const tick = stats(
			samples.flatMap((s) =>
				[...Array(FLOORS).keys()].map(
					(f) => (s.moduleTicks[f * modules.length + m] ?? 0) / NS_PER_US,
				),
			),
		);
		add(
			`  ${name} tick, per floor`,
			"",
			`${tick.median.toFixed(1)} µs`,
			`${tick.p95.toFixed(1)} µs`,
			undefined,
		);
	});
	persistence(e);
	const live = [...Array(FLOORS).keys()].map(
		(f) => (e.storage.highWater[f] ?? 0) - (e.storage.freeCount[f] ?? 0),
	);
	console.log(
		`after ${WARMUP + ROUNDS} rounds: live rows per floor ${Math.min(...live)}-${Math.max(...live)}, round ${e.round}`,
	);
}

// The plan's bulk tick budget: one query scanning a floor's rows, as every bulk tick starts with.
function rangeScan(e: Engine): void {
	const bit = e.components.get(SCANNED)?.bit;
	if (!bit) throw new Error(`no component ${SCANNED}`);
	const query = new MaskQuery(e.storage, [bit]);
	const samples: number[] = [];
	let found = 0;
	for (let i = -SNAPSHOT_WARMUP; i < SCANS; i++)
		for (let floor = 0; floor < FLOORS; floor++) {
			const start = Bun.nanoseconds();
			found = query.slots({ floor }).length;
			if (i >= 0) samples.push((Bun.nanoseconds() - start) / NS_PER_US);
		}
	const { median, p95 } = stats(samples);
	add(
		`bulk tick range scan (${found} ${SCANNED} rows)`,
		`${BUDGET.tickUs} µs`,
		`${median.toFixed(1)} µs`,
		`${p95.toFixed(1)} µs`,
		median <= BUDGET.tickUs,
	);
}

function persistence(e: Engine): void {
	const floor = PLAYER_FLOORS[0] ?? 0;
	engineDigest(e);
	const before = hashHex(e.digest);
	let image = saveFloor(e, floor);
	// A server keeps one buffer per floor: the budget row reuses it, the fresh row does not.
	const buffer = new Uint8Array(2 * image.length);
	const saves: number[] = [];
	const fresh: number[] = [];
	const restores: Record<LoadCheck, number[]> = { fast: [], full: [] };
	const hashes: number[] = [];
	for (let i = -SNAPSHOT_WARMUP; i < SNAPSHOTS; i++) {
		const anew = time(() => saveFloor(e, floor));
		const save = time(() => {
			image = saveFloor(e, floor, buffer);
		});
		const fast = time(() => loadFloor(e, image, floor, "fast"));
		const full = time(() => loadFloor(e, image, floor, "full"));
		const hash = time(() => floorChecksum(e, floor));
		if (i < 0) continue;
		saves.push(save);
		fresh.push(anew);
		restores.fast.push(fast);
		restores.full.push(full);
		hashes.push(hash);
	}
	engineDigest(e);
	if (hashHex(e.digest) !== before)
		throw new Error("restoring a floor's own image changed the world");
	const bound = (
		label: string,
		samples: number[],
		budget: number | undefined,
	) => {
		const { median, p95 } = stats(samples);
		add(
			label,
			budget === undefined ? "" : `${budget} ms`,
			`${(median / NS_PER_MS).toFixed(MS_DECIMALS)} ms`,
			`${(p95 / NS_PER_MS).toFixed(MS_DECIMALS)} ms`,
			budget === undefined ? undefined : median <= budget * NS_PER_MS,
		);
	};
	const kb = (image.length / BYTES_PER_KB).toFixed(0);
	bound(
		`floor snapshot (${kb} kB image, reused buffer)`,
		saves,
		BUDGET.snapshotMs,
	);
	bound("  into a fresh buffer", fresh, undefined);
	bound("floor restore, fast check", restores.fast, BUDGET.restoreMs);
	bound("floor restore, full check", restores.full, undefined);
	bound("floor hash", hashes, BUDGET.hashMs);
}

async function rss(): Promise<void> {
	const child = Bun.spawn(
		[process.execPath, `${import.meta.dir}/reference/rss.ts`, `${RSS_ROUNDS}`],
		{ stdout: "pipe" },
	);
	const out = await new Response(child.stdout).text();
	if ((await child.exited) !== 0) throw new Error("the RSS run failed");
	const { empty, built, running, rings } = JSON.parse(out) as {
		empty: number;
		built: number;
		running: number;
		rings: number;
	};
	const peak = child.resourceUsage()?.maxRSS ?? 0;
	add(
		"world RSS, running (fresh process)",
		`${BUDGET.rssMb} MB`,
		`${(running / BYTES_PER_MB).toFixed(0)} MB`,
		"",
		running <= BUDGET.rssMb * BYTES_PER_MB,
	);
	for (const [label, bytes] of [
		["  built, before the first round", built],
		["  event rings, drained each round", rings],
		["  peak while building (maxRSS)", peak],
		["  empty Bun process", empty],
	] as const)
		add(label, "", `${(bytes / BYTES_PER_MB).toFixed(1)} MB`, "", undefined);
}

function worldHash(order?: readonly number[]): string {
	const e = buildReference(referenceModules, order);
	for (let r = 0; r < CHECK_ROUNDS; r++) playRound(e);
	engineDigest(e);
	return hashHex(e.digest);
}

function determinism(): void {
	const first = worldHash();
	const again = worldHash();
	const order = [...Array(FLOORS).keys()].sort(
		(a, b) => (b & 1) - (a & 1) || b - a,
	);
	const permuted = worldHash(order);
	console.log(
		`determinism after ${CHECK_ROUNDS} rounds: ${first}; same seed again ${again === first ? "same" : `DIFFERS ${again}`}; floor order permuted ${permuted === first ? "same" : `DIFFERS ${permuted}`}`,
	);
	if (again !== first || permuted !== first)
		throw new Error("the reference world is not deterministic");
}

const sample = buildReference();
const bytes = bytesPerSlot(sample);
console.log(`reference world on ${machine()}`);
console.log(
	`  ${FLOORS} floors ${SIDE}x${SIDE}, ${RATS} rats + ${STOATS} stoats + 2000 items each, players on floors ${PLAYER_FLOORS.join(", ")}, popCap ${POP_CAP}`,
);
console.log(
	`  ${referenceModules.length} modules: ${referenceModules.map((m) => m.name).join(", ")}`,
);
console.log(
	`  per slot: ${bytes.columns} B of columns, ${bytes.saved} B saved with masks and free list, ${bytes.resident} B with scheduler flag and id index, plus ${bytes.perActor} B per actor in the scheduler's lists`,
);
console.log(
	`  ${WARMUP} warmup rounds, ${ROUNDS} sampled; snapshots ${SNAPSHOTS} after ${SNAPSHOT_WARMUP}; a single budget bounds the median`,
);
rounds();
await rss();
determinism();
const verdict = (pass: boolean | undefined) =>
	pass === undefined ? "" : pass ? "PASS" : "FAIL";
console.log(
	`${"metric".padEnd(LABEL)}${"budget".padEnd(BUDGET_CELL)}${"median".padEnd(CELL)}${"p95".padEnd(CELL)}`,
);
for (const row of rows)
	console.log(
		`${row.label.padEnd(LABEL)}${row.budget.padEnd(BUDGET_CELL)}${row.median.padEnd(CELL)}${row.p95.padEnd(CELL)}${verdict(row.pass)}`,
	);
