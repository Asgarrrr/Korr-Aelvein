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
import type { FearReaders } from "./readers";
import { nearestEater, sees } from "./sight";
import {
	type FearBuilder,
	type FearConfig,
	fireReach,
	type Situation,
} from "./situation";

export interface FearSense {
	wary(actor: Slot): boolean;
	// False when the actor is neither hunted nor near fire: no fear behaviour applies.
	fill(ctx: ReadCtx, actor: Slot, s: Situation): boolean;
	hunted(ctx: ReadCtx, actor: Slot, here: Cell): boolean;
	sees(ctx: ReadCtx, actor: Slot, threat: EntityId): boolean;
	// Whether an eater of the actor's class stands within `radius`.
	threatNear(ctx: ReadCtx, actor: Slot, radius: number): boolean;
	// The burning cells, where heat marks `here`; else undefined: no fire is within reach.
	fire(ctx: ReadCtx, here: Cell): Fire | undefined;
	// A burning cell of `fire` within the fire's reach.
	heated(ctx: ReadCtx, actor: Slot, fire: Fire | undefined): boolean;
	escape(ctx: ReadCtx, actor: Slot, fire: Fire | undefined): Cell;
	// Within this Chebyshev distance a perceived eater makes the actor flee; beyond it, watch.
	flightDistance(actor: Slot): number;
	starving(actor: Slot): boolean;
	markFleeing(actor: Slot): void;
}

type Fire = CellReader<"u8">;

function nearFire(
	ctx: ReadCtx,
	actor: Slot,
	burning: Fire,
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
export function senseFear(
	b: FearBuilder,
	cfg: FearConfig,
	readers: FearReaders,
): FearSense {
	const { diet, edible, burning, wary, fleeing, danger, heat, presence } =
		readers;
	const temperament = b.read("temperament");
	const satiety = b.read("satiety");
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
		? (ctx: ReadCtx, actor: Slot, here: Cell): boolean =>
				(danger.eats.read(ctx).get(here) & eater.kind.get(actor)) !== 0
		: never;
	// Unmarked, no burning cell is within reach: the fire box would find nothing.
	const fire = (ctx: ReadCtx, here: Cell): Fire | undefined =>
		burning !== undefined && heat.reach.read(ctx).get(here) !== 0
			? burning.read(ctx)
			: undefined;
	const heated = (ctx: ReadCtx, actor: Slot, near: Fire | undefined) =>
		near !== undefined && nearFire(ctx, actor, near, reach);
	const escapeCell = (
		ctx: ReadCtx,
		actor: Slot,
		near: Fire | undefined,
	): Cell =>
		fleeCell(
			ctx,
			actor,
			eater?.eats,
			presence.near.read(ctx),
			eater ? eater.kind.get(actor) : 0,
			near,
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
			const here = ctx.cellOf(actor);
			const isHunted = hunted(ctx, actor, here);
			const near = fire(ctx, here);
			if (!isHunted && near === undefined) return false;
			const isHeated = heated(ctx, actor, near);
			if (!isHunted && !isHeated) return false;
			const nearest = isHunted
				? nearestTo(ctx, actor, PERCEPTION_RADIUS)
				: NONE;
			const seen = nearest !== NONE;
			const close =
				seen && chebyshev(ctx, nearest, actor) <= flightDistance(actor);
			s.threat = seen ? ctx.idOf(nearest) : NO_ENTITY;
			s.close = close;
			s.heated = isHeated;
			s.escape = close || isHeated ? escapeCell(ctx, actor, near) : NO_CELL;
			return true;
		},
		hunted,
		sees: eater
			? (ctx, actor, threat) =>
					sees(ctx, actor, threat, eater.eats, eater.kind.get(actor))
			: never,
		threatNear: (ctx, actor, radius) => nearestTo(ctx, actor, radius) !== NONE,
		fire,
		heated,
		escape: escapeCell,
		flightDistance,
		starving,
		markFleeing: (actor) => {
			fleeing[actor] = 1;
		},
	};
}
