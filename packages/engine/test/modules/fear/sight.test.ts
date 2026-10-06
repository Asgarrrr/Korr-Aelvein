import { expect, test } from "bun:test";
import { rat } from "../../../src/content/species/rat";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import {
	type CellReader,
	defineModule,
	NO_CELL,
	NONE,
	PERCEPTION_RADIUS,
} from "../../../src/core/module/api";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { nearestEater } from "../../../src/modules/fear/sight";
import { hunger } from "../../../src/modules/hunger";
import { foodClass } from "../../../src/modules/hunger/config";

const SIDE = 2 * PERCEPTION_RADIUS + 1;
const CENTRE = PERCEPTION_RADIUS;
const SCENES = 200;
const MAX_EATERS = 6;
// Marks every cell: the filter then hides nothing, so only the scan order decides.
const everywhere: CellReader<"u8"> = { get: () => 0xff, next: () => NO_CELL };

// Each full decision, the eater fear picks and the first eater perception lists at the nearest distance.
const picks: [number, number][] = [];
const judge = defineModule({
	name: "judge",
	schema: {},
	config: {},
	setup(b) {
		const diet = b.read("diet");
		const edible = b.read("edible");
		b.propose((ctx, actor, perception) => {
			if (!diet || !edible) return;
			const prey = edible.class.get(actor);
			if (prey === 0) return;
			let first = NONE as number;
			for (let i = 0; i < perception.count && first === NONE; i++)
				if ((diet.eats.get(perception.slot(i)) & prey) !== 0)
					first = perception.slot(i);
			const picked = nearestEater(
				ctx,
				actor,
				diet.eats,
				everywhere,
				prey,
				PERCEPTION_RADIUS,
			);
			picks.push([picked, first]);
		});
	},
});

test("nearestEater picks the eater perception lists first, ties included", () => {
	const eater = {
		actor: false,
		components: { diet: { eats: foodClass.meat } },
	};
	for (let seed = 1; seed <= SCENES; seed++) {
		const engine = createEngine(
			{ seed, floors: 1, width: SIDE, height: SIDE, popCap: 64, events: false },
			[hunger, judge],
		);
		let n = 0;
		const roll = (bound: number) =>
			bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), bound);
		spawn(engine, 0, rat, CENTRE, CENTRE);
		// Several eaters at one distance, some stacked in a cell, plus a few farther away.
		const d = 1 + roll(PERCEPTION_RADIUS);
		const count = 2 + roll(MAX_EATERS - 1);
		for (let i = 0; i < count; i++) {
			const far = i >= count - 1 && d < PERCEPTION_RADIUS;
			const ring = far ? d + 1 : d;
			const side = roll(4);
			const along = roll(2 * ring + 1) - ring;
			const [x, y] =
				side === 0
					? [along, -ring]
					: side === 1
						? [along, ring]
						: side === 2
							? [-ring, along]
							: [ring, along];
			spawn(engine, 0, eater, CENTRE + x, CENTRE + y);
		}
		picks.length = 0;
		engine.runRound();
		expect(picks.length).toBe(1);
		const [picked, first] = picks[0] ?? [NONE, NONE];
		expect({ seed, picked }).toEqual({ seed, picked: first });
		expect(picked).not.toBe(NONE);
	}
});
