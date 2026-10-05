import {
	type Cell,
	type CellReader,
	defineModule,
	FAIL,
	type FieldView,
	NO_CELL,
	NO_ENTITY,
	PERCEPTION_RADIUS,
	type Perception,
	type ReadCtx,
	type Slot,
} from "../../core/api";
import { fearConfig } from "./config";
import { cells, schema } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const UNSEEN = Number.MAX_SAFE_INTEGER;
// One cell of slack on every stamp: an eater moves at most one cell between fear's tick and
// its prey's turn, and fire spreads at most one cell a round, were fear ever to tick first.
const MARGIN = 1;

type Burning = CellReader<"u8">;

function nearFire(
	ctx: ReadCtx,
	actor: Slot,
	burning: Burning,
	radius: number,
): boolean {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	for (let dy = -radius; dy <= radius; dy++)
		for (let dx = -radius; dx <= radius; dx++)
			if (burning.get(ctx.cellAt(x + dx, y + dy)) > 0) return true;
	return false;
}

function seesEater(
	perception: Perception,
	eats: FieldView<"u8"> | undefined,
	prey: number,
): boolean {
	if (eats === undefined || prey === 0) return false;
	for (let i = 0; i < perception.count; i++)
		if ((eats.get(perception.slot(i)) & prey) !== 0) return true;
	return false;
}

// The step never closer to any threat (eater in sight, burning cell within radius) that is
// farthest from the nearest, straight steps first; else the actor's own cell; NO_CELL if no threat.
function fleeCell(
	ctx: ReadCtx,
	actor: Slot,
	perception: Perception,
	eats: FieldView<"u8"> | undefined,
	prey: number,
	burning: Burning | undefined,
	radius: number,
): Cell {
	const count = eats === undefined || prey === 0 ? 0 : perception.count;
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	let best = NO_CELL;
	let farthest = -1;
	let straight = false;
	for (let d = 0; d < DX.length; d++) {
		const dx = DX[d] ?? 0;
		const dy = DY[d] ?? 0;
		const cell = ctx.cellAt(x + dx, y + dy);
		if (cell === NO_CELL) continue;
		let nearest = UNSEEN;
		for (let i = 0; i < count && nearest >= 0; i++) {
			if (((eats?.get(perception.slot(i)) ?? 0) & prey) === 0) continue;
			const tx = perception.dx(i);
			const ty = perception.dy(i);
			const then = Math.max(Math.abs(tx - dx), Math.abs(ty - dy));
			if (then < Math.max(Math.abs(tx), Math.abs(ty))) nearest = -1;
			else if (then < nearest) nearest = then;
		}
		if (burning)
			for (let ty = -radius; ty <= radius && nearest >= 0; ty++)
				for (let tx = -radius; tx <= radius && nearest >= 0; tx++) {
					if (burning.get(ctx.cellAt(x + tx, y + ty)) === 0) continue;
					const then = Math.max(Math.abs(tx - dx), Math.abs(ty - dy));
					if (then < Math.max(Math.abs(tx), Math.abs(ty))) nearest = -1;
					else if (then < nearest) nearest = then;
				}
		if (nearest < 0 || nearest === UNSEEN) continue;
		const axial = dx === 0 || dy === 0;
		if (nearest < farthest) continue;
		if (nearest === farthest && (straight || !axial)) continue;
		if (ctx.holdsActor(cell)) continue;
		best = cell;
		farthest = nearest;
		straight = axial;
	}
	if (best !== NO_CELL) return best;
	// Staying is never closer to anything, so it is the fallback whenever a threat is in reach.
	const threatened =
		seesEater(perception, eats, prey) ||
		(burning !== undefined && nearFire(ctx, actor, burning, radius));
	return threatened ? ctx.cellAt(x, y) : NO_CELL;
}

export const fear = defineModule({
	name: "fear",
	schema,
	cells,
	config: fearConfig,
	setup(b, cfg) {
		const diet = b.read("diet");
		const edible = b.read("edible");
		const burning = b.read("fire")?.left;
		const wary = b.query(["wary"]);
		const danger = b.cells("danger");
		const eaters = diet ? b.query(["diet"]) : undefined;
		const reach = PERCEPTION_RADIUS + MARGIN;
		// A burning cell next door is always a threat, so no radius lets a creature step into fire.
		const fireReach = Math.max(cfg.fireRadius, 1);
		const heat = fireReach + MARGIN;

		// Marks every cell from which a wary creature could see an eater of its class, or
		// stand within fireRadius of a burning cell, this round, so a calm one skips perception.
		b.tick((ctx) => {
			const hunted = danger.eats.write(ctx);
			const heated = danger.fire.write(ctx);
			hunted.clear();
			heated.clear();
			const prey = wary.slots(ctx);
			if (prey.length === 0) return;
			if (burning) {
				const fire = burning.read(ctx);
				const width = ctx.width;
				for (let c = fire.next(NO_CELL); c !== NO_CELL; c = fire.next(c)) {
					const x = c % width;
					const y = (c - x) / width;
					for (let dy = -heat; dy <= heat; dy++)
						for (let dx = -heat; dx <= heat; dx++) {
							const near = ctx.cellAt(x + dx, y + dy);
							if (near !== NO_CELL) heated.set(near, 1);
						}
				}
			}
			if (!edible || !diet || !eaters) return;
			let preyMask = 0;
			for (let i = 0; i < prey.length; i++)
				preyMask |= edible.class.get(prey.at(i));
			if (preyMask === 0) return;
			const rows = eaters.slots(ctx);
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const bits = diet.eats.get(s) & preyMask;
				if (bits === 0) continue;
				const x = ctx.x(s);
				const y = ctx.y(s);
				for (let dy = -reach; dy <= reach; dy++)
					for (let dx = -reach; dx <= reach; dx++) {
						const cell = ctx.cellAt(x + dx, y + dy);
						if (cell !== NO_CELL) hunted.set(cell, hunted.get(cell) | bits);
					}
			}
		});

		// Re-executed later from a cached decision, so the target must still be a perceived threat.
		// Cornered, it fails rather than idles: the creature then does whatever else it would.
		const flee = b.action(
			"flee",
			"entity",
			(ctx, actor, threat, perception) => {
				if (!diet || !edible) return FAIL;
				const prey = edible.class.get(actor);
				const eats = diet.eats;
				const count = perception.count;
				let seen = false;
				for (let i = 0; i < count && !seen; i++)
					seen =
						perception.id(i) === threat &&
						(eats.get(perception.slot(i)) & prey) !== 0;
				if (!seen) return FAIL;
				const cell = fleeCell(
					ctx,
					actor,
					perception,
					eats,
					prey,
					burning?.read(ctx),
					fireReach,
				);
				const here = ctx.cellAt(ctx.x(actor), ctx.y(actor));
				if (cell === NO_CELL || cell === here) return FAIL;
				return ctx.instead(ctx.step, cell);
			},
		);

		// Targets nothing: the fire it flees moves and dies out, but the intent stays valid
		// for as long as any burning cell is near. Staying put is a way to flee too.
		const avoid = b.action("avoid", "none", (ctx, actor, _none, perception) => {
			const fire = burning?.read(ctx);
			if (!fire || !nearFire(ctx, actor, fire, fireReach)) return FAIL;
			const prey = edible ? edible.class.get(actor) : 0;
			const cell = fleeCell(
				ctx,
				actor,
				perception,
				diet?.eats,
				prey,
				fire,
				fireReach,
			);
			if (cell === NO_CELL) return FAIL;
			if (cell === ctx.cellAt(ctx.x(actor), ctx.y(actor)))
				return ctx.instead(ctx.idle, null);
			return ctx.instead(ctx.step, cell);
		});

		b.propose((ctx, actor, perception, out) => {
			if (!wary.has(actor)) return;
			const here = ctx.cellAt(ctx.x(actor), ctx.y(actor));
			const prey = edible ? edible.class.get(actor) : 0;
			const eats = diet?.eats;
			const hunted =
				eats !== undefined && (danger.eats.read(ctx).get(here) & prey) !== 0;
			const marked =
				burning !== undefined && danger.fire.read(ctx).get(here) !== 0;
			if (!hunted && !marked) return;
			const fire = burning?.read(ctx);
			const heated =
				fire !== undefined && nearFire(ctx, actor, fire, fireReach);
			if (!hunted && !heated) return;
			let threat = NO_ENTITY;
			for (let i = 0; hunted && i < perception.count; i++)
				if (((eats?.get(perception.slot(i)) ?? 0) & prey) !== 0) {
					threat = perception.id(i);
					break;
				}
			if (threat === NO_ENTITY && !heated) return;
			const cell = fleeCell(
				ctx,
				actor,
				perception,
				eats,
				prey,
				fire,
				fireReach,
			);
			if (cell === NO_CELL) return;
			if (threat !== NO_ENTITY && cell !== here)
				out.push(flee, threat, cfg.score);
			if (heated) out.push(avoid, null, cfg.fireScore);
		});
	},
});
