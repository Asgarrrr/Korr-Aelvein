import { expect, test } from "bun:test";
import type { Component } from "../../../src/core/engine";
import { defineModule } from "../../../src/core/module/api";
import { Checksum } from "../../../src/core/persistence/checksum";
import {
	FLOOR_HEADER,
	FREE_COUNT,
	HIGH_WATER,
	imageChecksum,
	POOL_COUNT,
	SUM,
	sectionCount,
	WORD,
} from "../../../src/core/persistence/image";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world/world";

// Two sparse components, so a pool row can hold a value in one its owner lacks.
const pair = defineModule({
	name: "pair",
	schema: { a: { v: "u8" }, b: { v: "u8" } },
	sparse: ["a", "b"],
	config: {},
	setup() {},
});
const shape = { seed: 1, floors: 1, width: 8, height: 8 };
const engine = createEngine({ ...shape, popCap: 64, events: true }, [pair]);
const component = (name: string) => engine.components.get(name) as Component;

// Slot 0 holds only a, at pool row 0; slot 1 holds a and b, at pool row 1.
const pooled = () => {
	const world = createWorld({ ...shape, modules: [pair] });
	world.spawn(0, { actor: false, components: { a: { v: 1 } } }, 0, 0);
	world.spawn(
		0,
		{ actor: false, components: { a: { v: 2 }, b: { v: 3 } } },
		1,
		0,
	);
	return world;
};

// Edits a saved floor image, given the byte offset of each section, then reseals its checksum.
const edited = (
	edit: (words: Int32Array, at: (array: unknown) => number) => void,
) => {
	const image = pooled().saveFloor(0).slice();
	const words = new Int32Array(image.buffer);
	const at = (array: unknown) => {
		let w = FLOOR_HEADER;
		for (const section of engine.sections) {
			if (section.array === array) return w * WORD;
			const count = sectionCount(
				engine,
				section,
				words[HIGH_WATER] ?? 0,
				words[FREE_COUNT] ?? 0,
				words[POOL_COUNT] ?? 0,
			);
			w += Math.ceil((count * section.unit) / WORD);
		}
		throw new Error("no such section");
	};
	edit(words, at);
	const sum = new Int32Array(2);
	imageChecksum(new Checksum(), words, sum);
	words[SUM] = sum[0] ?? 0;
	words[SUM + 1] = sum[1] ?? 0;
	return image;
};

test("a pool image is refused when rows share a pool row, and by the full check when a pool row breaks the mask", () => {
	const shared = edited((words, at) => {
		new Uint16Array(words.buffer, at(engine.storage.sparse.rowOf), 2)[1] = 1;
	});
	const absent = edited((words, at) => {
		new Uint8Array(words.buffer, at(component("b").columns.v), 2)[0] = 9;
	});
	const unmasked = edited((words, at) => {
		const { word, bit } = component("a").bit;
		const masks = at(engine.storage.masks) / WORD;
		words[masks + word] = (words[masks + word] ?? 0) & ~bit;
	});
	for (const check of ["fast", "full"] as const)
		expect(() => pooled().loadFloor(0, shared, { check }), check).toThrow(
			/shared/,
		);
	const full = [
		[absent, /a sparse component it lacks/],
		[unmasked, /sparse bits false/],
	] as const;
	for (const [image, error] of full) {
		expect(() => pooled().loadFloor(0, image, { check: "full" })).toThrow(
			error,
		);
		expect(() => pooled().loadFloor(0, image, { check: "fast" })).not.toThrow();
	}
	const sound = pooled();
	expect(() => sound.loadFloor(0, sound.saveFloor(0))).not.toThrow();
});
