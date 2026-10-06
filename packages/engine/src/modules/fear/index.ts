import {
	band,
	type CellReader,
	curve,
	defineModule,
	FAIL,
	type FieldView,
	NO_CELL,
	NO_ENTITY,
	NONE,
	PERCEPTION_RADIUS,
	type Query,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import { watchAction } from "./behaviours/watch";
import { fearConfig, MARGIN } from "./config";
import { fleeCell } from "./escape";
import { cells, schema } from "./schema";
import { nearestEater, sees } from "./sight";

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

const sightFlight = (): number => PERCEPTION_RADIUS;
const never = (): boolean => false;

// The flight distance the actor's boldness gives, or sight's for an actor without temperament.
function boldFlight(
	boldness: FieldView<"u8">,
	tempered: Query,
	byBoldness: readonly number[],
): (actor: Slot) => number {
	return (actor) =>
		tempered.has(actor)
			? (byBoldness[boldness.get(actor)] ?? 0)
			: PERCEPTION_RADIUS;
}

function below(
	value: FieldView<"i32">,
	fed: Query,
	threshold: number,
): (actor: Slot) => boolean {
	return (actor) => fed.has(actor) && value.get(actor) < threshold;
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
		const satiety = b.read("satiety");
		const wary = b.query(["wary"]);
		const { fleeing } = b.write("wary");
		const watchScore = band("vigilance", cfg.watchWeight);
		const danger = b.cells("danger");
		const previousDanger = b.previous("danger");
		const burns = b.cells("burns");
		const alarm = b.cells("alarm");
		const near = b.cells("reach");
		// Far floors replay for up to 64 turns; this makes a wary creature decide again when danger
		// first reaches its cell.
		b.alarm("alarm", "eats", ["wary"]);
		const eaters = diet ? b.query(["diet"]) : undefined;
		const reach = PERCEPTION_RADIUS + MARGIN;
		// A burning cell next door is always a threat, so no radius lets a creature step into fire.
		const fireReach = Math.max(cfg.fireRadius, 1);
		const heat = fireReach + MARGIN;

		// Without temperament, fear flees on sight; without hunger, no creature runs short.
		const traitFlight = temperament
			? boldFlight(
					temperament.boldness,
					b.query(["temperament"]),
					curve(cfg.flightByBoldness),
				)
			: sightFlight;
		const starving = satiety
			? below(satiety.value, b.query(["satiety"]), cfg.riskBelow)
			: never;

		// Within this Chebyshev distance a perceived eater makes the actor flee; beyond it, watch.
		const flightDistance = (actor: Slot): number => {
			let flight = traitFlight(actor);
			if (starving(actor)) flight--;
			if ((fleeing[actor] ?? 0) !== 0) flight++;
			return Math.min(PERCEPTION_RADIUS, Math.max(cfg.flightMin, flight));
		};

		// Marks every cell from which a wary creature could see an eater of its class, or
		// stand within fireRadius of a burning cell, this round, so a calm one skips perception.
		b.tick((ctx) => {
			const hunted = danger.eats.write(ctx);
			const heated = burns.near.write(ctx);
			const arrived = alarm.eats.write(ctx);
			const nearby = near.near.write(ctx);
			hunted.clear();
			heated.clear();
			arrived.clear();
			nearby.clear();
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
							const cell = ctx.cellAt(x + dx, y + dy);
							if (cell !== NO_CELL) heated.set(cell, 1);
						}
				}
			}
			if (!edible || !diet || !eaters) return;
			// Calms on last round's danger: this round's is stamped below, from the mask built here.
			const previousEats = previousDanger.eats.read(ctx);
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
				for (let dy = -MARGIN; dy <= MARGIN; dy++)
					for (let dx = -MARGIN; dx <= MARGIN; dx++) {
						const cell = ctx.cellAt(x + dx, y + dy);
						if (cell !== NO_CELL) nearby.set(cell, nearby.get(cell) | bits);
					}
			}
			// Only where danger is new: a creature already in it keeps its cached reaction.
			for (let c = hunted.next(NO_CELL); c !== NO_CELL; c = hunted.next(c))
				arrived.set(c, hunted.get(c) & ~previousEats.get(c));
		});

		// Re-executed later from a cached decision, so the target must still be a perceived threat.
		// Cornered, it fails rather than idles: on a replay the creature then decides afresh.
		const flee = b.action("flee", "entity", ["wary"], (ctx, actor, threat) => {
			if (!diet || !edible) return FAIL;
			const prey = edible.class.get(actor);
			// The same answer as the scan below, without reading the grid: no eater in reach.
			if ((danger.eats.read(ctx).get(ctx.cellOf(actor)) & prey) === 0)
				return FAIL;
			const eats = diet.eats;
			if (!sees(ctx, actor, threat, eats, prey)) return FAIL;
			const here = ctx.cellOf(actor);
			// Unmarked, no burning cell is within fireReach: the fire box would find nothing.
			const marked = burns.near.read(ctx).get(here) !== 0;
			const cell = fleeCell(
				ctx,
				actor,
				eats,
				near.near.read(ctx),
				prey,
				marked ? burning?.read(ctx) : undefined,
				fireReach,
			);
			if (cell === NO_CELL || cell === here) return FAIL;
			fleeing[actor] = 1;
			return ctx.instead(ctx.step, cell);
		});

		// Whether an eater of `prey` stands within `radius`: the check that ends watch and avoid.
		const threatNear = (
			ctx: ReadCtx,
			actor: Slot,
			prey: number,
			radius: number,
		): boolean =>
			diet !== undefined &&
			nearestEater(ctx, actor, diet.eats, near.near.read(ctx), prey, radius) !==
				NONE;

		const watch = watchAction(b, {
			edible,
			flightDistance,
			starving,
			threatNear,
			sees: (ctx, actor, threat, prey) =>
				diet !== undefined && sees(ctx, actor, threat, diet.eats, prey),
		});

		// Targets nothing: the fire it flees moves and dies out, but the intent stays valid
		// for as long as any burning cell is near. Staying put is a way to flee too.
		const avoid = b.action("avoid", "none", ["wary"], (ctx, actor) => {
			const fire = burning?.read(ctx);
			if (
				!fire ||
				burns.near.read(ctx).get(ctx.cellOf(actor)) === 0 ||
				!nearFire(ctx, actor, fire, fireReach)
			)
				return FAIL;
			const prey = edible ? edible.class.get(actor) : 0;
			// Replayed past the alarm: an eater within flight fails it, so the creature decides afresh.
			if (threatNear(ctx, actor, prey, flightDistance(actor))) return FAIL;
			const cell = fleeCell(
				ctx,
				actor,
				diet?.eats,
				near.near.read(ctx),
				prey,
				fire,
				fireReach,
			);
			if (cell === NO_CELL) return FAIL;
			if (cell === ctx.cellOf(actor)) return ctx.instead(ctx.idle, null);
			return ctx.instead(ctx.step, cell);
		});

		b.propose((ctx, actor, _perception, out) => {
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
			const nearby = near.near.read(ctx);
			const nearest =
				hunted && eats !== undefined
					? nearestEater(ctx, actor, eats, nearby, prey, PERCEPTION_RADIUS)
					: NONE;
			const threat = nearest === NONE ? NO_ENTITY : ctx.idOf(nearest);
			const distance =
				nearest === NONE
					? 0
					: Math.max(
							Math.abs(ctx.x(nearest) - ctx.x(actor)),
							Math.abs(ctx.y(nearest) - ctx.y(actor)),
						);
			const close = threat !== NO_ENTITY && distance <= flightDistance(actor);
			if (threat !== NO_ENTITY && !close && !starving(actor))
				out.push(watch, threat, watchScore);
			if (!close && !heated) return;
			const cell = fleeCell(ctx, actor, eats, nearby, prey, fire, fireReach);
			if (cell === NO_CELL) return;
			if (close && cell !== here) out.push(flee, threat, cfg.score);
			if (heated && !close) out.push(avoid, null, cfg.fireScore);
		});
	},
});
