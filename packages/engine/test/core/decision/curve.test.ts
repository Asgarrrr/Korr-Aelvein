import { expect, test } from "bun:test";
import { curve } from "../../../src/core/decision/curve";

test("a curve is flat before its first point and after its last", () => {
	const table = curve([
		[64, 3],
		[192, 1],
	]);
	expect(table.length).toBe(256);
	expect(table.slice(0, 65).every((v) => v === 3)).toBe(true);
	expect(table.slice(192).every((v) => v === 1)).toBe(true);
	// Rounding down on a falling segment: one step past the point already drops a cell.
	expect([table[64], table[65], table[128], table[129]]).toEqual([3, 2, 2, 1]);
});

test("a curve is linear between points and rounds down", () => {
	expect(
		curve([
			[0, 0],
			[3, 2],
		]).slice(0, 4),
	).toEqual([0, 0, 1, 2]);
	expect(
		curve([
			[0, 3],
			[4, 1],
		]).slice(0, 5),
	).toEqual([3, 2, 2, 1, 1]);
	expect(curve([[100, 7]]).every((v) => v === 7)).toBe(true);
});

test("a curve passes through every point", () => {
	const points = [
		[0, 255],
		[10, 0],
		[200, 100],
		[255, 101],
	] as const;
	const table = curve(points);
	for (const [x, y] of points) expect(table[x]).toBe(y);
});

test("a compiled curve cannot be changed", () => {
	expect(Object.isFrozen(curve([[0, 1]]))).toBe(true);
});

test("a curve refuses bad points", () => {
	for (const points of [
		[],
		[
			[10, 1],
			[10, 2],
		],
		[
			[20, 1],
			[10, 2],
		],
		[[256, 1]],
		[[-1, 1]],
		[[0, 256]],
		[[0, -1]],
		[[0.5, 1]],
		[[0, 1.5]],
	] as const)
		expect(() => curve(points)).toThrow();
});
