import { CAP, SPARSE_CAP } from "../src/core/config";
import type { Slot } from "../src/core/ecs/ids";
import { SparsePool } from "../src/core/ecs/sparse";
import { readView } from "../src/core/ecs/view";
import { bounded, draw, PHASE, SUBJECT } from "../src/core/random/rng";
import { stats } from "./floor";

// One floor of the reference world: a u8 field read in random slot order, through each access
// path a gene could take. Each path must read the same values as the dense column.
const SEED = 1;
const ROWS = 10_000;
const READS = 1_000_000;
const RUNS = 9;
const WARMUP = 2;
const BYTE = 0xff;
const SPREAD = 7;
const SHUFFLE = 0;
const PICK = 1;
const PERCENT = 100;
const DENSE_OCCUPANCY = 80;
const LABEL = 40;
const CELL = 14;
const NS_DECIMALS = 2;
const RATIO_DECIMALS = 2;
// rowOf is u16 per slot; the pool's back pointer is i32 per row.
const ROW_OF_BYTES = 2;
const SLOT_OF_ROW_BYTES = 4;

const random = (phase: number, index: number, bound: number) =>
	bounded(draw(SEED, 0, PHASE.spawn, phase, SUBJECT.entity, 0, index), bound);

const order = Array.from({ length: ROWS }, (_, s) => s);
for (let i = ROWS - 1; i > 0; i--) {
	const j = random(SHUFFLE, i, i + 1);
	[order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
}

const dense = new Uint8Array(CAP);
for (let s = 0; s < ROWS; s++) dense[s] = (s * SPREAD) & BYTE;
const view = (readView({ v: dense }) as { v: { get(slot: Slot): number } }).v;

interface Path {
	label: string;
	read: (slots: Int32Array) => number;
}

const timed = (path: Path, slots: Int32Array) => {
	const samples: number[] = [];
	let sum = 0;
	for (let run = -WARMUP; run < RUNS; run++) {
		const start = Bun.nanoseconds();
		sum = path.read(slots);
		if (run >= 0) samples.push((Bun.nanoseconds() - start) / READS);
	}
	return { ns: stats(samples).median, sum };
};

function occupancy(holders: number, rowsPerFloor: number): void {
	const pool = new SparsePool(1, rowsPerFloor);
	const column = pool.column("u8");
	for (let i = 0; i < holders; i++) {
		const slot = (order[i] ?? 0) as Slot;
		column[pool.take(0, slot)] = dense[slot] ?? 0;
	}
	const slots = new Int32Array(READS);
	for (let i = 0; i < READS; i++)
		slots[i] = order[random(PICK, i, holders)] ?? 0;
	const paths: Path[] = [
		{
			label: "dense typed array",
			read: (s) => {
				let sum = 0;
				for (let i = 0; i < s.length; i++) sum += dense[s[i] ?? 0] ?? 0;
				return sum;
			},
		},
		{
			label: "dense FieldView.get",
			read: (s) => {
				let sum = 0;
				for (let i = 0; i < s.length; i++) sum += view.get((s[i] ?? 0) as Slot);
				return sum;
			},
		},
		{
			label: "sparse row() + column",
			read: (s) => {
				let sum = 0;
				for (let i = 0; i < s.length; i++)
					sum += column[pool.row((s[i] ?? 0) as Slot)] ?? 0;
				return sum;
			},
		},
	];
	const ofRows = Math.round((holders * PERCENT) / ROWS);
	const ofCap = Math.round((holders * PERCENT) / CAP);
	console.log(
		`${holders} of ${ROWS} rows hold the field (${ofRows}% of rows, ${ofCap}% of CAP), pool of ${rowsPerFloor} rows`,
	);
	const base = timed(paths[0] as Path, slots);
	for (const path of paths) {
		const { ns, sum } = path === paths[0] ? base : timed(path, slots);
		const ratio = ns / base.ns;
		console.log(
			`  ${path.label.padEnd(LABEL)}${`${ns.toFixed(NS_DECIMALS)} ns/read`.padEnd(CELL)}  x${ratio.toFixed(RATIO_DECIMALS)}`,
		);
		if (sum !== base.sum) {
			console.log(`  FAIL: checksum ${sum}, dense read ${base.sum}`);
			process.exitCode = 1;
		}
	}
	console.log(
		`  bytes per floor: dense u8 ${CAP}, pool u8 ${rowsPerFloor}, shared by every sparse component: rowOf ${CAP * ROW_OF_BYTES} + back pointers ${rowsPerFloor * SLOT_OF_ROW_BYTES}`,
	);
}

console.log(`sparse read cost, ${READS} reads per path, median of ${RUNS}`);
occupancy(SPARSE_CAP, SPARSE_CAP);
occupancy((ROWS * DENSE_OCCUPANCY) / PERCENT, CAP);
