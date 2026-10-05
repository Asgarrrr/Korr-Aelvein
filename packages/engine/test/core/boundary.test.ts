import { expect, test } from "bun:test";
import { rat } from "../../src/content/species/rat";
import {
	type ActionCtx,
	type Builder,
	defineModule,
	type Schema,
	type Slot,
} from "../../src/core/api";
import { Storage } from "../../src/core/ecs/storage";
import { Engine } from "../../src/core/engine";
import { Grid } from "../../src/core/space/grid";
import { createWorld } from "../../src/core/world";
import { hunger } from "../../src/modules/hunger";

const TURN = 100;

const seen = new Map<string, object>();
const refs = new Map<string, { index?: number; key?: number }>();
let builder: Builder<Schema, Schema> | undefined;
const collector = defineModule({
	name: "collector",
	schema: { mark: { n: "u8" } },
	cells: { spot: { v: "u8" } },
	config: {},
	setup(b) {
		builder = b;
		const spot = b.cells("spot");
		seen.set("cell columns", spot);
		seen.set("cell field", spot.v);
		const previous = b.previous("spot");
		seen.set("previous", previous);
		seen.set("previous field", previous.v);
		seen.set("builder", b);
		const rows = b.query(["mark"]);
		seen.set("query", rows);
		seen.set("columns", b.write("mark"));
		const diet = b.read("diet");
		if (diet) {
			seen.set("view", diet);
			seen.set("field view", diet.eats);
		}
		const act = b.action("act", "none", (ctx) => {
			seen.set("action ctx", ctx);
			return TURN;
		});
		refs.set("action", act);
		refs.set("event", b.event("ping"));
		refs.set("species", b.species({ actor: false, components: {} }));
		b.tick((ctx) => {
			seen.set("tick ctx", ctx);
			seen.set("slot list", rows.slots(ctx));
		});
		b.propose((ctx, _actor, perception, out) => {
			seen.set("propose ctx", ctx);
			seen.set("perception", perception);
			seen.set("candidates", out);
			out.push(act, null, 1);
		});
	},
});

const collect = () => {
	seen.clear();
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [hunger, collector],
	});
	world.spawn(0, { ...rat, components: { ...rat.components, mark: {} } }, 0, 0);
	world.runRounds(1);
	return world;
};

const engineState = (value: unknown) =>
	value instanceof Engine ||
	value instanceof Storage ||
	value instanceof Grid ||
	ArrayBuffer.isView(value);

test("nothing handed to a module exposes engine state", () => {
	collect();
	expect([...seen.keys()].sort()).toEqual([
		"action ctx",
		"builder",
		"candidates",
		"cell columns",
		"cell field",
		"columns",
		"field view",
		"perception",
		"previous",
		"previous field",
		"propose ctx",
		"query",
		"slot list",
		"tick ctx",
		"view",
	]);
	for (const [name, object] of seen) {
		if (name === "columns") continue;
		const values = Reflect.ownKeys(object).map(
			(key) => (object as Record<PropertyKey, unknown>)[key],
		);
		const leaks = values.filter(engineState);
		expect({ name, leaks }).toEqual({ name, leaks: [] });
		expect({ name, values: Object.values(object).filter(engineState) }).toEqual(
			{ name, values: [] },
		);
	}
});

test("refs handed to a module cannot be rewritten through a mutable alias", () => {
	collect();
	const ctx = seen.get("propose ctx") as ActionCtx;
	const step: { index: number } = ctx.step;
	const idle: { index: number } = ctx.idle;
	expect(() => {
		step.index = idle.index;
	}).toThrow();
	expect(() => {
		idle.index = 0;
	}).toThrow();
	for (const [name, ref] of refs) {
		const field = name === "event" ? "key" : "index";
		expect(() => {
			ref[field] = 12345;
		}).toThrow();
	}
	expect(refs.size).toBe(3);
});

test("a module cannot change which floor or module its context runs for", () => {
	collect();
	for (const name of ["propose ctx", "action ctx", "tick ctx"]) {
		const ctx = seen.get(name) as { floor?: number; module?: number };
		expect({ name, frozen: Object.isFrozen(ctx) }).toEqual({
			name,
			frozen: true,
		});
		expect(Object.getOwnPropertyDescriptor(ctx, "floor")).toBeUndefined();
		expect(Object.getOwnPropertyDescriptor(ctx, "module")).toBeUndefined();
		expect(() => {
			ctx.floor = 3;
		}).toThrow();
		expect(() => {
			ctx.module = 3;
		}).toThrow();
	}
});

test("module-facing prototypes and views cannot be patched", () => {
	collect();
	for (const [name, object] of seen) {
		if (
			name === "columns" ||
			name === "view" ||
			name === "cell columns" ||
			name === "previous"
		)
			continue;
		const proto = Object.getPrototypeOf(object) as Record<string, unknown>;
		expect({ name, frozen: Object.isFrozen(proto) }).toEqual({
			name,
			frozen: true,
		});
	}
	const field = seen.get("field view") as object;
	expect(() => {
		(Object.getPrototypeOf(field) as Record<string, unknown>).get = () => 7;
	}).toThrow();
	expect(Object.isFrozen(field)).toBe(true);
	expect(Object.isFrozen(seen.get("view"))).toBe(true);
	expect(Object.isFrozen(seen.get("columns"))).toBe(true);
	expect(Object.isFrozen(seen.get("cell columns"))).toBe(true);
	expect(Object.isFrozen(seen.get("cell field"))).toBe(true);
	expect(Object.isFrozen(seen.get("previous"))).toBe(true);
	expect(Object.isFrozen(seen.get("previous field"))).toBe(true);
});

type Write = "kill" | "emit" | "spawn" | "instead";

const writer = (phase: "propose" | "tick", what: Write) =>
	defineModule({
		name: "writer",
		schema: {},
		config: {},
		setup(b) {
			const pet = b.species({ actor: false, components: {} });
			const bang = b.event("bang");
			const write = (ctx: ActionCtx) => {
				const self = ctx.idOf(0 as Slot);
				if (what === "kill") ctx.kill(self, self);
				if (what === "emit") ctx.emit(bang, self, 0, 0);
				if (what === "spawn") ctx.spawn(pet, 0, 0, self);
				if (what === "instead") ctx.instead(ctx.idle, null);
			};
			if (phase === "propose") b.propose((ctx) => write(ctx as ActionCtx));
			else b.tick((ctx) => write(ctx as ActionCtx));
		},
	});

const runWriter = (phase: "propose" | "tick", what: Write) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [writer(phase, what)],
	});
	world.spawn(0, { actor: true, components: {} }, 0, 0);
	world.runRounds(1);
};

for (const what of ["kill", "emit", "spawn", "instead"] as const)
	test(`propose cannot ${what}`, () => {
		expect(() => runWriter("propose", what)).toThrow(
			new RegExp(`${what}.*propose`),
		);
	});

test("a tick cannot call instead", () => {
	expect(() => runWriter("tick", "instead")).toThrow(/instead.*tick/);
});

test("a builder used after setup throws", () => {
	collect();
	const b = builder as Builder<Schema, Schema>;
	expect(() => b.query(["mark"])).toThrow(/after setup/);
	expect(() => b.write("mark")).toThrow(/after setup/);
	expect(() => b.read("diet")).toThrow(/after setup/);
	expect(() => b.previous("spot")).toThrow(/after setup/);
	expect(() => b.tick(() => {})).toThrow(/after setup/);
	expect(() => b.propose(() => {})).toThrow(/after setup/);
	expect(() => b.action("late", "none", () => TURN)).toThrow(/after setup/);
	expect(() => b.event("late")).toThrow(/after setup/);
	expect(() => b.species("rat")).toThrow(/after setup/);
});
