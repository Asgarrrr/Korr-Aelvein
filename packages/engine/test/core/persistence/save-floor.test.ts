import { expect, test } from "bun:test";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import { HIGH_WATER, INBOX, WORD } from "../../../src/core/persistence/image";
import { readWorld } from "../../../src/core/persistence/save";
import { createWorld, loadWorld } from "../../../src/core/world";
import { exploreConfig } from "../../../src/modules/explore/config";
import { modules } from "../../../src/registry";
import { game, populatedWorld } from "../../fixtures";

// Churn leaves free slots, odd-width sections end mid-word, and moss keeps the floor changing.
const churned = () => {
	const { world } = populatedWorld(2, modules, 40, { popCap: 120 });
	for (let i = 0; i < 10; i++) world.spawn(0, moss, (i * 7) % 32, (i * 5) % 32);
	world.runRounds(130);
	return world;
};

// Restless rats take the stairs both ways, so inboxes fill and high waters wander.
const travelling = () => {
	const world = createWorld({
		seed: 4,
		floors: 3,
		width: 12,
		height: 12,
		...game,
	});
	const restless = {
		...rat,
		components: {
			...rat.components,
			satiety: { value: exploreConfig.restlessBelow - 50 },
		},
	};
	for (let f = 0; f < 3; f++) {
		if (f < 2) world.spawn(f, stairsTo(f + 1, 2, 9), 9, 2);
		if (f > 0) world.spawn(f, stairsTo(f - 1, 9, 2), 2, 9);
		for (let i = 0; i < 9; i++) world.spawn(f, restless, i, (i * 5 + f) % 12);
		world.spawn(f, moss, 6, 6);
	}
	return world;
};
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

test("a floor image is the same bytes as that floor inside a world save", () => {
	const world = travelling();
	let inbox = 0;
	let tails = 0;
	for (let round = 0; round < 60; round++) {
		world.runRounds(1);
		const { images } = readWorld(world.save());
		for (let f = 0; f < 3; f++) {
			const image = world.saveFloor(f);
			expect(image).toEqual(images[f] as Uint8Array);
			const words = new Int32Array(image.buffer, image.byteOffset);
			if ((words[INBOX] ?? 0) > 0) inbox++;
			if ((words[HIGH_WATER] ?? 0) % WORD !== 0) tails++;
		}
	}
	expect(inbox).toBeGreaterThan(0);
	expect(tails).toBeGreaterThan(0);
});

test("a floor saved into a reused buffer is the same image, written in that buffer", () => {
	const world = churned();
	const size = world.saveFloor(0).length;
	const buffer = new Uint8Array(2 * size).fill(0xab);
	for (let round = 0; round < 3; round++) {
		const image = world.saveFloor(0, buffer);
		expect(image.buffer).toBe(buffer.buffer);
		expect(image).toEqual(world.saveFloor(0));
		const reloaded = loadWorld(world.save(), game);
		reloaded.loadFloor(0, image);
		expect(reloaded.hash()).toBe(world.hash());
		world.runRounds(40);
	}
});

test("a buffer too small or off a word boundary gets a fresh image", () => {
	const world = churned();
	const fresh = world.saveFloor(0);
	const small = new Uint8Array(fresh.length - 4);
	const shifted = new Uint8Array(fresh.length + 8).subarray(1);
	for (const buffer of [small, shifted]) {
		const image = world.saveFloor(0, buffer);
		expect(image.buffer).not.toBe(buffer.buffer);
		expect(image).toEqual(fresh);
	}
});
