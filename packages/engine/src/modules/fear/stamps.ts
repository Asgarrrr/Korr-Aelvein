import {
	type CellReader,
	type CellWriter,
	type FieldView,
	NO_CELL,
	PERCEPTION_RADIUS,
	type ReadCtx,
	type SlotList,
	type TickFn,
} from "../../core/module/api";
import { MARGIN } from "./config";
import type { FearReaders } from "./readers";
import { type FearBuilder, type FearConfig, fireReach } from "./situation";

const REACH = PERCEPTION_RADIUS + MARGIN;

// Marks every cell within `radius` of a burning cell.
function stampHeat(
	ctx: ReadCtx,
	fire: CellReader<"u8">,
	heatCells: CellWriter<"u8">,
	radius: number,
): void {
	const width = ctx.width;
	for (let c = fire.next(NO_CELL); c !== NO_CELL; c = fire.next(c)) {
		const x = c % width;
		const y = (c - x) / width;
		for (let dy = -radius; dy <= radius; dy++)
			for (let dx = -radius; dx <= radius; dx++) {
				const cell = ctx.cellAt(x + dx, y + dy);
				if (cell !== NO_CELL) heatCells.set(cell, 1);
			}
	}
}

// Ends `fleeing` where last round's danger left the creature's cell; returns the wary classes.
function calm(
	ctx: ReadCtx,
	prey: SlotList,
	kindOf: FieldView<"u8">,
	fleeing: Uint8Array,
	previousEats: CellReader<"u8">,
): number {
	let preyMask = 0;
	for (let i = 0; i < prey.length; i++) {
		const s = prey.at(i);
		const kind = kindOf.get(s);
		preyMask |= kind;
		if (
			(fleeing[s] ?? 0) !== 0 &&
			(previousEats.get(ctx.cellOf(s)) & kind) === 0
		)
			fleeing[s] = 0;
	}
	return preyMask;
}

// Marks every cell from which a wary creature could see an eater of its class, or
// stand within fireRadius of a burning cell, this round, so a calm one skips perception.
export function stampFear(
	b: FearBuilder,
	cfg: FearConfig,
	readers: FearReaders,
): TickFn {
	const { diet, edible, burning, wary, fleeing, danger, heat, presence } =
		readers;
	const eaters = diet ? b.query(["diet"]) : undefined;
	const previousDanger = b.previous("danger");
	const alarm = b.cells("alarm");
	const heatReach = fireReach(cfg) + MARGIN;
	return (ctx) => {
		const huntedCells = danger.eats.write(ctx);
		const heatCells = heat.reach.write(ctx);
		const alarmCells = alarm.eats.write(ctx);
		const presenceCells = presence.near.write(ctx);
		huntedCells.clear();
		heatCells.clear();
		alarmCells.clear();
		presenceCells.clear();
		const prey = wary.slots(ctx);
		if (prey.length === 0) return;
		if (burning) stampHeat(ctx, burning.read(ctx), heatCells, heatReach);
		// Without diet or edible, no creature eats or is eaten: only heat is stamped.
		if (!edible || !diet || !eaters) return;
		// Calms on last round's danger: this round's is stamped below, from the mask built here.
		const previousEats = previousDanger.eats.read(ctx);
		const preyMask = calm(ctx, prey, edible.class, fleeing, previousEats);
		if (preyMask === 0) return;
		// Inline on purpose: as separate functions these loops measured +5-12% on this tick.
		const rows = eaters.slots(ctx);
		for (let i = 0; i < rows.length; i++) {
			const s = rows.at(i);
			const bits = diet.eats.get(s) & preyMask;
			if (bits === 0) continue;
			const x = ctx.x(s);
			const y = ctx.y(s);
			for (let dy = -REACH; dy <= REACH; dy++)
				for (let dx = -REACH; dx <= REACH; dx++) {
					const cell = ctx.cellAt(x + dx, y + dy);
					if (cell !== NO_CELL)
						huntedCells.set(cell, huntedCells.get(cell) | bits);
				}
			for (let dy = -MARGIN; dy <= MARGIN; dy++)
				for (let dx = -MARGIN; dx <= MARGIN; dx++) {
					const cell = ctx.cellAt(x + dx, y + dy);
					if (cell !== NO_CELL)
						presenceCells.set(cell, presenceCells.get(cell) | bits);
				}
		}
		// Only where danger is new: a creature already in it keeps its cached reaction.
		for (
			let c = huntedCells.next(NO_CELL);
			c !== NO_CELL;
			c = huntedCells.next(c)
		)
			alarmCells.set(c, huntedCells.get(c) & ~previousEats.get(c));
	};
}
