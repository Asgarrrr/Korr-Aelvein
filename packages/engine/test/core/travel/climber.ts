import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/api";
import { createWorld, type World } from "../../../src/core/world";
import { probe } from "../../fixtures";

export const SIDE = 8;
export const TURN = 100;

// Proposes travel through a perceived entity picked by `target`, else marks the turn, while
// still proposing travel through the last stairs it used.
let target: "stairs" | "far" | "food" = "stairs";
export const aimAt = (kind: typeof target) => {
	target = kind;
};
let lastStairs = 0 as EntityId;
export const climber = defineModule({
	name: "climber",
	schema: { climbs: { marks: "u8" } },
	config: {},
	setup(b) {
		const climbs = b.write("climbs");
		const climbers = b.query(["climbs"]);
		const stairs = b.query(["link"]);
		const marked = b.event("marked");
		const mark = b.action("mark", "none", (ctx, actor) => {
			climbs.marks[actor] = (climbs.marks[actor] ?? 0) + 1;
			ctx.emit(marked, ctx.idOf(actor), 0, 0);
			return TURN;
		});
		b.propose((ctx, actor, perception, out) => {
			if (!climbers.has(actor)) return;
			for (let i = 0; i < perception.count; i++) {
				const linked = stairs.has(perception.slot(i));
				if (linked !== (target !== "food")) continue;
				if (target === "far" && perception.dist(i) < 2) continue;
				if (target === "stairs") lastStairs = perception.id(i);
				out.push(ctx.travel, perception.id(i), 5000);
				return;
			}
			if (lastStairs !== 0) out.push(ctx.travel, lastStairs, 100);
			out.push(mark, null, 103);
		});
	},
});

export const climberBody = {
	actor: true,
	components: { climbs: {}, where: {} },
} as const;
export const statue = { actor: true, components: {} } as const;
export const box = { actor: false, components: {} } as const;
export const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

export const twoFloors = (seed = 1) =>
	createWorld({
		seed,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [climber, probe],
	});

export const drain = <M extends readonly AnyModule[]>(
	world: World<M>,
	floor: number,
	name: string,
) => {
	const type = world.eventType(name);
	const seen: { id: number; time: number; b: number }[] = [];
	world.drainEvents(floor, (t, _cause, a, b, time) => {
		if (t === type) seen.push({ id: a, time, b });
	});
	return seen;
};
