import { ember } from "../src/content/species/ember";
import { moss } from "../src/content/species/moss";
import { rat } from "../src/content/species/rat";
import type { AnyModule, Builder, ModuleDef, Schema } from "../src/core/api";
import { fear } from "../src/modules/fear";
import { fire } from "../src/modules/fire";
import { modules } from "../src/registry";
import { benchFloor, RATS, SIDE, stats } from "./floor";

const WARMUP = 20;
const ROUNDS = 100;
const FUEL = 2000;
const EMBERS = 8;
const NS_PER_US = 1000;
const US_DECIMALS = 1;

function timed<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
	spent: { ns: number },
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const inner: Builder<S, K> = {
				write: (name) => b.write(name),
				cells: (name) => b.cells(name),
				previous: (name) => b.previous(name),
				read: (name) => b.read(name),
				query: (names) => b.query(names),
				action: (name, kind, run) => b.action(name, kind, run),
				propose: (run) => b.propose(run),
				event: (name) => b.event(name),
				species: (wanted) => b.species(wanted),
				tick: (run) =>
					b.tick((ctx) => {
						const start = Bun.nanoseconds();
						run(ctx);
						spent.ns += Bun.nanoseconds() - start;
					}),
			};
			module.setup(inner, cfg);
		},
	};
}

const fireSpent = { ns: 0 };
const fearSpent = { ns: 0 };
const list = modules.map((m): AnyModule => {
	if (m === fire) return timed(fire, fireSpent);
	return m === fear ? timed(fear, fearSpent) : m;
});
const { world, rats, coord } = benchFloor(
	rat.components.satiety.value,
	undefined,
	list,
);
for (let i = 0; i < FUEL; i++) world.spawn(0, moss, coord(), coord());
for (let i = 0; i < EMBERS; i++) world.spawn(0, ember, coord(), coord());
const died = world.eventType("core/died");
let deaths = 0;
world.runRounds(WARMUP);
const fireSamples: number[] = [];
const fearSamples: number[] = [];
for (let r = 0; r < ROUNDS; r++) {
	fireSpent.ns = 0;
	fearSpent.ns = 0;
	world.runRounds(1);
	fireSamples.push(fireSpent.ns / NS_PER_US);
	fearSamples.push(fearSpent.ns / NS_PER_US);
	world.drainEvents(0, (type) => {
		if (type === died) deaths++;
	});
}
const alive = rats.filter((id) => world.alive(id)).length;
console.log(
	`slice4 fire: 1 floor ${SIDE}x${SIDE}, ${RATS} sated rats, ${FUEL} moss, ${EMBERS} embers, ${ROUNDS} rounds after ${WARMUP} warmup`,
);
for (const [label, samples] of [
	["fire tick", fireSamples],
	["fear tick", fearSamples],
] as const) {
	const { median, p95 } = stats(samples);
	console.log(
		`  ${label}       median ${median.toFixed(US_DECIMALS)} µs   p95 ${p95.toFixed(US_DECIMALS)} µs per floor`,
	);
}
console.log(`  ${deaths} deaths while timed, ${alive} of ${RATS} rats alive`);
console.log(`  checksum ${world.hash()}`);
