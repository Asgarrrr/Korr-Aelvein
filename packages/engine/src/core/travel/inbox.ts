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
	width = 0;
	private readonly lists: Int32Array[];
	private readonly counts: Int32Array;

	constructor(floors: number) {
		this.lists = Array.from({ length: floors }, () => new Int32Array(0));
		this.counts = new Int32Array(floors);
	}

	count(floor: number): number {
		return this.counts[floor] ?? 0;
	}

	words(floor: number): Int32Array {
		return this.lists[floor] as Int32Array;
	}

	// Returns where the new entry starts; the caller fills its body.
	insert(
		floor: number,
		time: number,
		id: number,
		x: number,
		y: number,
	): number {
		const width = this.width;
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

	keep(floor: number, kept: (start: number) => boolean): void {
		const width = this.width;
		const list = this.words(floor);
		const n = this.count(floor);
		let w = 0;
		for (let r = 0; r < n; r++) {
			if (!kept(r * width)) continue;
			if (w !== r) list.copyWithin(w * width, r * width, (r + 1) * width);
			w++;
		}
		list.fill(0, w * width, n * width);
		this.counts[floor] = w;
	}

	replace(floor: number, words: Int32Array, count: number): void {
		this.lists[floor] = words.slice();
		this.counts[floor] = count;
	}
}
