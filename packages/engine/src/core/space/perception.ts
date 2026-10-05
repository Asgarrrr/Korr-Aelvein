import type { Perception } from "../api";
import { MAX_PERCEIVED, PERCEPTION_RADIUS } from "../config";
import type { EntityId, Slot } from "../ecs/ids";
import { END, type Grid } from "./grid";

// Filled on first read: propose cannot move anything, so a lazy fill sees the same state.
export class PerceptionBuffer implements Perception {
	private n = 0;
	private stale = false;
	private floor = 0;
	private self = 0;
	private ox = 0;
	private oy = 0;
	private readonly slots = new Int32Array(MAX_PERCEIVED);

	constructor(
		private readonly grid: Grid,
		private readonly entityIds: Int32Array,
	) {}

	get count(): number {
		if (this.stale) this.fill();
		return this.n;
	}

	reset(floor: number, self: Slot): void {
		this.floor = floor;
		this.self = self;
		this.stale = true;
	}

	slot(i: number): Slot {
		if (this.stale) this.fill();
		return (this.slots[i] ?? 0) as Slot;
	}
	id(i: number): EntityId {
		if (this.stale) this.fill();
		return (this.entityIds[this.slots[i] ?? 0] ?? 0) as EntityId;
	}
	dx(i: number): number {
		if (this.stale) this.fill();
		return (this.grid.x[this.slots[i] ?? 0] ?? 0) - this.ox;
	}
	dy(i: number): number {
		if (this.stale) this.fill();
		return (this.grid.y[this.slots[i] ?? 0] ?? 0) - this.oy;
	}
	dist(i: number): number {
		const dx = Math.abs(this.dx(i));
		const dy = Math.abs(this.dy(i));
		return dx > dy ? dx : dy;
	}

	// Part of the floor image: decides which of two equally near entities a module sees first.
	private fill(): void {
		this.stale = false;
		const { grid, self, slots } = this;
		const { width, height, heads, next } = grid;
		const ox = grid.x[self] ?? 0;
		const oy = grid.y[self] ?? 0;
		this.ox = ox;
		this.oy = oy;
		const base = this.floor * grid.cells;
		let n = 0;
		for (let d = 0; d <= PERCEPTION_RADIUS; d++) {
			const x0 = ox - d < 0 ? 0 : ox - d;
			const x1 = ox + d >= width ? width - 1 : ox + d;
			const y0 = oy - d < 0 ? 0 : oy - d;
			const y1 = oy + d >= height ? height - 1 : oy + d;
			for (let y = y0; y <= y1; y++) {
				const edge = y === oy - d || y === oy + d;
				const stride = edge ? 1 : 2 * d;
				for (let x = edge ? x0 : ox - d; x <= x1; x += stride) {
					if (x < 0) continue;
					for (
						let s = heads[base + y * width + x] ?? END;
						s !== END;
						s = next[s] ?? END
					) {
						if (s === self) continue;
						slots[n++] = s;
						if (n === MAX_PERCEIVED) {
							this.n = n;
							return;
						}
					}
				}
			}
		}
		this.n = n;
	}
}
