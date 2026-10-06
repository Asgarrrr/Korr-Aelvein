import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { BANDS, INERTIA } from "../../../src/core/config";
import { band, checkBands } from "../../../src/core/decision/bands";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import type { AnyModule } from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { modules } from "../../../src/registry";
import { starter } from "../../../src/world/starter";
import {
	forwardBuilder,
	intentReversals,
	intentSwitches,
	seededWorld,
} from "../../fixtures";

type BandName = keyof typeof BANDS;
const TOP: BandName = "reflex";

const bandOf = (score: number) =>
	(Object.keys(BANDS) as BandName[]).find(
		(name) => score >= BANDS[name].min && score <= BANDS[name].max,
	);

const EXPECTED: Record<string, BandName> = {
	"explore/leave": "routine",
	"fear/avoid": "reflex",
	"fear/flee": "reflex",
	"fear/watch": "vigilance",
	"hunger/eat": "urgent",
	"wander/roam": "routine",
};

test("bands are ordered from routine up, with no gap and no overlap", () => {
	expect(BANDS.routine.min).toBe(1);
	expect(BANDS.routine.max + 1).toBe(BANDS.vigilance.min);
	expect(BANDS.vigilance.max + 1).toBe(BANDS.urgent.min);
	expect(BANDS.urgent.max + 1).toBe(BANDS.reflex.min);
});

const WEIGHT_MAX = 255;

test("band maps weight 0 to no candidate and 1..255 monotonically into the band", () => {
	for (const name of Object.keys(BANDS) as BandName[]) {
		const { min, max } = BANDS[name];
		expect(band(name, 0)).toBe(0);
		expect(band(name, 1)).toBe(min);
		expect(band(name, WEIGHT_MAX)).toBe(name === TOP ? max : max - INERTIA);
		for (let w = 2; w <= WEIGHT_MAX; w++)
			expect(band(name, w)).toBeGreaterThanOrEqual(band(name, w - 1));
	}
});

test("below the top band, inertia never lifts a band's highest score out of it", () => {
	for (const name of Object.keys(BANDS) as BandName[])
		if (name !== TOP)
			expect(band(name, WEIGHT_MAX) + INERTIA).toBeLessThanOrEqual(
				BANDS[name].max,
			);
});

test("a band below the top no wider than INERTIA is refused", () => {
	expect(() => checkBands(BANDS, INERTIA)).not.toThrow();
	const narrow = {
		low: { min: 1, max: 1 + INERTIA },
		top: { min: 10, max: 11 },
	};
	expect(() => checkBands(narrow, INERTIA)).toThrow(
		`band low must be wider than INERTIA (${INERTIA})`,
	);
	const top = { low: { min: 1, max: 9 }, top: { min: 10, max: 10 + INERTIA } };
	expect(() => checkBands(top, INERTIA)).not.toThrow();
});

test("band refuses a weight outside 0..255 or not an integer", () => {
	for (const weight of [-1, WEIGHT_MAX + 1, 1.5])
		expect(() => band("vigilance", weight)).toThrow();
});

type Pushes = Map<string, Set<number>>;

// Records every score a module pushes, by action name.
function observed(module: AnyModule, pushes: Pushes): AnyModule {
	const names = new Map<number, string>();
	return {
		...module,
		setup(b, cfg) {
			module.setup(
				{
					...forwardBuilder(b),
					action(name, kind, requires, run) {
						const ref = b.action(name, kind, requires, run);
						names.set(ref.index, `${module.name}/${name}`);
						return ref;
					},
					propose: (run) =>
						b.propose((ctx, actor, perception, out) =>
							run(ctx, actor, perception, {
								push(action, target, score) {
									const name = names.get(action.index) ?? module.name;
									pushes.set(name, (pushes.get(name) ?? new Set()).add(score));
									out.push(action, target, score);
								},
							}),
						),
				},
				cfg,
			);
		},
	};
}

test("on a seeded 300-round world, every game action scores in its own band", () => {
	const pushes: Pushes = new Map();
	seededWorld(modules.map((m) => observed(m, pushes))).runRounds(300);
	expect([...pushes.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
	for (const [name, scores] of pushes) {
		for (const score of scores)
			expect({ name, score, band: bandOf(score) }).toEqual({
				name,
				score,
				band: EXPECTED[name],
			});
		// The top band has nothing above it to cross into.
		const own: BandName = EXPECTED[name] ?? TOP;
		const lifted = Math.max(...scores) + INERTIA;
		if (own !== TOP)
			expect({ name, lifted, within: lifted <= BANDS[own].max }).toEqual({
				name,
				lifted,
				within: true,
			});
	}
});

const measuredOn = (seed: number, measure: typeof intentSwitches) => {
	const engine = createEngine(
		{
			seed,
			floors: 1,
			width: starter.width,
			height: starter.height,
			popCap: 64,
			events: false,
		},
		modules,
		species,
	);
	for (const { species: name, x, y } of starter.layout)
		spawn(engine, 0, species[name], x, y);
	return measure(engine, 100);
};

// Watch adds alert episodes; reversals are guarded separately.
test("intent switches on the seeded starter floor stay at or below today's count", () => {
	expect(measuredOn(1, intentSwitches)).toBeLessThanOrEqual(51);
	expect(measuredOn(2, intentSwitches)).toBeLessThanOrEqual(59);
});

// Oscillation guard: a new decision must not make creatures flip back and forth more.
test("intent reversals on the seeded starter floor stay at or below today's count", () => {
	expect(measuredOn(1, intentReversals)).toBeLessThanOrEqual(13);
	expect(measuredOn(2, intentReversals)).toBeLessThanOrEqual(29);
});
