import { expect, test } from "bun:test";
import { LOD_PERIODS } from "../../../src/core/config";
import {
	type Cell,
	defineModule,
	type EntityId,
} from "../../../src/core/module/api";
import { createWorld } from "../../../src/core/world/world";
import { idleRounds } from "../../fixtures";

const FLOORS = LOD_PERIODS.length;
const FAR = FLOORS - 1;
const PERIOD = LOD_PERIODS[FAR] ?? 0;
const SIDE = 4;
// With the core's three tags and two components, 27 tags fill the first mask word: tag28 is in the second.
const TAGS = 29;
const schema: Record<string, Record<string, never>> = {};
for (let i = 0; i < TAGS; i++) schema[`tag${i}`] = {};

let round = 0;
let sounding = -1;
const decided = new Map<EntityId, number[]>();
const siren = defineModule({
	name: "siren",
	schema,
	cells: { siren: { on: "u8" } },
	config: {},
	setup(b) {
		const { on } = b.cells("siren");
		b.alarm(on, ["tag0", "tag28"]);
		b.tick((ctx) => {
			const cells = on.write(ctx);
			cells.clear();
			if (round !== sounding) return;
			for (let c = 0; c < ctx.width * ctx.height; c++) cells.set(c as Cell, 1);
		});
		b.propose((ctx, actor) => {
			const id = ctx.idOf(actor);
			decided.set(id, [...(decided.get(id) ?? []), round]);
		});
	},
});

const body = (...tags: string[]) => ({
	actor: true,
	components: Object.fromEntries(tags.map((t) => [t, {}])),
});

test("an alarm whose requires span two mask words wakes only actors with every component", () => {
	const world = createWorld({
		seed: 1,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		modules: [siren],
	});
	world.spawnPlayer(0, { actor: true, components: {} }, 0, 0);
	const both = world.spawn(FAR, body("tag0", "tag28"), 0, 0);
	const low = world.spawn(FAR, body("tag0"), 1, 0);
	const high = world.spawn(FAR, body("tag28"), 2, 0);
	const ids = [both, low, high];
	sounding =
		[...Array(PERIOD).keys()].find(
			(r) =>
				r > 0 &&
				ids.every((id) =>
					[...Array(r).keys()].every((k) => (k + 1 + id) % PERIOD !== 0),
				),
		) ?? -1;
	expect(sounding).toBeGreaterThan(0);
	for (round = 0; round <= sounding; round++) idleRounds(world, 1);
	expect(decided.get(both)).toEqual([0, sounding]);
	expect(decided.get(low)).toEqual([0]);
	expect(decided.get(high)).toEqual([0]);
});
