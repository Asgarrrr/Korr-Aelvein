const INPUT_MAX = 255;
const OUTPUT_MAX = 255;
const TABLE_SIZE = INPUT_MAX + 1;

export type CurvePoint = readonly [input: number, output: number];

const isByte = (v: number, max: number) =>
	Number.isInteger(v) && v >= 0 && v <= max;

// Linear between points, flat before the first and after the last. Rounds toward -infinity, so
// a falling segment drops just past each point: [64, 3] to [192, 1] gives 2 at 65.
export function curve(points: readonly CurvePoint[]): readonly number[] {
	if (points.length === 0) throw new Error("a curve needs at least one point");
	for (let i = 0; i < points.length; i++) {
		const [x, y] = points[i] ?? [0, 0];
		if (!isByte(x, INPUT_MAX) || !isByte(y, OUTPUT_MAX))
			throw new Error(`curve point ${i} [${x}, ${y}] is outside 0..255`);
		if (i > 0 && x <= (points[i - 1]?.[0] ?? 0))
			throw new Error(`curve point ${i}: inputs must strictly increase`);
	}
	const table: number[] = [];
	let p = 0;
	for (let x = 0; x < TABLE_SIZE; x++) {
		while (p + 1 < points.length && x >= (points[p + 1]?.[0] ?? 0)) p++;
		const [x0, y0] = points[p] ?? [0, 0];
		const [x1, y1] = points[p + 1] ?? [x0, y0];
		table.push(
			x <= x0 || x1 === x0
				? y0
				: y0 + Math.floor(((x - x0) * (y1 - y0)) / (x1 - x0)),
		);
	}
	return Object.freeze(table);
}
