import { expect, test } from "bun:test";
import type { FieldKind } from "../../../src/core/ecs/schema";
import {
	type Cell,
	type CellReader,
	defineModule,
	NO_CELL,
} from "../../../src/core/module/api";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createWorld } from "../../../src/core/world/world";

const KINDS = {
	a: "u8",
	b: "i8",
	c: "u16",
	d: "i16",
	e: "i32",
	f: "entity",
} as const;
type Field = keyof typeof KINDS;
const FIELDS = Object.keys(KINDS) as Field[];
const FLOORS = 3;
const ROUNDS = 4;

const sample = (kind: FieldKind, h: number) => {
	const pick = (lo: number, span: number) => lo + bounded(h, span);
	const v =
		kind === "u8"
			? pick(1, 255)
			: kind === "i8"
				? pick(-128, 256)
				: kind === "u16"
					? pick(1, 65_535)
					: kind === "i16"
						? pick(-32_768, 65_535)
						: (pick(0, 60_000) - 30_000) * 37;
	return v === 0 ? 1 : v;
};

// Every round, each floor gets its own sparse values; `next` from every start, NO_CELL and
// the last cell included, must match a plain scan, through both the reader and the writer.
const mismatches = (width: number, height: number) => {
	const cells = width * height;
	const bad: unknown[] = [];
	let round = 0;
	const fuzzer = defineModule({
		name: "fuzzer",
		schema: {},
		cells: { marks: KINDS },
		config: {},
		setup(b) {
			const marks = b.cells("marks");
			b.tick((ctx) => {
				const floor = (ctx as unknown as { floor: number }).floor;
				FIELDS.forEach((field, f) => {
					const writer = marks[field].write(ctx);
					writer.clear();
					const want: number[] = [];
					for (let c = 0; c < cells; c++) {
						const subject = ((round * FLOORS + floor) * 8 + f) * 4096 + c;
						const h = draw(
							width,
							height,
							PHASE.core,
							0,
							SUBJECT.cell,
							subject,
							0,
						);
						const value = bounded(h, 3) === 0 ? sample(KINDS[field], h) : 0;
						want.push(value);
						if (value !== 0) writer.set(c as Cell, value as never);
					}
					const naive = (start: number) => {
						for (let c = start + 1; c < cells; c++) if (want[c] !== 0) return c;
						return NO_CELL;
					};
					const reader: CellReader<FieldKind> = marks[field].read(ctx);
					for (const walker of [writer, reader])
						for (let start = -1; start < cells; start++) {
							const got = walker.next(start as Cell);
							if (got !== naive(start))
								bad.push({
									field,
									floor,
									round,
									start,
									got,
									want: naive(start),
								});
							if (start >= 0 && walker.get(start as Cell) !== want[start])
								bad.push({
									field,
									floor,
									round,
									start,
									value: walker.get(start as Cell),
								});
						}
				});
				if (floor === FLOORS - 1) round++;
			});
		},
	});
	createWorld({
		seed: 1,
		floors: FLOORS,
		width,
		height,
		modules: [fuzzer],
	}).runRounds(ROUNDS);
	return bad;
};

for (const [width, height] of [
	[5, 3],
	[7, 1],
	[3, 3],
	[2, 5],
	[1, 1],
	[8, 4],
] as const)
	test(`next matches a plain scan on every floor of a ${width}x${height} floor`, () => {
		expect(mismatches(width, height)).toEqual([]);
	});
