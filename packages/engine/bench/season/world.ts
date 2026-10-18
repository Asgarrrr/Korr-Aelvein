import { catalogue } from "../../src/content/catalogue";
import type { Engine } from "../../src/core/engine";
import { spawn } from "../../src/core/lifecycle/lifecycle";
import type { AnyModule } from "../../src/core/module/api";
import { bounded, draw, PHASE, SUBJECT } from "../../src/core/random/rng";
import { createEngine } from "../../src/core/setup/registration";
import { modules as gameModules } from "../../src/registry";
import { POP_CAP, RATS, SIDE, STOATS } from "../reference/world";

// The densest floor, per reference floor area: the reference world's creatures, a quarter of
// its rats as herbivore.0, and its items without puddles and embers.
const HERBIVORE_SHARE = 4;
const HERBIVORES = RATS / HERBIVORE_SHARE;
const BASE = {
	rat: RATS - HERBIVORES,
	"herbivore.0": HERBIVORES,
	stoat: STOATS,
	mushroom: 300,
	moss: 400,
	cheese: 1300,
} as const;
const AREA = SIDE * SIDE;

// Stairs down at (x, DOWN) lead to (x + 1, UP) one floor below: the reference layout, in
// sixteenths of the side.
const SIXTEENTHS = 16;
const STAIRS = 5;
const FIRST_STAIR_X = 2;
const STAIR_GAP = 3;
const STAIR_XS = Array.from(
	{ length: STAIRS },
	(_, i) => FIRST_STAIR_X + STAIR_GAP * i,
);
const DOWN = 3;
const UP = 13;

// Floor f holds (f + 1) / floors of the densest floor: the season sees thin and crowded floors.
export function buildSeason(
	seed: number,
	floors: number,
	side: number,
	modules: readonly AnyModule[] = gameModules,
): Engine {
	const area = side * side;
	const table = catalogue(seed).species;
	const e = createEngine(
		{
			seed,
			floors,
			width: side,
			height: side,
			popCap: Math.round((POP_CAP * area) / AREA),
			events: true,
		},
		modules,
		table,
	);
	e.events.enabled.fill(0);
	let n = 0;
	const coord = () =>
		bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), side);
	const at = (sixteenths: number) =>
		Math.floor((side * sixteenths) / SIXTEENTHS);
	const way = { link: { floor: 0, x: 0, y: 0 } };
	const stairs = (f: number, x: number, y: number, to: number, toY: number) => {
		way.link.floor = to;
		way.link.x = x + 1;
		way.link.y = toY;
		spawn(e, f, "stairs", x, y, false, way);
	};
	for (let f = 0; f < floors; f++) {
		for (const x of STAIR_XS.map(at)) {
			if (f + 1 < floors) stairs(f, x, at(DOWN), f + 1, at(UP));
			if (f > 0) stairs(f, x, at(UP), f - 1, at(DOWN));
		}
		const taken = new Uint8Array(area);
		for (const [kind, base] of Object.entries(BASE)) {
			const actor = table[kind]?.actor === true;
			const count = Math.round(
				(Math.round((base * area) / AREA) * (f + 1)) / floors,
			);
			for (let i = 0; i < count; i++) {
				let x = coord();
				let y = coord();
				while (actor && taken[y * side + x]) {
					x = coord();
					y = coord();
				}
				if (actor) taken[y * side + x] = 1;
				spawn(e, f, kind, x, y);
			}
		}
	}
	e.events.enabled.fill(1);
	return e;
}
