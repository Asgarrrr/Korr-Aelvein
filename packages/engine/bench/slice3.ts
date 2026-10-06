import { rat } from "../src/content/species/rat";
import { stoat } from "../src/content/species/stoat";
import { bounded, draw, PHASE, SUBJECT } from "../src/core/random/rng";
import { benchFloor, RATS, stats } from "./floor";

const SLOTS = 1 << 14;
const READS = 1 << 16;
const WARMUP = 20;
const SAMPLES = 100;
const VALUE_BOUND = 100;
const NS_DECIMALS = 2;
const LABEL_WIDTH = 24;

type Column = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array;

interface View {
	get(slot: number): number;
}

class GenericView implements View {
	readonly #array: Column;
	constructor(array: Column) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}

class Int8View implements View {
	readonly #array: Int8Array;
	constructor(array: Int8Array) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}
class Uint8View implements View {
	readonly #array: Uint8Array;
	constructor(array: Uint8Array) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}
class Int16View implements View {
	readonly #array: Int16Array;
	constructor(array: Int16Array) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}
class Uint16View implements View {
	readonly #array: Uint16Array;
	constructor(array: Uint16Array) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}
class Int32View implements View {
	readonly #array: Int32Array;
	constructor(array: Int32Array) {
		this.#array = array;
	}
	get(slot: number): number {
		return this.#array[slot] ?? 0;
	}
}

let n = 0;
const next = (bound: number) =>
	bounded(draw(1, 0, PHASE.core, 0, SUBJECT.entity, 0, n++), bound);
const fill = <A extends Column>(array: A): A => {
	for (let i = 0; i < array.length; i++) array[i] = next(VALUE_BOUND);
	return array;
};
const i8 = fill(new Int8Array(SLOTS));
const u8 = fill(new Uint8Array(SLOTS));
const i16 = fill(new Int16Array(SLOTS));
const u16 = fill(new Uint16Array(SLOTS));
const i32 = fill(new Int32Array(SLOTS));
const arrays: Column[] = [i8, u8, i16, u16, i32];
const generic: View[] = arrays.map((array) => new GenericView(array));
const perKind: View[] = [
	new Int8View(i8),
	new Uint8View(u8),
	new Int16View(i16),
	new Uint16View(u16),
	new Int32View(i32),
];
// Random slots, like a perception buffer: reads never stream through a column.
const slots = Int32Array.from({ length: READS }, () => next(SLOTS));

// One call site per variant, each fed every kind: the same polymorphism a module sees.
const readRaw = (columns: Column[]) => {
	let total = 0;
	for (let i = 0; i < READS; i++) {
		const s = slots[i] ?? 0;
		for (let k = 0; k < columns.length; k++) total += columns[k]?.[s] ?? 0;
	}
	return total;
};
// Two identical bodies, so neither variant inherits the other's type feedback.
const readGeneric = (views: View[]) => {
	let total = 0;
	for (let i = 0; i < READS; i++) {
		const s = slots[i] ?? 0;
		for (let k = 0; k < views.length; k++) total += views[k]?.get(s) ?? 0;
	}
	return total;
};
const readPerKind = (views: View[]) => {
	let total = 0;
	for (let i = 0; i < READS; i++) {
		const s = slots[i] ?? 0;
		for (let k = 0; k < views.length; k++) total += views[k]?.get(s) ?? 0;
	}
	return total;
};

const variants: [string, () => number][] = [
	["raw arrays", () => readRaw(arrays)],
	["generic GetterView", () => readGeneric(generic)],
	["one class per kind", () => readPerKind(perKind)],
];
const expected = readRaw(arrays);
console.log(
	`slice3 views: ${READS} random slots x ${arrays.length} fields (i8 u8 i16 u16 i32), one call site`,
);
for (const [label, run] of variants) {
	const samples: number[] = [];
	for (let i = -WARMUP; i < SAMPLES; i++) {
		const start = Bun.nanoseconds();
		const total = run();
		const elapsed = Bun.nanoseconds() - start;
		if (total !== expected) throw new Error(`${label} read ${total}`);
		if (i >= 0) samples.push(elapsed / (READS * arrays.length));
	}
	const { median, p95 } = stats(samples);
	console.log(
		`  ${label.padEnd(LABEL_WIDTH)} median ${median.toFixed(NS_DECIMALS)} ns   p95 ${p95.toFixed(NS_DECIMALS)} ns per read`,
	);
}

// Stoats spread over the floor: wary rats near one pay the full perception scan.
const STOATS = 200;
const ROUNDS = 100;
function withStoats(): void {
	const { world, rats, coord } = benchFloor(rat.components.satiety.value);
	let placed = 0;
	while (placed < STOATS) {
		try {
			world.spawn(0, stoat, coord(), coord());
			placed++;
		} catch {
			// The cell already holds an actor: draw another.
		}
	}
	world.runRounds(WARMUP);
	const samples: number[] = [];
	for (let r = 0; r < ROUNDS; r++) {
		const actors = rats.filter((id) => world.alive(id)).length + STOATS;
		const start = Bun.nanoseconds();
		world.runRounds(1);
		samples.push((Bun.nanoseconds() - start) / actors);
	}
	const { median, p95 } = stats(samples);
	const alive = rats.filter((id) => world.alive(id)).length;
	console.log(
		`with ${STOATS} stoats (sated rats, ${alive} of ${RATS} alive at the end)`,
	);
	console.log(
		`  per actor turn  median ${median.toFixed(0)} ns   p95 ${p95.toFixed(0)} ns`,
	);
	console.log(`  checksum ${world.hash()}`);
}
withStoats();
