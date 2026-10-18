// Storage-only twin of the Rust presence bench (apps/server-rs/.../ecs-bench/benches/presence.rs):
// 30 components, two on every entity, the other 28 on about 7% each. Run: bun bench/presence.ts
import { CAP } from "../src/core/config";
import type { Slot } from "../src/core/ecs/ids";
import { MaskQuery } from "../src/core/ecs/query";
import { type MaskBit, Storage } from "../src/core/ecs/storage";

const N = 20_000;
const K = 1_000;
const COLUMNS = 30;
const ALWAYS = 2;
const SPARSE_READS = 4;
const PERCENT = 7n;
const HUNDRED = 100n;
// CAP slots per floor is below N, so the population spans two floors.
const FLOORS = 2;
const PER_FLOOR = N / FLOORS;
const WARMUP = 2_000;
const SAMPLES = 50;
const SAMPLE_NS = 20e6;
const NS_PER_US = 1_000;
const DECIMALS = 3;
const PAD = 22;

const M64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;
const MIX1 = 0xbf58476d1ce4e5b9n;
const MIX2 = 0x94d049bb133111ebn;
const S8 = 8n;
const S27 = 27n;
const S29 = 29n;
const S30 = 30n;
const S31 = 31n;

function has(i: number, c: number): boolean {
	if (c < ALWAYS) return true;
	let z = (((BigInt(i) << S8) | BigInt(c)) + GOLDEN) & M64;
	z = ((z ^ (z >> S30)) * MIX1) & M64;
	z = ((z ^ (z >> S27)) * MIX2) & M64;
	return (z ^ (z >> S31)) % HUNDRED < PERCENT;
}

const storage = new Storage(FLOORS, COLUMNS);
const cols: Int32Array[] = [];
const bits: MaskBit[] = [];
for (let c = 0; c < COLUMNS; c++) {
	cols.push(storage.column("i32") as Int32Array);
	bits.push(storage.componentBit(c));
}
const words = storage.maskWords;
const col = (c: number) => cols[c] as Int32Array;
const bit = (c: number) => bits[c] as MaskBit;

function set(s: number, c: number, v: number): void {
	col(c)[s] = v;
	const b = bit(c);
	storage.masks[s * words + b.word] =
		(storage.masks[s * words + b.word] ?? 0) | b.bit;
}

function present(s: number, c: number): boolean {
	const b = bit(c);
	return ((storage.masks[s * words + b.word] ?? 0) & b.bit) !== 0;
}

const slotOf = new Int32Array(N);
const idOf = new Int32Array(N);
const floorOf = new Int32Array(N);
for (let i = 0; i < N; i++) {
	const f = (i / PER_FLOOR) | 0;
	const s = storage.alloc(f);
	for (let c = 0; c < COLUMNS; c++) if (has(i, c)) set(s, c, i);
	slotOf[i] = s;
	idOf[i] = storage.ids[s] ?? 0;
	floorOf[i] = f;
}

// Uniform over [0, N) like the Rust picks, from a different stream.
const picks = new Int32Array(K);
for (let k = 0; k < K; k++) {
	let z = (BigInt(k) * GOLDEN + 1n) & M64;
	z = ((z ^ (z >> S31)) * MIX1) & M64;
	picks[k] = Number((z ^ (z >> S29)) % BigInt(N));
}

const values = new Int32Array(COLUMNS);
const held = new Uint8Array(COLUMNS);

function churn(): number {
	for (let k = 0; k < K; k++) {
		const i = picks[k] ?? 0;
		const f = floorOf[i] ?? 0;
		const s = storage.slotOf(f, (idOf[i] ?? 0) as never);
		for (let c = 0; c < COLUMNS; c++) {
			held[c] = present(s, c) ? 1 : 0;
			values[c] = col(c)[s] ?? 0;
		}
		storage.release(f, s);
		const t = storage.alloc(f);
		for (let c = 0; c < COLUMNS; c++) if (held[c]) set(t, c, values[c] ?? 0);
		slotOf[i] = t;
		idOf[i] = storage.ids[t] ?? 0;
	}
	return 0;
}

function turn(s: number): number {
	let sum = col(0)[s] ?? 0;
	for (let c = ALWAYS; c < ALWAYS + SPARSE_READS; c++)
		sum += present(s, c) ? (col(c)[s] ?? 0) : 0;
	const need = col(1)[s] ?? 0;
	col(1)[s] = need > 0 ? need - 1 : 0;
	return sum;
}

function actorTurnBySlot(): number {
	let sum = 0;
	for (let k = 0; k < K; k++) sum += turn(slotOf[picks[k] ?? 0] ?? 0);
	return sum;
}

function actorTurnById(): number {
	let sum = 0;
	for (let k = 0; k < K; k++) {
		const i = picks[k] ?? 0;
		sum += turn(storage.slotOf(floorOf[i] ?? 0, (idOf[i] ?? 0) as never));
	}
	return sum;
}

function bulk(query: MaskQuery, values: Int32Array): number {
	for (let floor = 0; floor < FLOORS; floor++) {
		const list = query.slots({ floor });
		for (let j = 0; j < list.length; j++) {
			const s = list.at(j);
			const v = values[s] ?? 0;
			values[s] = v > 0 ? v - 1 : 0;
		}
	}
	return 0;
}

function bulkScan(c: number): number {
	const b = bit(c);
	const values = col(c);
	for (let f = 0; f < FLOORS; f++) {
		const end = f * CAP + (storage.highWater[f] ?? 0);
		for (let s = f * CAP; s < end; s++)
			if (((storage.masks[s * words + b.word] ?? 0) & b.bit) !== 0) {
				const v = values[s] ?? 0;
				values[s] = v > 0 ? v - 1 : 0;
			}
	}
	return 0;
}

const everyone = new MaskQuery(storage, [bit(1)]);
const sparse = new MaskQuery(storage, [bit(ALWAYS)]);
const both = new MaskQuery(storage, [bit(ALWAYS), bit(ALWAYS + 1)]);

function join(): number {
	let sum = 0;
	const a = col(ALWAYS);
	const b = col(ALWAYS + 1);
	for (let floor = 0; floor < FLOORS; floor++) {
		const list = both.slots({ floor });
		for (let j = 0; j < list.length; j++) {
			const s: Slot = list.at(j);
			b[s] = ((b[s] ?? 0) + (a[s] ?? 0)) | 0;
			sum += b[s] ?? 0;
		}
	}
	return sum;
}

let sink = 0;
function bench(name: string, elements: number, run: () => number): void {
	for (let i = 0; i < WARMUP; i++) sink += run();
	const samples: number[] = [];
	for (let r = 0; r < SAMPLES; r++) {
		let iterations = 0;
		const start = Bun.nanoseconds();
		while (Bun.nanoseconds() - start < SAMPLE_NS) {
			sink += run();
			iterations++;
		}
		samples.push((Bun.nanoseconds() - start) / iterations);
	}
	samples.sort((a, b) => a - b);
	const median = samples[SAMPLES >> 1] ?? 0;
	console.log(
		`${name.padEnd(PAD)} ${(median / NS_PER_US).toFixed(DECIMALS)} µs  ${(median / elements).toFixed(DECIMALS)} ns/elem`,
	);
}

bench("churn", K, churn);
bench("actor_turn by slot", K, actorTurnBySlot);
bench("actor_turn by id", K, actorTurnById);
bench("bulk_full query", N, () => bulk(everyone, col(1)));
bench("bulk_full scan", N, () => bulkScan(1));
bench("bulk_sparse query", N, () => bulk(sparse, col(ALWAYS)));
bench("bulk_sparse scan", N, () => bulkScan(ALWAYS));
bench("query_sparse", N, join);
console.log(`sink ${sink & 1}, bun ${Bun.version}`);
