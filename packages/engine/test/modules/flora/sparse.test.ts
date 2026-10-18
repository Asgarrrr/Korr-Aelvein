import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { mushroom } from "../../../src/content/species/mushroom";
import { CAP, SPARSE_CAP } from "../../../src/core/config";
import { defineModule, type EntityId } from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { flora } from "../../../src/modules/flora";
import { floraConfig } from "../../../src/modules/flora/config";
import { hunger } from "../../../src/modules/hunger";

const species = { cheese, moss, mushroom };

const sprout = (period: number, left: number) => ({
	actor: false,
	components: { sprout: { period, left } },
});

test("a floor's full pool refuses a sprout, but not a dense entity or another floor", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 8,
		height: 8,
		popCap: CAP,
		modules: [hunger, flora],
		species,
	});
	for (let i = 0; i < SPARSE_CAP; i++) world.spawn(0, moss, i % 8, 0);
	expect(() => world.spawn(0, moss, 1, 1)).toThrow(
		/floor 0 sparse pool is full/,
	);
	expect(() => world.spawn(0, cheese, 1, 1)).not.toThrow();
	expect(() => world.spawn(1, moss, 1, 1)).not.toThrow();
});

test("a deferred sprout spawn onto a full pool is dropped", () => {
	const breeding = { ...flora, config: { ...floraConfig, yields: "moss" } };
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		popCap: CAP,
		modules: [hunger, breeding],
		species,
	});
	for (let i = 0; i < SPARSE_CAP - 2; i++)
		world.spawn(0, sprout(1000, 1000), i % 8, 0);
	const breeder = world.spawn(0, sprout(1, 1), 3, 3);
	const spawned = world.eventType("core/spawned");
	const births = () => {
		let n = 0;
		world.drainEvents(0, (type, cause) => {
			if (type === spawned && cause === breeder) n++;
		});
		return n;
	};
	births();
	world.runRounds(1);
	expect(births()).toBe(1);
	world.runRounds(1);
	expect(births()).toBe(0);
});

// Kills the doomed and plants a sprout in the same callback: the kill moves the floor's last
// pool row into the freed one before the newborn takes the next.
const reaper = defineModule({
	name: "reaper",
	schema: { doomed: {} },
	config: {},
	setup(b) {
		const doomed = b.query(["doomed"]);
		const late = b.species(sprout(50, 10));
		b.tick((ctx) => {
			const rows = doomed.slots(ctx);
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				ctx.kill(ctx.idOf(s), ctx.idOf(s));
				ctx.spawn(late, ctx.x(s), ctx.y(s), ctx.idOf(s));
			}
		});
	},
});

test("a kill and a spawn in one callback leave every survivor its own sprout row", () => {
	const options = {
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		audit: true,
		modules: [hunger, flora, reaper],
		species,
	};
	const world = createWorld(options);
	world.spawn(
		0,
		{ actor: false, components: { ...sprout(50, 30).components, doomed: {} } },
		0,
		0,
	);
	const b = world.spawn(0, sprout(50, 40), 1, 0);
	const c = world.spawn(0, sprout(50, 50), 2, 0);
	const spawned = world.eventType("core/spawned");
	world.drainEvents(0, () => {});
	const ROUNDS = 5;
	world.runRounds(ROUNDS);
	const born: EntityId[] = [];
	world.drainEvents(0, (type, _cause, a) => {
		if (type === spawned) born.push(a as EntityId);
	});
	const [d = 0 as EntityId] = born;
	expect(born.length).toBe(1);
	const left = (id: EntityId) => world.peek("sprout", "left", id);
	expect([left(b), left(c), left(d)]).toEqual([
		40 - ROUNDS,
		50 - ROUNDS,
		10 - (ROUNDS - 1),
	]);

	const bytes = world.save();
	const loaded = loadWorld(bytes, options);
	expect(loaded.save()).toEqual(bytes);
	world.runRounds(60);
	loaded.runRounds(60);
	expect(loaded.hash()).toBe(world.hash());
});
