import { catalogue } from "../../src/content/catalogue";
import { saveWorld } from "../../src/core/persistence/save";
import { loadEngine } from "../../src/core/world/world";
import { modules } from "../../src/registry";
import { drainEvents } from "../reference/run";
import { buildSeason } from "./world";

// Run alone by season.ts: one season world in a fresh process, so RSS counts nothing else.
// Then the checkpoint model of a season jump: the world, its saved image, and the image loaded
// into a second engine, all alive at once.
const [seed, floors, side, rounds] = Bun.argv.slice(2).map(Number);
// Long enough for the allocator to hand the builder's garbage back to the OS.
const SETTLE_MS = 3000;

const settled = async () => {
	Bun.gc(true);
	await Bun.sleep(SETTLE_MS);
	return process.memoryUsage().rss;
};

const empty = process.memoryUsage().rss;
const e = buildSeason(seed ?? 0, floors ?? 0, side ?? 0);
const built = await settled();
for (let r = 0; r < (rounds ?? 0); r++) {
	e.runRound();
	drainEvents(e);
}
const running = await settled();
const image = saveWorld(e);
const saved = await settled();
const second = loadEngine(image, {
	modules,
	species: (s) => catalogue(s).species,
});
const loaded = await settled();
console.log(
	JSON.stringify({
		empty,
		built,
		running,
		saved,
		image: image.length,
		loaded,
		played: e.round,
		restored: second.round,
	}),
);
