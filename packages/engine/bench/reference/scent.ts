import {
	type Cell,
	defineModule,
	FAIL,
	NO_CELL,
	type ReadCtx,
	type Slot,
} from "../../src/core/api";

const scentConfig = {
	// Satiety under which a tracker follows a trail.
	trackBelow: 600,
	// Above wander and explore, below a meal in sight.
	score: 60,
} as const;

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

// A fake mechanic that owns a cell column with a previous-turn buffer: trails fade from last
// round's values and musk carriers stamp their cell by max, so row order cannot show.
// Trackers follow the strongest trail next to them without reading perception.
export const scent = defineModule({
	name: "scent",
	schema: {
		musk: { strength: "u8", fade: "u8" },
		tracker: { keen: "u8", trail: "i32", since: "i32" },
	},
	cells: { scent: { trail: "u8" } },
	config: scentConfig,
	setup(b, cfg) {
		const musk = b.write("musk");
		const tracker = b.write("tracker");
		const satiety = b.read("satiety");
		const carriers = b.query(["musk"]);
		const trackers = b.query(["tracker"]);
		const now = b.cells("scent");
		const was = b.previous("scent");

		b.tick((ctx) => {
			const trail = now.trail.write(ctx);
			const before = was.trail.read(ctx);
			for (let c = before.next(NO_CELL); c !== NO_CELL; c = before.next(c))
				trail.set(c, before.get(c) - 1);
			const rows = carriers.slots(ctx);
			const { strength, fade } = musk;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const cell = ctx.cellOf(s);
				const left = (strength[s] ?? 0) - (fade[s] ?? 0);
				if (left > trail.get(cell)) trail.set(cell, left);
			}
		});

		// The neighbour with the strongest trail above the actor's own cell, or NO_CELL.
		const strongest = (ctx: ReadCtx, actor: Slot): Cell => {
			const trail = now.trail.read(ctx);
			const x = ctx.x(actor);
			const y = ctx.y(actor);
			let best = NO_CELL;
			let top = trail.get(ctx.cellAt(x, y));
			for (let d = 0; d < DX.length; d++) {
				const cell = ctx.cellAt(x + (DX[d] ?? 0), y + (DY[d] ?? 0));
				const level = trail.get(cell);
				if (level <= top || ctx.holdsActor(cell)) continue;
				best = cell;
				top = level;
			}
			return best;
		};

		const track = b.action("track", "none", ["tracker"], (ctx, actor) => {
			const cell = strongest(ctx, actor);
			if (cell === NO_CELL) return FAIL;
			tracker.trail[actor] = cell;
			tracker.since[actor] = (tracker.since[actor] ?? 0) + 1;
			return ctx.instead(ctx.step, cell);
		});

		b.propose((ctx, actor, _perception, out) => {
			if (!satiety || !trackers.has(actor) || (tracker.keen[actor] ?? 0) === 0)
				return;
			if (satiety.value.get(actor) >= cfg.trackBelow) return;
			if (strongest(ctx, actor) !== NO_CELL) out.push(track, null, cfg.score);
		});
	},
});
