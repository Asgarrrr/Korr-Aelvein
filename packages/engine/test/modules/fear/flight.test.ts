import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { PERCEPTION_RADIUS } from "../../../src/core/config";
import { kill, spawn } from "../../../src/core/lifecycle/lifecycle";
import { NONE } from "../../../src/core/module/api";
import { fearConfig } from "../../../src/modules/fear/config";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { temperament } from "../../../src/modules/temperament";
import { BOLD, SHY, scene, still } from "./scene";

const { min, max } = rat.components.temperament.boldness;
const AVERAGE = (min + max) / 2;
const STARVING = fearConfig.riskBelow - 1;
// Groups this far apart see nothing of each other.
const GAP = 2 * PERCEPTION_RADIUS + 2;

test("facing the same stoat, a shy rat flees from distance 3 and a bold one only at 1", () => {
	for (const d of [1, 2, 3]) {
		const { engine, intent, ratAt, stoatAt } = scene(16);
		stoatAt(8, 8);
		const shy = ratAt(8 - d, 8, SHY);
		const bold = ratAt(8 + d, 8, BOLD);
		engine.runRound();
		expect({ d, shy: intent(shy), bold: intent(bold) }).toEqual({
			d,
			shy: "fear/flee",
			bold: d === 1 ? "fear/flee" : "fear/watch",
		});
	}
});

test("flight distance never increases with boldness, from 3 for the shyest to 1 for the boldest", () => {
	const groups = BOLD + 1;
	const row = 16;
	const { engine, intent, ratAt, stoatAt } = scene(row * GAP);
	const rats = Array.from({ length: groups }, (_, b) => {
		const x = (b % row) * GAP + PERCEPTION_RADIUS;
		const y = Math.floor(b / row) * GAP + PERCEPTION_RADIUS;
		stoatAt(x, y);
		return [ratAt(x - 1, y, b), ratAt(x, y - 2, b), ratAt(x + 3, y, b)];
	});
	engine.runRound();
	const flight = rats.map(
		(ids) => ids.filter((id) => intent(id) === "fear/flee").length,
	);
	// A rat flees at every distance up to its flight distance, and watches beyond.
	for (const [b, ids] of rats.entries())
		for (const [i, id] of ids.entries())
			expect({ b, i, action: intent(id) }).toEqual({
				b,
				i,
				action: i < (flight[b] ?? 0) ? "fear/flee" : "fear/watch",
			});
	expect(flight[SHY]).toBe(PERCEPTION_RADIUS);
	expect(flight[BOLD]).toBe(fearConfig.flightMin);
	for (let b = 1; b < groups; b++)
		expect(flight[b]).toBeLessThanOrEqual(flight[b - 1] ?? 0);
});

test("200 rats drawn from species defaults, each 3 cells from a stoat, both flee and watch", () => {
	const count = 200;
	const row = 20;
	const { engine, intent, ratAt, stoatAt } = scene(row * GAP);
	const rats = Array.from({ length: count }, (_, i) => {
		const x = (i % row) * GAP;
		const y = Math.floor(i / row) * GAP;
		stoatAt(x + PERCEPTION_RADIUS, y);
		return ratAt(x, y);
	});
	engine.runRound();
	const outcomes = new Set(rats.map(intent));
	expect([...outcomes].sort()).toEqual(["fear/flee", "fear/watch"]);
});

test("a starving bold rat keeps eating 2 cells from a stoat", () => {
	const { engine, ratAt, stoatAt } = scene(16);
	ratAt(8, 8, BOLD, STARVING);
	const food = spawn(engine, 0, cheese, 8, 9);
	stoatAt(10, 8);
	engine.runRound();
	expect(engine.storage.slotOf(0, food)).toBe(NONE);
});

test("starving takes one cell off flight: an average rat 2 cells from a stoat eats only then", () => {
	const eaten = (satiety: number) => {
		const { engine, ratAt, stoatAt } = scene(16);
		ratAt(8, 8, AVERAGE, satiety);
		const food = spawn(engine, 0, cheese, 8, 9);
		stoatAt(10, 8);
		engine.runRound();
		return engine.storage.slotOf(0, food) === NONE;
	};
	// Hunger's tick runs first: satiety has lost one turn of decay when fear decides.
	const hungry = fearConfig.riskBelow + hungerConfig.decayPerTurn;
	expect([eaten(STARVING), eaten(hungry)]).toEqual([true, false]);
});

test("a rat that fled keeps fleeing one cell farther than a calm one watches", () => {
	const fled = scene(16);
	fled.stoatAt(8, 8);
	const fleeing = fled.ratAt(6, 8, AVERAGE);
	fled.engine.runRound();
	expect(fled.intent(fleeing)).toBe("fear/flee");
	fled.engine.runRound();
	const calm = scene(16);
	calm.stoatAt(8, 8);
	const watching = calm.ratAt(5, 8, AVERAGE);
	calm.engine.runRound();
	expect([fled.intent(fleeing), calm.intent(watching)]).toEqual([
		"fear/flee",
		"fear/watch",
	]);
});

test("a rat calms down once no danger reaches its cell, and watches again from 3", () => {
	const { engine, intent, xOf, ratAt, stoatAt } = scene(16);
	const first = stoatAt(8, 8);
	const id = ratAt(6, 8, AVERAGE);
	engine.runRound();
	expect(intent(id)).toBe("fear/flee");
	kill(engine, 0, first, first);
	engine.runRound();
	stoatAt(xOf(id) + PERCEPTION_RADIUS, 8);
	engine.runRound();
	expect(intent(id)).toBe("fear/watch");
});

test("a rat flees the nearest of two eaters it sees, not the farther one", () => {
	const { engine, intent, target, ratAt, stoatAt } = scene(16);
	const id = ratAt(8, 8, AVERAGE);
	stoatAt(8, 8 + PERCEPTION_RADIUS);
	const near = stoatAt(9, 8);
	engine.runRound();
	expect([intent(id), target(id)]).toEqual(["fear/flee", near]);
});

test("flight never drops below flightMin: a starving bold rat flees at 1, and fleeing keeps it at 1", () => {
	const { engine, intent, xOf, ratAt, stoatAt } = scene(16);
	stoatAt(8, 8);
	const id = ratAt(7, 8, BOLD, STARVING);
	engine.runRound();
	expect([intent(id), xOf(id)]).toEqual(["fear/flee", 6]);
	engine.runRound();
	// Starving, it does not watch either: at two cells it stays put.
	expect(intent(id)).not.toMatch(/^fear\//);
	expect(xOf(id)).toBe(6);
});

test("without temperament, a rat flees a stoat as soon as it sees it", () => {
	const { engine, intent, ratAt, stoatAt } = scene(
		16,
		still.filter((m) => m !== temperament),
	);
	stoatAt(8, 8);
	const id = ratAt(8 - PERCEPTION_RADIUS, 8);
	engine.runRound();
	expect(intent(id)).toBe("fear/flee");
});
