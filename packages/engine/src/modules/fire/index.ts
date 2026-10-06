import {
	defineModule,
	type EntityId,
	NO_CELL,
	NO_ENTITY,
	NONE,
} from "../../core/module/api";
import { fireConfig } from "./config";
import { cells, schema } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const PERCENT = 100;

// Spreads from last round's fire only, and combines writes to one cell by max and min, so
// the result depends neither on the order of rows nor on the order of a cell's occupants.
export const fire = defineModule({
	name: "fire",
	schema,
	cells,
	config: fireConfig,
	setup(b, cfg) {
		const flammable = b.write("flammable");
		const fuel = b.query(["flammable"]);
		const embers = b.query(["ignites"]);
		const bodies = b.query(["vitality"]);
		const now = b.cells("fire");
		const was = b.previous("fire");

		b.tick((ctx) => {
			const left = now.left.write(ctx);
			const source = now.source.write(ctx);
			const wasLeft = was.left.read(ctx);
			const wasSource = was.source.read(ctx);
			const width = ctx.width;

			for (let c = wasLeft.next(NO_CELL); c !== NO_CELL; c = wasLeft.next(c)) {
				const turns = wasLeft.get(c) - 1;
				left.set(c, turns);
				if (turns === 0) source.set(c, NO_ENTITY);
			}

			const lit = embers.slots(ctx);
			for (let i = 0; i < lit.length; i++) {
				const s = lit.at(i);
				const cell = ctx.cellOf(s);
				left.set(cell, cfg.emberLeft);
				source.set(cell, NO_ENTITY);
			}
			for (let i = 0; i < lit.length; i++) {
				const s = lit.at(i);
				const cell = ctx.cellOf(s);
				const id = ctx.idOf(s);
				const held = source.get(cell);
				if (held === NO_ENTITY || id < held) source.set(cell, id);
			}

			// An ignites row is never fuel: it is what keeps its cell burning.
			for (let c = wasLeft.next(NO_CELL); c !== NO_CELL; c = wasLeft.next(c)) {
				const feeder = wasSource.get(c);
				for (let s = ctx.firstAt(c); s !== NONE; s = ctx.nextAt(s))
					if (fuel.has(s) && !embers.has(s)) ctx.kill(ctx.idOf(s), feeder);
				const x = c % width;
				const y = (c - x) / width;
				for (let d = 0; d < DX.length; d++) {
					const nx = x + (DX[d] ?? 0);
					const ny = y + (DY[d] ?? 0);
					const near = ctx.cellAt(nx, ny);
					if (near === NO_CELL || wasLeft.get(near) !== 0) continue;
					// Handled once, from its first burning neighbour in DX order; the cause is the
					// lowest source among all its burning neighbours.
					let seen = false;
					let cause: EntityId = NO_ENTITY;
					for (let e = 0; e < DX.length; e++) {
						const m = ctx.cellAt(nx + (DX[e] ?? 0), ny + (DY[e] ?? 0));
						if (wasLeft.get(m) === 0) continue;
						if (!seen && m !== c) break;
						seen = true;
						const from = wasSource.get(m);
						if (cause === NO_ENTITY || from < cause) cause = from;
					}
					if (!seen) continue;
					let rolled = false;
					for (let s = ctx.firstAt(near); s !== NONE; s = ctx.nextAt(s)) {
						if (!fuel.has(s) || embers.has(s)) continue;
						// Drawn per cell, not per fuel: fuels sharing a cell catch together.
						if (!rolled) {
							if (ctx.rngCell(near, 0, PERCENT) >= cfg.spreadChance) break;
							rolled = true;
						}
						const id = ctx.idOf(s);
						const burn = flammable.burn[s] ?? 0;
						if (burn > 0) {
							if (burn > left.get(near)) left.set(near, burn);
							const held = source.get(near);
							if (held === NO_ENTITY || id < held) source.set(near, id);
						}
						ctx.kill(id, cause);
					}
				}
			}

			// Fuel is consumed, never harmed.
			for (let c = left.next(NO_CELL); c !== NO_CELL; c = left.next(c)) {
				const feeder = source.get(c);
				for (let s = ctx.firstAt(c); s !== NONE; s = ctx.nextAt(s))
					if (bodies.has(s) && !fuel.has(s))
						ctx.harm(ctx.idOf(s), cfg.damage, feeder);
			}
		});
	},
});
