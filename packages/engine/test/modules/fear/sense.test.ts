import { expect, test } from "bun:test";
import { ember } from "../../../src/content/species/ember";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { type AnyModule, defineModule } from "../../../src/core/module/api";
import { fear } from "../../../src/modules/fear";
import { fire } from "../../../src/modules/fire";
import { schema } from "../../../src/modules/hunger/schema";
import { temperament } from "../../../src/modules/temperament";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { scene } from "./scene";

const SIDE = 16;
const ROUNDS = 30;
// Owns one of hunger's components and nothing else, so fear runs with the other one absent.
const owning = (part: "edible" | "diet"): AnyModule =>
	defineModule({
		name: "food",
		schema: { [part]: schema[part] },
		config: {},
		setup() {},
	});

// The fear intents rats held over a seeded run: two rats beside an ember, two near stoats.
const fearIntents = (list: readonly AnyModule[]) => {
	const { engine, intent, ratAt, stoatAt } = scene(SIDE, list);
	spawn(engine, 0, ember, 4, 4);
	const rats = [ratAt(5, 4), ratAt(4, 5), ratAt(11, 11), ratAt(12, 10)];
	stoatAt(13, 11);
	stoatAt(10, 12);
	const seen = new Set<string>();
	for (let round = 0; round < ROUNDS; round++) {
		engine.runRound();
		for (const id of rats)
			if (intent(id).startsWith("fear/")) seen.add(intent(id));
	}
	return [...seen].sort();
};

test("without diet, or without edible, fear senses no eater and still avoids fire", () => {
	for (const part of ["diet", "edible"] as const) {
		const other = part === "diet" ? "edible" : "diet";
		const list = [owning(other), fire, temperament, fear, wander];
		expect(fearIntents(list)).toEqual(["fear/avoid"]);
	}
});

test("without fire, fear still flees eaters and avoids nothing", () => {
	const intents = fearIntents(modules.filter((m) => m !== fire));
	expect(intents).toContain("fear/flee");
	expect(intents).not.toContain("fear/avoid");
});
