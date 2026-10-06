import { drainEvents, playRound } from "./run";
import { buildReference, FLOORS } from "./world";

// Run alone by reference.ts: one reference world in a fresh process, so RSS counts nothing else.
const ROUNDS = Number(Bun.argv[2] ?? 0);
const SAMPLE_EVERY = 10;
// Long enough for the allocator to hand the builder's garbage back to the OS.
const SETTLE_MS = 3000;

const empty = process.memoryUsage().rss;
const e = buildReference();
// Spawning compiles a species per call: that garbage belongs to the builder, not the world.
Bun.gc(true);
await Bun.sleep(SETTLE_MS);
const built = process.memoryUsage().rss;
let running = built;
for (let r = 0; r < ROUNDS; r++) {
	playRound(e);
	drainEvents(e);
	if (r % SAMPLE_EVERY === 0)
		running = Math.max(running, process.memoryUsage().rss);
}
let rings = 0;
for (let f = 0; f < FLOORS; f++) rings += e.events.bytes(f);
console.log(JSON.stringify({ empty, built, running, rings }));
