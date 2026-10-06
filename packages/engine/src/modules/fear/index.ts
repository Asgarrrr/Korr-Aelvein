import {
	band,
	type Cell,
	type CellReader,
	curve,
	defineModule,
	FAIL,
	type FieldView,
	NO_CELL,
	NO_ENTITY,
	PERCEPTION_RADIUS,
	type Perception,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import { watchAction } from "./behaviours/watch";
import { fearConfig } from "./config";
import { cells, schema } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIRS = DX.length;
// Indexes into DX and DY.
const NW = 0;
const N = 1;
const NE = 2;
const W = 3;
const E = 4;
const SW = 5;
const S = 6;
const SE = 7;
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

// The distance from step (dx, dy) to a threat at (tx, ty) folded by min into `held`, or -1
// once the step closes on any threat; min keeps -1, so threat order cannot show.
function closer(
	held: number,
	tx: number,
	ty: number,
	dx: number,
	dy: number,
): number {
	const then = Math.max(Math.abs(tx - dx), Math.abs(ty - dy));
	if (then < Math.max(Math.abs(tx), Math.abs(ty))) return -1;
	return then < held ? then : held;
}

// The step kept so far, packed as (farthest + 1) * DIRS + d, or -1, weighed against step d.
function consider(
	ctx: ReadCtx,
	x: number,
	y: number,
	d: number,
	nearest: number,
	kept: number,
): number {
	if (nearest < 0 || nearest === UNSEEN) return kept;
	const dx = DX[d] ?? 0;
	const dy = DY[d] ?? 0;
	const cell = ctx.cellAt(x + dx, y + dy);
	if (cell === NO_CELL) return kept;
	const farthest = kept < 0 ? -1 : Math.floor(kept / DIRS) - 1;
	const keptD = kept < 0 ? -1 : kept % DIRS;
	const straight = keptD >= 0 && (DX[keptD] === 0 || DY[keptD] === 0);
	const axial = dx === 0 || dy === 0;
	if (nearest < farthest) return kept;
	if (nearest === farthest && (straight || !axial)) return kept;
	if (ctx.holdsActor(cell)) return kept;
	return (nearest + 1) * DIRS + d;
}

// The step never closer to any threat (eater in sight, burning cell within radius) that is
// farthest from the nearest, straight steps first; else the actor's own cell; NO_CELL if no threat.
// Each threat is read once into eight locals: a per-call array measured +60-100 MB of RSS (213-251
// vs 152 MB), and a module keeps no scratch outside its columns.
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
	const side = burning ? 2 * radius + 1 : 0;
	let n0 = UNSEEN;
	let n1 = UNSEEN;
	let n2 = UNSEEN;
	let n3 = UNSEEN;
	let n4 = UNSEEN;
	let n5 = UNSEEN;
	let n6 = UNSEEN;
	let n7 = UNSEEN;
	let threatened = false;
	// Eaters in sight first, then each cell of the fire box.
	for (let i = 0; i < count + side * side; i++) {
		let tx: number;
		let ty: number;
		if (i < count) {
			if (((eats?.get(perception.slot(i)) ?? 0) & prey) === 0) continue;
			tx = perception.dx(i);
			ty = perception.dy(i);
		} else {
			const j = i - count;
			tx = (j % side) - radius;
			ty = Math.floor(j / side) - radius;
			if (burning?.get(ctx.cellAt(x + tx, y + ty)) === 0) continue;
		}
		threatened = true;
		n0 = closer(n0, tx, ty, -1, -1);
		n1 = closer(n1, tx, ty, 0, -1);
		n2 = closer(n2, tx, ty, 1, -1);
		n3 = closer(n3, tx, ty, -1, 0);
		n4 = closer(n4, tx, ty, 1, 0);
		n5 = closer(n5, tx, ty, -1, 1);
		n6 = closer(n6, tx, ty, 0, 1);
		n7 = closer(n7, tx, ty, 1, 1);
	}
	if (!threatened) return NO_CELL;
	let kept = consider(ctx, x, y, NW, n0, -1);
	kept = consider(ctx, x, y, N, n1, kept);
	kept = consider(ctx, x, y, NE, n2, kept);
	kept = consider(ctx, x, y, W, n3, kept);
	kept = consider(ctx, x, y, E, n4, kept);
	kept = consider(ctx, x, y, SW, n5, kept);
	kept = consider(ctx, x, y, S, n6, kept);
	kept = consider(ctx, x, y, SE, n7, kept);
	// Staying is never closer to anything, so it is the fallback whenever a threat is in reach.
	if (kept < 0) return ctx.cellAt(x, y);
	const d = kept % DIRS;
	return ctx.cellAt(x + (DX[d] ?? 0), y + (DY[d] ?? 0));
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
		const temperament = b.read("temperament");
		const tempered = temperament ? b.query(["temperament"]) : undefined;
		const satiety = b.read("satiety");
		const fed = satiety ? b.query(["satiety"]) : undefined;
		const wary = b.query(["wary"]);
		const { fleeing } = b.write("wary");
		const flightByBoldness = curve(cfg.flightByBoldness);
		const watchScore = band("vigilance", cfg.watchWeight);
		const danger = b.cells("danger");
		const previous = b.previous("danger");
		const burns = b.cells("burns");
		const alarm = b.cells("alarm");
		// Far floors replay for up to 64 turns; this makes a wary creature react on arrival.
		b.alarm(alarm.eats, ["wary"]);
		const eaters = diet ? b.query(["diet"]) : undefined;
		const reach = PERCEPTION_RADIUS + MARGIN;
		// A burning cell next door is always a threat, so no radius lets a creature step into fire.
		const fireReach = Math.max(cfg.fireRadius, 1);
		const heat = fireReach + MARGIN;

		// Within this Chebyshev distance a perceived eater makes the actor flee; beyond it, watch.
		const flightDistance = (actor: Slot): number => {
			let flight =
				temperament && tempered?.has(actor)
					? (flightByBoldness[temperament.boldness.get(actor)] ?? 0)
					: PERCEPTION_RADIUS;
			if (
				satiety &&
				fed?.has(actor) &&
				satiety.value.get(actor) < cfg.riskBelow
			)
				flight--;
			if ((fleeing[actor] ?? 0) !== 0) flight++;
			return Math.min(PERCEPTION_RADIUS, Math.max(cfg.flightMin, flight));
		};

		// Marks every cell from which a wary creature could see an eater of its class, or
		// stand within fireRadius of a burning cell, this round, so a calm one skips perception.
		b.tick((ctx) => {
			const hunted = danger.eats.write(ctx);
			const heated = burns.near.write(ctx);
			const arrived = alarm.eats.write(ctx);
			hunted.clear();
			heated.clear();
			arrived.clear();
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
			// Calms on last round's danger: this round's is stamped below, from the mask built here.
			const previousEats = previous.eats.read(ctx);
			let preyMask = 0;
			for (let i = 0; i < prey.length; i++) {
				const s = prey.at(i);
				const kind = edible.class.get(s);
				preyMask |= kind;
				if (
					(fleeing[s] ?? 0) !== 0 &&
					(previousEats.get(ctx.cellOf(s)) & kind) === 0
				)
					fleeing[s] = 0;
			}
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
			// Only where danger is new: a creature already in it keeps its cached reaction.
			for (let c = hunted.next(NO_CELL); c !== NO_CELL; c = hunted.next(c))
				arrived.set(c, hunted.get(c) & ~previousEats.get(c));
		});

		// Re-executed later from a cached decision, so the target must still be a perceived threat.
		// Cornered, it fails rather than idles: the creature then does whatever else it would.
		const flee = b.action(
			"flee",
			"entity",
			["wary"],
			(ctx, actor, threat, perception) => {
				if (!diet || !edible) return FAIL;
				const prey = edible.class.get(actor);
				// The same answer as the scan below, without filling perception: no eater in reach.
				if ((danger.eats.read(ctx).get(ctx.cellOf(actor)) & prey) === 0)
					return FAIL;
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
				const here = ctx.cellOf(actor);
				if (cell === NO_CELL || cell === here) return FAIL;
				fleeing[actor] = 1;
				return ctx.instead(ctx.step, cell);
			},
		);

		const watch = watchAction(b, { diet, edible, flightDistance });

		// Targets nothing: the fire it flees moves and dies out, but the intent stays valid
		// for as long as any burning cell is near. Staying put is a way to flee too.
		const avoid = b.action(
			"avoid",
			"none",
			["wary"],
			(ctx, actor, _none, perception) => {
				const fire = burning?.read(ctx);
				if (
					!fire ||
					burns.near.read(ctx).get(ctx.cellOf(actor)) === 0 ||
					!nearFire(ctx, actor, fire, fireReach)
				)
					return FAIL;
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
				if (cell === ctx.cellOf(actor)) return ctx.instead(ctx.idle, null);
				return ctx.instead(ctx.step, cell);
			},
		);

		b.propose((ctx, actor, perception, out) => {
			if (!wary.has(actor)) return;
			const here = ctx.cellOf(actor);
			const prey = edible ? edible.class.get(actor) : 0;
			const eats = diet?.eats;
			const hunted =
				eats !== undefined && (danger.eats.read(ctx).get(here) & prey) !== 0;
			const marked =
				burning !== undefined && burns.near.read(ctx).get(here) !== 0;
			if (!hunted && !marked) return;
			const fire = burning?.read(ctx);
			const heated =
				fire !== undefined && nearFire(ctx, actor, fire, fireReach);
			if (!hunted && !heated) return;
			// Perception lists rings outward: the first eater found is the nearest.
			let threat = NO_ENTITY;
			let distance = 0;
			for (let i = 0; hunted && i < perception.count; i++)
				if (((eats?.get(perception.slot(i)) ?? 0) & prey) !== 0) {
					threat = perception.id(i);
					distance = perception.dist(i);
					break;
				}
			const close = threat !== NO_ENTITY && distance <= flightDistance(actor);
			if (threat !== NO_ENTITY && !close) out.push(watch, threat, watchScore);
			if (!close && !heated) return;
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
			if (close && cell !== here) out.push(flee, threat, cfg.score);
			if (heated) out.push(avoid, null, cfg.fireScore);
		});
	},
});
