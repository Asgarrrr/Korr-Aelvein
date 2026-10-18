import { expect, test } from "bun:test";
import { outCubic } from "../../src/view/easing";

test("the easing keeps both ends of a turn in place", () => {
	expect(outCubic(0)).toBe(0);
	expect(outCubic(1)).toBe(1);
});

test("the easing decelerates: halfway through the time is 87.5% of the way", () => {
	expect(outCubic(0.5)).toBe(0.875);
});
