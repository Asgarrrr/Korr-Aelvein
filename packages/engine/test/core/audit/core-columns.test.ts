import { expect, test } from "bun:test";
import { defineModule, type Slot } from "../../../src/core/api";
import type { Engine } from "../../../src/core/engine";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { createEngine } from "../../../src/core/setup/registration";

type Write = (slot: Slot) => void;

const culprit = (write: () => Write | undefined) =>
	defineModule({
		name: "culprit",
		schema: { mark: { n: "u8" } },
		config: {},
		setup(b) {
			const rows = b.query(["mark"]);
			b.tick((ctx) => {
				const list = rows.slots(ctx);
				for (let i = 0; i < list.length; i++) write()?.(list.at(i));
			});
		},
	});

const coreTargets: [string, (e: Engine) => Write][] = [
	[
		"x",
		(e) => (slot) => {
			e.grid.x[slot] = 3;
		},
	],
	[
		"masks",
		(e) => (slot) => {
			e.storage.masks[slot] = 0;
		},
	],
	[
		"ids",
		(e) => (slot) => {
			e.storage.ids[slot] = 99;
		},
	],
	[
		"nextAt",
		(e) => (slot) => {
			e.scheduler.nextAt[slot] = 5000;
		},
	],
	[
		"intent",
		(e) => (slot) => {
			e.intentKey[slot] = 1;
		},
	],
	[
		"cells",
		(e) => () => {
			e.grid.heads[0] = 0;
		},
	],
	[
		"vitality",
		(e) => (slot) => {
			e.vitality.hp[slot] = 1;
		},
	],
];

for (const [name, target] of coreTargets)
	test(`a module writing the core column ${name} throws in audit mode`, () => {
		let write: Write | undefined;
		const engine = createEngine(
			{
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				popCap: 16,
				events: true,
				audit: true,
			},
			[culprit(() => write)],
		);
		write = target(engine);
		spawn(engine, 0, { actor: true, components: { mark: {} } }, 2, 2);
		expect(() => engine.runRound()).toThrow(new RegExp(`culprit.*${name}`));
	});
