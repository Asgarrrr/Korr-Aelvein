import { expect, test } from "bun:test";
import { SPARSE_CAP, STAIR_TIME } from "../../../src/core/config";
import { NONE } from "../../../src/core/ecs/ids";
import type { Engine } from "../../../src/core/engine";
import { kill, spawn } from "../../../src/core/lifecycle/lifecycle";
import {
	defineModule,
	type EntityId,
	type Slot,
} from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { depart, ingest } from "../../../src/core/travel/travel";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { probe } from "../../fixtures";
import { aimAt, climber, stairsTo } from "./climber";

const kit = defineModule({
	name: "kit",
	schema: { gear: { weight: "u8", charge: "i32" } },
	sparse: ["gear"],
	config: {},
	setup() {},
});

const build = () =>
	createEngine(
		{
			seed: 1,
			floors: 2,
			width: 8,
			height: 8,
			popCap: SPARSE_CAP + 8,
			events: true,
		},
		[kit],
	);

const geared = { actor: true, components: { gear: { weight: 3, charge: 7 } } };
const bare = { actor: true, components: {} };

const gearOf = (e: Engine, slot: Slot) => {
	const row = e.storage.sparse.row(slot);
	const { weight, charge } = e.components.get("gear")?.columns ?? {};
	return [weight?.[row], charge?.[row]];
};

const leave = (e: Engine, id: EntityId) => {
	e.leaveFloor = 1;
	e.leaveX = 4;
	e.leaveY = 4;
	depart(e, 0, e.storage.slotOf(0, id), 0);
};

const land = (e: Engine) => ingest(e, 1, STAIR_TIME, STAIR_TIME + 1);

test("an actor holds a sparse component, with spawn values written at its pool row", () => {
	const e = build();
	const id = spawn(e, 0, geared, 1, 1, false, { gear: { charge: 9 } });
	expect(gearOf(e, e.storage.slotOf(0, id))).toEqual([3, 9]);
});

test("a traveller takes its pool row along: the origin floor frees it, the arrival floor holds the values", () => {
	const e = build();
	const id = spawn(e, 0, geared, 1, 1, false, { gear: { charge: -5 } });
	leave(e, id);
	expect(e.storage.sparse.counts[0]).toBe(0);
	land(e);
	const slot = e.storage.slotOf(1, id);
	expect(e.storage.sparse.counts[1]).toBe(1);
	expect(gearOf(e, slot)).toEqual([3, -5]);
});

test("a traveller without a sparse component arrives without a pool row", () => {
	const e = build();
	const id = spawn(e, 0, bare, 1, 1);
	leave(e, id);
	land(e);
	expect(e.storage.sparse.row(e.storage.slotOf(1, id))).toBe(NONE);
	expect(e.storage.sparse.counts[1]).toBe(0);
});

test("an arrival needing a pool row waits in the inbox while the floor's pool is full, and the entries behind it wait too", () => {
	const e = build();
	const items: EntityId[] = [];
	for (let i = 0; i < SPARSE_CAP; i++)
		items.push(
			spawn(e, 1, { actor: false, components: { gear: { weight: 1 } } }, 0, 0),
		);
	expect(e.storage.sparse.full(1)).toBe(true);
	const first = spawn(e, 0, geared, 1, 1, false, { gear: { charge: 11 } });
	const second = spawn(e, 0, bare, 2, 2);
	leave(e, first);
	leave(e, second);
	land(e);
	expect(e.inbox.count(1)).toBe(2);
	expect(e.storage.slotOf(1, first)).toBe(NONE);
	expect(e.storage.slotOf(1, second)).toBe(NONE);
	kill(e, 1, items[0] as EntityId, 0 as EntityId);
	land(e);
	expect(e.inbox.count(1)).toBe(0);
	expect(gearOf(e, e.storage.slotOf(1, first))).toEqual([3, 11]);
	expect(e.storage.slotOf(1, second)).not.toBe(NONE);
});

test("a traveller saved in transit keeps its sparse values through the load", () => {
	aimAt("stairs");
	const modules = [climber, probe, kit];
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 8,
		height: 8,
		modules,
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	const id = world.spawn(
		0,
		{
			actor: true,
			components: { climbs: {}, where: {}, gear: { weight: 2, charge: -3 } },
		},
		2,
		2,
	);
	world.runRounds(1);
	expect(world.locate(id)).toBe("transit");
	const loaded = loadWorld(world.save(), { modules });
	for (const w of [world, loaded]) {
		w.runRounds(2);
		expect(w.locate(id)).not.toBe("transit");
		expect([
			w.peek("gear", "weight", id),
			w.peek("gear", "charge", id),
		]).toEqual([2, -3]);
	}
	expect(loaded.hash()).toBe(world.hash());
});
