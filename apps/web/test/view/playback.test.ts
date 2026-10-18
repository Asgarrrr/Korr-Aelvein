import { expect, test } from "bun:test";
import { frame } from "../../src/view/playback";

test("the clock starts on the first frame and progress clamps at 1", () => {
	const first = frame({ duration: 100, start: undefined }, 1000);
	expect(first.progress).toBe(0);

	expect(frame(first.playback, 1050).progress).toBe(0.5);
	expect(frame(first.playback, 1300).progress).toBe(1);
});

test("a zero duration completes on its first frame instead of dividing by zero", () => {
	expect(frame({ duration: 0, start: undefined }, 1000).progress).toBe(1);
});
