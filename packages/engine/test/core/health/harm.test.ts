import { expect, test } from "bun:test";
import {
	defineModule,
	type EntityId,
	type SpeciesRef,
	type SpeciesShape,
	type WriteCtx,
} from "../../../src/core/api";
import { saveFloor } from "../../../src/core/persistence/image";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world";

const TURN = 100;
const BODY = { actor: false, components: { vitality: { hp: 10, max: 10 } } };
const HUSK = { actor: false, components: {} };

type Plan = (ctx: WriteCtx, ids: readonly EntityId[], husk: SpeciesRef) => void;

const striker = (plan: Plan) => {
	const ids: EntityId[] = [];
	let fired = false;
	const module = defineModule({
		name: "striker",
		schema: {},
		config: {},
		setup(b) {
			const husk = b.species(HUSK);
			b.tick((ctx) => {
				if (fired) return;
				fired = true;
				plan(ctx, ids, husk);
			});
		},
	});
	return { module, ids };
};

const run = (
	plan: Plan,
	bodies: readonly SpeciesShape[] = [BODY, BODY, BODY],
) => {
	const { module, ids } = striker(plan);
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [module],
	});
	bodies.forEach((body, i) => {
		ids.push(world.spawn(0, body, i, 0));
	});
	world.drainEvents(0, () => {});
	world.runRounds(1);
	const died = world.eventType("core/died");
	const spawned = world.eventType("core/spawned");
	const events: [string, number, number][] = [];
	world.drainEvents(0, (type, cause, a) => {
		if (type === died) events.push(["died", a, cause]);
		if (type === spawned) events.push(["spawned", a, cause]);
	});
	return { world, ids, events };
};

const cause = (n: number) => (1000 + n) as EntityId;

test("two harms to one target in one tick sum", () => {
	const { world, ids } = run((ctx, [a]) => {
		ctx.harm(a as EntityId, 3, cause(1));
		ctx.harm(a as EntityId, 4, cause(2));
	});
	expect(world.peek("vitality", "hp", ids[0] as EntityId)).toBe(3);
	expect(world.peek("vitality", "max", ids[0] as EntityId)).toBe(10);
});

test("a lethal harm kills with the lowest cause among the target's harms", () => {
	const { world, ids, events } = run((ctx, [a]) => {
		ctx.harm(a as EntityId, 6, cause(9));
		ctx.harm(a as EntityId, 6, cause(5));
	});
	expect(world.alive(ids[0] as EntityId)).toBe(false);
	expect(events.filter((e) => e[0] === "died")).toEqual([
		["died", ids[0] as number, cause(5)],
	]);
});

test("harm kills apply in target order, whatever the emission order or causes", () => {
	const { ids, events } = run((ctx, [a, b, c]) => {
		ctx.harm(c as EntityId, 10, cause(1));
		ctx.harm(a as EntityId, 10, cause(3));
		ctx.harm(b as EntityId, 10, cause(2));
	});
	expect(events.filter((e) => e[0] === "died").map((e) => e[1])).toEqual(ids);
});

test("after a tick, harm applies before its deferred kills, and kills before spawns", () => {
	const { ids, events } = run((ctx, [a, b], husk) => {
		ctx.spawn(husk, 3, 3, a as EntityId);
		ctx.kill(a as EntityId, a as EntityId);
		ctx.harm(b as EntityId, 10, cause(9));
	});
	const [a = 0, b = 0] = ids;
	expect(events.map((e) => e[0] + e[1])).toEqual([
		`died${b}`,
		`died${a}`,
		`spawned${(ids.at(-1) ?? 0) + 1}`,
	]);
});

test("harm to a target without vitality, or not alive on the floor, is ignored", () => {
	const { world, ids, events } = run(
		(ctx, [body, husk]) => {
			ctx.harm(husk as EntityId, 50, cause(1));
			ctx.harm(((husk as number) + 1) as EntityId, 50, cause(1));
			ctx.harm(body as EntityId, 1, cause(1));
		},
		[BODY, HUSK],
	);
	expect(world.alive(ids[1] as EntityId)).toBe(true);
	expect(world.peek("vitality", "hp", ids[0] as EntityId)).toBe(9);
	expect(events.filter((e) => e[0] === "died")).toEqual([]);
});

for (const amount of [0, -1, 1.5, 2 ** 31])
	test(`a harm of ${amount} throws`, () => {
		expect(() =>
			run((ctx, [a]) => ctx.harm(a as EntityId, amount, cause(1))),
		).toThrow(/harm amount/);
	});

test("harm from propose throws", () => {
	const meddler = defineModule({
		name: "meddler",
		schema: {},
		config: {},
		setup(b) {
			b.propose((ctx, actor) => {
				const writer = ctx as WriteCtx;
				writer.harm(ctx.idOf(actor), 1, ctx.idOf(actor));
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [meddler],
	});
	world.spawn(0, { ...BODY, actor: true }, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/harm is not allowed in propose/);
});

test("an action's harm lands before the next creature acts", () => {
	const acted: EntityId[] = [];
	const brawler = defineModule({
		name: "brawler",
		schema: { fist: {} },
		config: {},
		setup(b) {
			const fists = b.query(["fist"]);
			const swing = b.action("swing", "entity", [], (ctx, actor, target) => {
				acted.push(ctx.idOf(actor));
				if (fists.has(actor)) ctx.harm(target, 10, ctx.idOf(actor));
				return TURN;
			});
			b.propose((ctx, actor, perception, out) => {
				out.push(
					swing,
					perception.count > 0 ? perception.id(0) : ctx.idOf(actor),
					1,
				);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [brawler],
	});
	const fighter = { actor: true, components: { ...BODY.components } };
	const first = world.spawn(
		0,
		{ ...fighter, components: { ...fighter.components, fist: {} } },
		0,
		0,
	);
	const second = world.spawn(0, fighter, 1, 0);
	world.runRounds(1);
	expect(acted).toEqual([first]);
	expect(world.alive(second)).toBe(false);
});

test("a snapshot with harm still pending throws", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 4, height: 4, popCap: 16, events: true },
		[],
	);
	expect(() => saveFloor(engine, 0)).not.toThrow();
	engine.harms.push(1 as EntityId, 2 as EntityId, 3);
	expect(() => saveFloor(engine, 0)).toThrow(/harm/);
});

test("after an action, harm applies before its deferred kills, and kills before spawns", () => {
	const victims: EntityId[] = [];
	const ruin = defineModule({
		name: "ruin",
		schema: {},
		config: {},
		setup(b) {
			const husk = b.species(HUSK);
			const smash = b.action("smash", "none", [], (ctx, actor) => {
				const [a, c] = victims as [EntityId, EntityId];
				ctx.spawn(husk, 3, 3, ctx.idOf(actor));
				ctx.kill(a, a);
				ctx.harm(c, 10, cause(9));
				return TURN;
			});
			b.propose((_ctx, _actor, _p, out) => {
				if (victims.length === 2) out.push(smash, null, 1);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [ruin],
	});
	world.spawn(0, { actor: true, components: {} }, 0, 0);
	victims.push(world.spawn(0, BODY, 1, 0), world.spawn(0, BODY, 2, 0));
	world.drainEvents(0, () => {});
	world.runRounds(1);
	const names = new Map([
		[world.eventType("core/died"), "died"],
		[world.eventType("core/spawned"), "spawned"],
	]);
	const events: string[] = [];
	world.drainEvents(0, (type, _cause, a) => {
		events.push(`${names.get(type)} ${a}`);
	});
	const [a = 0, c = 0] = victims;
	expect(events.slice(0, 3)).toEqual([
		`died ${c}`,
		`died ${a}`,
		`spawned ${c + 1}`,
	]);
});
