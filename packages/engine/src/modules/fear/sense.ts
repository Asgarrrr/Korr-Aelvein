import {
	type Cell,
	type CellReader,
	curve,
	type EntityId,
	type FieldView,
	NO_CELL,
	NO_ENTITY,
	NONE,
	PERCEPTION_RADIUS,
	type Query,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import { fleeCell } from "./escape";
import { nearestEater, sees } from "./sight";
import type { FearBuilder, FearConfig, Situation } from "./situation";

export interface FearSense {
	wary(actor: Slot): boolean;
	// False when the actor is neither hunted nor near fire: no fear behaviour applies.
	fill(ctx: ReadCtx, actor: Slot, s: Situation): boolean;
	hunted(ctx: ReadCtx, actor: Slot): boolean;
	sees(ctx: ReadCtx, actor: Slot, threat: EntityId): boolean;
	// Whether an eater of the actor's class stands within `radius`.
	threatNear(ctx: ReadCtx, actor: Slot, radius: number): boolean;
	// A burning cell within the fire's reach, read only where heat marks the cell.
	heated(ctx: ReadCtx, actor: Slot): boolean;
	escape(ctx: ReadCtx, actor: Slot): Cell;
	// Within this Chebyshev distance a perceived eater makes the actor flee; beyond it, watch.
	flightDistance(actor: Slot): number;
	starving(actor: Slot): boolean;
	markFleeing(actor: Slot): void;
}

// A burning cell next door is always a threat, so no radius lets a creature step into fire.
export const fireReach = (cfg: FearConfig): number =>
	Math.max(cfg.fireRadius, 1);

function nearFire(
	ctx: ReadCtx,
	actor: Slot,
	burning: CellReader<"u8">,
	radius: number,
): boolean {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	for (let dy = -radius; dy <= radius; dy++)
		for (let dx = -radius; dx <= radius; dx++)
			if (burning.get(ctx.cellAt(x + dx, y + dy)) > 0) return true;
	return false;
}

const chebyshev = (ctx: ReadCtx, a: Slot, b: Slot): number =>
	Math.max(Math.abs(ctx.x(a) - ctx.x(b)), Math.abs(ctx.y(a) - ctx.y(b)));

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

// What fear can see, with absent modules settled once: no diet or edible, no eater is sensed;
// no temperament, flight is sight; no hunger, no creature runs short.
export function senseFear(b: FearBuilder, cfg: FearConfig): FearSense {
	const diet = b.read("diet");
	const edible = b.read("edible");
	const burning = b.read("fire")?.left;
	const temperament = b.read("temperament");
	const satiety = b.read("satiety");
	const wary = b.query(["wary"]);
	const { fleeing } = b.write("wary");
	const danger = b.cells("danger");
	const heat = b.cells("heat");
	const presence = b.cells("presence");
	const reach = fireReach(cfg);
	const eater =
		diet && edible ? { eats: diet.eats, kind: edible.class } : undefined;
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
	const flightDistance = (actor: Slot): number => {
		let flight = traitFlight(actor);
		if (starving(actor)) flight--;
		if ((fleeing[actor] ?? 0) !== 0) flight++;
		return Math.min(PERCEPTION_RADIUS, Math.max(cfg.flightMin, flight));
	};

	// The same answer as the eater scan, without reading the grid: no eater in reach.
	const hunted = eater
		? (ctx: ReadCtx, actor: Slot): boolean =>
				(danger.eats.read(ctx).get(ctx.cellOf(actor)) &
					eater.kind.get(actor)) !==
				0
		: never;
	// Unmarked, no burning cell is within reach: the fire box would find nothing.
	const marked = (ctx: ReadCtx, actor: Slot): boolean =>
		burning !== undefined && heat.reach.read(ctx).get(ctx.cellOf(actor)) !== 0;
	const escapeFrom = (
		ctx: ReadCtx,
		actor: Slot,
		fire: CellReader<"u8"> | undefined,
	): Cell =>
		fleeCell(
			ctx,
			actor,
			eater?.eats,
			presence.near.read(ctx),
			eater ? eater.kind.get(actor) : 0,
			fire,
			reach,
		);
	const nearestTo = (ctx: ReadCtx, actor: Slot, radius: number): Slot =>
		eater
			? nearestEater(
					ctx,
					actor,
					eater.eats,
					presence.near.read(ctx),
					eater.kind.get(actor),
					radius,
				)
			: NONE;

	return {
		wary: (actor) => wary.has(actor),
		fill(ctx, actor, s) {
			const isHunted = hunted(ctx, actor);
			if (!isHunted && !marked(ctx, actor)) return false;
			const fire = burning?.read(ctx);
			const heated = fire !== undefined && nearFire(ctx, actor, fire, reach);
			if (!isHunted && !heated) return false;
			const nearest = isHunted
				? nearestTo(ctx, actor, PERCEPTION_RADIUS)
				: NONE;
			const seen = nearest !== NONE;
			const close =
				seen && chebyshev(ctx, nearest, actor) <= flightDistance(actor);
			s.threat = seen ? ctx.idOf(nearest) : NO_ENTITY;
			s.close = close;
			s.heated = heated;
			s.escape = close || heated ? escapeFrom(ctx, actor, fire) : NO_CELL;
			return true;
		},
		hunted,
		sees: eater
			? (ctx, actor, threat) =>
					sees(ctx, actor, threat, eater.eats, eater.kind.get(actor))
			: never,
		threatNear: (ctx, actor, radius) => nearestTo(ctx, actor, radius) !== NONE,
		heated: (ctx, actor) => {
			const fire = burning?.read(ctx);
			return (
				fire !== undefined &&
				marked(ctx, actor) &&
				nearFire(ctx, actor, fire, reach)
			);
		},
		escape: (ctx, actor) =>
			escapeFrom(
				ctx,
				actor,
				marked(ctx, actor) ? burning?.read(ctx) : undefined,
			),
		flightDistance,
		starving,
		markFleeing: (actor) => {
			fleeing[actor] = 1;
		},
	};
}
