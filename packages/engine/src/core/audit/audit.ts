import type { AnyModule } from "../api";
import { CAP } from "../config";
import type { Column } from "../ecs/schema";
import { ALIVE } from "../ecs/storage";
import { CORE, CORE_KEY, type Engine } from "../engine";
import { coreSchema } from "../health/vitality";
import {
	CELLS,
	FREE,
	floorChecksum,
	MASKS,
	ROWS,
	type Section,
	sectionCount,
	sectionStart,
	WORD,
} from "../persistence/image";
import { hashName } from "../random/rng";

const BYTE_SHIFT = 3;
const LOW_BIT = 31;
// Module keys are unsigned hashes, so no column has this owner.
const NOBODY = -1;
const SCALARS = ["highWater", "freeCount", "counters"] as const;

interface Target {
	readonly section: Section;
	readonly owner: number;
	readonly name: string;
}

interface Owned {
	readonly name: string;
	readonly word: number;
	readonly bit: number;
	readonly fields: readonly (readonly [string, Column])[];
}

export class Audit {
	readonly #engine: Engine;
	readonly #targets: readonly Target[];
	readonly #modules = new Map<number, string>([[CORE_KEY, CORE]]);
	readonly #owned = new Map<number, Owned[]>();
	readonly #saved: Int32Array;
	readonly #from: Int32Array;
	readonly #count: Int32Array;
	readonly #scalars = new Int32Array(SCALARS.length);
	readonly #floorSums: Int32Array;
	#floor = 0;
	#module = 0;
	#owner = NOBODY;

	constructor(engine: Engine, modules: readonly AnyModule[]) {
		this.#engine = engine;
		const { storage, grid, scheduler } = engine;
		const labels = new Map<Column, { owner: number; name: string }>();
		const core = (array: Column, name: string) =>
			labels.set(array, { owner: CORE_KEY, name });
		core(storage.ids, "ids");
		core(storage.masks, "masks");
		core(storage.free, "free");
		core(grid.heads, "cells");
		core(grid.x, "x");
		core(grid.y, "y");
		core(grid.cellOf, "cellOf");
		core(grid.next, "next");
		core(grid.prev, "prev");
		core(scheduler.nextAt, "nextAt");
		core(engine.intentKey, "intent.key");
		core(engine.intentTarget, "intent.target");
		for (const name of Object.keys(coreSchema))
			for (const [field, column] of Object.entries(
				engine.components.get(name)?.columns ?? {},
			))
				core(column, `${name}.${field}`);
		for (const module of modules) {
			const key = hashName(module.name);
			this.#modules.set(key, module.name);
			const owned: Owned[] = [];
			for (const component of Object.keys(module.schema)) {
				const entry = engine.components.get(component);
				const columns = entry?.columns ?? {};
				for (const [field, column] of Object.entries(columns))
					labels.set(column, { owner: key, name: `${component}.${field}` });
				if (entry)
					owned.push({
						name: component,
						...entry.bit,
						fields: Object.entries(columns),
					});
			}
			this.#owned.set(key, owned);
			for (const name of Object.keys(module.cells ?? {})) {
				const columns = engine.cellColumns.get(name) ?? {};
				for (const [field, column] of Object.entries(columns))
					labels.set(column, { owner: key, name: `${name}.${field}` });
			}
		}
		this.#targets = engine.sections.map((section) => {
			const label = labels.get(section.array);
			if (!label) throw new Error("audit: a saved column has no owner");
			return { section, ...label };
		});
		let words = 0;
		for (const { section } of this.#targets)
			words += this.#span(section, CAP, CAP);
		this.#saved = new Int32Array(words);
		this.#from = new Int32Array(this.#targets.length);
		this.#count = new Int32Array(this.#targets.length);
		this.#floorSums = new Int32Array(2 * storage.floors);
	}

	// A floor's round touches only that floor and other floors' inboxes: every other floor must
	// hash the same after it, its inbox aside.
	startFloor(floor: number): void {
		const engine = this.#engine;
		for (let f = 0; f < engine.storage.floors; f++) {
			if (f === floor) continue;
			floorChecksum(engine, f, false);
			this.#floorSums[2 * f] = engine.floorSums[2 * f] ?? 0;
			this.#floorSums[2 * f + 1] = engine.floorSums[2 * f + 1] ?? 0;
		}
	}

	endFloor(floor: number): void {
		const engine = this.#engine;
		for (let f = 0; f < engine.storage.floors; f++) {
			if (f === floor) continue;
			floorChecksum(engine, f, false);
			if (
				engine.floorSums[2 * f] !== this.#floorSums[2 * f] ||
				engine.floorSums[2 * f + 1] !== this.#floorSums[2 * f + 1]
			)
				throw new Error(`audit: floor ${f} changed while floor ${floor} ran`);
		}
		this.#checkUnused(floor);
	}

	// Each floor's unused rows were checked before the later floors ran; writes to other
	// floors' rows are caught by the writing floor's own endFloor.
	endRound(): void {
		for (let f = 0; f < this.#engine.storage.floors; f++) this.#checkUnused(f);
	}

	// Propose owns nothing: it may read every column and write none.
	before(floor: number, module: number, owns: boolean): void {
		this.#floor = floor;
		this.#module = module;
		const owner = owns ? module : NOBODY;
		this.#owner = owner;
		const storage = this.#engine.storage;
		for (let i = 0; i < SCALARS.length; i++)
			this.#scalars[i] =
				storage[SCALARS[i] as (typeof SCALARS)[number]][floor] ?? 0;
		const used = storage.highWater[floor] ?? 0;
		const freed = storage.freeCount[floor] ?? 0;
		let at = 0;
		for (let t = 0; t < this.#targets.length; t++) {
			const { section, owner: holder } = this.#targets[t] as Target;
			if (holder === owner) {
				this.#count[t] = 0;
				continue;
			}
			const start = this.#start(section);
			const n = this.#span(section, used, freed);
			this.#saved.set(section.words.subarray(start, start + n), at);
			this.#from[t] = at;
			this.#count[t] = n;
			at += n;
		}
	}

	after(): void {
		const storage = this.#engine.storage;
		for (let i = 0; i < SCALARS.length; i++) {
			const scalar = SCALARS[i] as (typeof SCALARS)[number];
			if (storage[scalar][this.#floor] !== this.#scalars[i])
				throw new Error(
					`audit: ${this.#name()} changed ${scalar} of floor ${this.#floor}`,
				);
		}
		const saved = this.#saved;
		for (let t = 0; t < this.#targets.length; t++) {
			const n = this.#count[t] ?? 0;
			if (n === 0) continue;
			const target = this.#targets[t] as Target;
			const words = target.section.words;
			const start = this.#start(target.section);
			const at = this.#from[t] ?? 0;
			for (let w = 0; w < n; w++) {
				const before = saved[at + w] ?? 0;
				const now = words[start + w] ?? 0;
				if (before !== now) this.#fail(target, w, before ^ now);
			}
		}
		this.#checkFree();
		this.#checkAbsent();
	}

	// The load rule, applied at write time: a live row holds only zeros in a component it lacks.
	#checkAbsent(): void {
		const owned = this.#owned.get(this.#owner);
		if (!owned) return;
		const { masks, maskWords, highWater } = this.#engine.storage;
		const base = this.#floor * CAP;
		const end = base + (highWater[this.#floor] ?? 0);
		for (const { name, word, bit, fields } of owned)
			for (let s = base; s < end; s++) {
				if (((masks[s * maskWords] ?? 0) & ALIVE) === 0) continue;
				if (((masks[s * maskWords + word] ?? 0) & bit) !== 0) continue;
				for (const [field, column] of fields)
					if (column[s] !== 0)
						throw new Error(
							`audit: ${this.#name()} wrote ${name}.${field} at slot ${s}, a row without ${name}`,
						);
			}
	}

	// The rows the next spawns will take must be zero, or a newborn inherits a stray value
	// that the round-end check then sees on a live row. Freed rows sit below the high water,
	// so the snapshot diff already covers every column but the running owner's.
	#checkFree(): void {
		const engine = this.#engine;
		const storage = engine.storage;
		const base = this.#floor * CAP;
		const freed =
			this.#owner === NOBODY ? 0 : (storage.freeCount[this.#floor] ?? 0);
		const used = storage.highWater[this.#floor] ?? 0;
		const fresh = Math.min(CAP - used, engine.spawns.count);
		for (let i = 0; i < freed + fresh; i++) {
			const slot =
				i < freed ? (storage.free[base + i] ?? 0) : base + used + i - freed;
			for (const { section, name, owner } of this.#targets) {
				if (section.kind !== ROWS && section.kind !== MASKS) continue;
				if (i < freed && owner !== this.#owner) continue;
				const stride = section.kind === MASKS ? storage.maskWords : 1;
				for (let k = 0; k < stride; k++)
					if (section.array[slot * stride + k] !== 0)
						throw new Error(
							`audit: ${this.#name()} wrote ${name} at free slot ${slot}`,
						);
			}
		}
	}

	// Rows past the high water hold no entity, so recycling and every column keep them zero.
	#checkUnused(floor: number): void {
		const storage = this.#engine.storage;
		const used = storage.highWater[floor] ?? 0;
		for (const { section, name } of this.#targets) {
			if (section.kind === FREE || section.kind === CELLS) continue;
			const stride = section.kind === MASKS ? storage.maskWords : 1;
			const array = section.array;
			const end = (floor + 1) * CAP * stride;
			for (let i = (floor * CAP + used) * stride; i < end; i++)
				if (array[i] !== 0)
					throw new Error(
						`audit: ${name} at slot ${Math.floor(i / stride)} is above floor ${floor}'s high water but not zero`,
					);
		}
	}

	#name(): string {
		return this.#modules.get(this.#module) ?? `module ${this.#module}`;
	}

	#fail(target: Target, word: number, diff: number): never {
		const { section, name } = target;
		const bit = LOW_BIT - Math.clz32(diff & -diff);
		const index = Math.floor(
			(word * WORD + (bit >> BYTE_SHIFT)) / section.unit,
		);
		const row =
			section.kind === MASKS
				? Math.floor(index / this.#engine.storage.maskWords)
				: index;
		const where =
			section.kind === CELLS
				? `cell ${index}`
				: section.kind === FREE
					? `free entry ${index}`
					: `slot ${this.#floor * CAP + row}`;
		throw new Error(
			`audit: ${this.#name()} wrote ${name} at ${where}, which it does not own`,
		);
	}

	#start(section: Section): number {
		return (
			(sectionStart(this.#engine, section, this.#floor) * section.unit) / WORD
		);
	}

	#span(section: Section, used: number, freed: number): number {
		return Math.ceil(
			(sectionCount(this.#engine, section, used, freed) * section.unit) / WORD,
		);
	}
}
