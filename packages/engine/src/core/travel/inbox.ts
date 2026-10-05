import type { EntityId, Slot } from "../ecs/ids";
import type { Column } from "../ecs/schema";
import { PLAYER, type Storage } from "../ecs/storage";

export const TIME = 0;
export const ID = 1;
export const X = 2;
export const Y = 3;
// Then the entity's mask words, then one word per carried column.
export const ENTRY_HEAD = 4;
const FIRST_SIZE = 4;

// Entities on their way to a floor, owned by the receiving floor and saved with it. Kept sorted
// by (time, id), so the order other floors posted in never shows in the image.
export class Inbox {
	private readonly entryWidth: number;
	private readonly storage: Storage;
	private readonly carried: readonly Column[];
	private readonly lists: Int32Array[];
	private readonly counts: Int32Array;
	private readonly transit: Int32Array;

	constructor(storage: Storage, carried: readonly Column[]) {
		this.storage = storage;
		this.carried = carried;
		this.entryWidth = ENTRY_HEAD + storage.maskWords + carried.length;
		this.lists = Array.from(
			{ length: storage.floors },
			() => new Int32Array(0),
		);
		this.counts = new Int32Array(storage.floors);
		this.transit = new Int32Array(storage.floors);
	}

	get width(): number {
		return this.entryWidth;
	}

	count(floor: number): number {
		return this.counts[floor] ?? 0;
	}

	// Read only: snapshot and hash copy the entries word for word.
	words(floor: number): Int32Array {
		return this.lists[floor] as Int32Array;
	}

	time(floor: number, n: number): number {
		return this.words(floor)[n * this.entryWidth + TIME] ?? 0;
	}

	id(floor: number, n: number): EntityId {
		return (this.words(floor)[n * this.entryWidth + ID] ?? 0) as EntityId;
	}

	x(floor: number, n: number): number {
		return this.words(floor)[n * this.entryWidth + X] ?? 0;
	}

	y(floor: number, n: number): number {
		return this.words(floor)[n * this.entryWidth + Y] ?? 0;
	}

	post(
		to: number,
		time: number,
		id: EntityId,
		x: number,
		y: number,
		slot: Slot,
	): void {
		const at = this.insert(to, time, id, x, y);
		const list = this.words(to);
		const { masks, maskWords } = this.storage;
		for (let w = 0; w < maskWords; w++)
			list[at + ENTRY_HEAD + w] = masks[slot * maskWords + w] ?? 0;
		const body = at + ENTRY_HEAD + maskWords;
		const carried = this.carried;
		for (let c = 0; c < carried.length; c++)
			list[body + c] = carried[c]?.[slot] ?? 0;
		if (((list[at + ENTRY_HEAD] ?? 0) & PLAYER) !== 0)
			this.transit[to] = (this.transit[to] ?? 0) + 1;
	}

	// The entry stays until `keep` drops it.
	land(floor: number, n: number, slot: Slot): void {
		const list = this.words(floor);
		const at = n * this.entryWidth;
		if (((list[at + ENTRY_HEAD] ?? 0) & PLAYER) !== 0)
			this.transit[floor] = (this.transit[floor] ?? 0) - 1;
		const { masks, maskWords } = this.storage;
		for (let w = 0; w < maskWords; w++)
			masks[slot * maskWords + w] = list[at + ENTRY_HEAD + w] ?? 0;
		const body = at + ENTRY_HEAD + maskWords;
		const carried = this.carried;
		for (let c = 0; c < carried.length; c++) {
			const column = carried[c];
			if (column) column[slot] = list[body + c] ?? 0;
		}
	}

	holds(id: EntityId): boolean {
		for (let f = 0; f < this.counts.length; f++)
			for (let n = 0; n < this.count(f); n++)
				if (this.id(f, n) === id) return true;
		return false;
	}

	// Players on their way to the floor: with its player rows, they set the decision periods.
	players(floor: number): number {
		return this.transit[floor] ?? 0;
	}

	keep(floor: number, kept: (n: number) => boolean): void {
		const width = this.entryWidth;
		const list = this.words(floor);
		const n = this.count(floor);
		let w = 0;
		for (let r = 0; r < n; r++) {
			if (!kept(r)) continue;
			if (w !== r) list.copyWithin(w * width, r * width, (r + 1) * width);
			w++;
		}
		list.fill(0, w * width, n * width);
		this.counts[floor] = w;
	}

	replace(floor: number, words: Int32Array, count: number): void {
		this.lists[floor] = words.slice();
		this.counts[floor] = count;
		let players = 0;
		for (let n = 0; n < count; n++)
			if (((words[n * this.entryWidth + ENTRY_HEAD] ?? 0) & PLAYER) !== 0)
				players++;
		this.transit[floor] = players;
	}

	private insert(
		floor: number,
		time: number,
		id: number,
		x: number,
		y: number,
	): number {
		const width = this.entryWidth;
		const n = this.count(floor);
		let list = this.words(floor);
		if ((n + 1) * width > list.length) {
			const grown = new Int32Array(Math.max(FIRST_SIZE, 2 * n) * width);
			grown.set(list);
			list = grown;
			this.lists[floor] = grown;
		}
		let at = n;
		while (at > 0) {
			const before = (at - 1) * width;
			const t = list[before + TIME] ?? 0;
			if (t < time || (t === time && (list[before + ID] ?? 0) < id)) break;
			at--;
		}
		list.copyWithin((at + 1) * width, at * width, n * width);
		const start = at * width;
		list.fill(0, start, start + width);
		list[start + TIME] = time;
		list[start + ID] = id;
		list[start + X] = x;
		list[start + Y] = y;
		this.counts[floor] = n + 1;
		return start;
	}
}
