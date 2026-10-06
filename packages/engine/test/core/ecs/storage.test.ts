import { expect, test } from "bun:test";
import { defineModule, type EntityId } from "../../../src/core/api";
import { CAP } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world";

const reaper = defineModule({
	name: "reaper",
	schema: { doomed: { fuse: "i16", junk: "i32" } },
	config: {},
	setup(b) {
		const doomed = b.write("doomed");
		const rows = b.query(["doomed"]);
		b.tick((ctx) => {
			const list = rows.slots(ctx);
			const fuse = doomed.fuse;
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				if (fuse[s] !== 0) ctx.kill(ctx.idOf(s), ctx.idOf(s));
			}
		});
	},
});

const victim = {
	actor: false,
	components: { doomed: { fuse: 1, junk: 77 } },
};
const survivor = { actor: false, components: { doomed: {} } };
const body = { actor: true, components: { doomed: {} } };

const newWorld = () =>
	createWorld({ seed: 1, floors: 2, width: 8, height: 8, modules: [reaper] });

test("churn keeps ids monotonic and unique, and killed ids resolve to none", () => {
	const world = newWorld();
	const seen: EntityId[] = [];
	for (let wave = 0; wave < 5; wave++) {
		const waveIds = [];
		for (let i = 0; i < 100; i++)
			waveIds.push(world.spawn(0, victim, i % 8, 0));
		world.runRounds(1);
		for (const id of waveIds) expect(world.alive(id)).toBe(false);
		seen.push(...waveIds);
	}
	for (let i = 1; i < seen.length; i++)
		expect(seen[i] as number).toBeGreaterThan(seen[i - 1] as number);
});

test("a recycled slot starts zeroed", () => {
	const world = newWorld();
	world.spawn(0, victim, 0, 0);
	world.runRounds(1);
	const fresh = world.spawn(0, survivor, 0, 0);
	expect(world.peek("doomed", "junk", fresh)).toBe(0);
});

test("killed slots are reused, and a full floor throws", () => {
	const world = newWorld();
	for (let i = 0; i < CAP; i++) world.spawn(0, victim, 0, 0);
	world.runRounds(1);
	for (let i = 0; i < CAP; i++) world.spawn(0, survivor, 0, 0);
	expect(() => world.spawn(0, survivor, 0, 0)).toThrow(/popCap/);
	expect(() => world.spawn(1, survivor, 0, 0)).not.toThrow();
});

test("a rejected spawn leaves no trace", () => {
	const clean = newWorld();
	clean.spawn(0, survivor, 1, 1);
	const world = newWorld();
	const badField = { actor: false, components: { doomed: { nope: 1 } } };
	expect(() => world.spawn(0, badField as typeof survivor, 1, 1)).toThrow(
		/no field nope/,
	);
	const fraction = { actor: false, components: { doomed: { fuse: 0.5 } } };
	expect(() => world.spawn(0, fraction, 1, 1)).toThrow(/integer/);
	expect(() => world.spawn(0, survivor, 1.5, 1)).toThrow(/integer/);
	expect(() => world.spawn(0, survivor, 8, 1)).toThrow(/outside/);
	world.spawn(0, survivor, 1, 1);
	expect(world.hash()).toBe(clean.hash());
});

test("an actor cannot spawn onto another actor; items can", () => {
	const world = newWorld();
	world.spawn(0, body, 2, 2);
	expect(() => world.spawn(0, body, 2, 2)).toThrow(/holds an actor/);
	expect(() => world.spawn(0, survivor, 2, 2)).not.toThrow();
});
