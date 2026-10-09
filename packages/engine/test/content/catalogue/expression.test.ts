import { expect, test } from "bun:test";
import {
	type ExpressionRow,
	express,
	GENE_MAX,
} from "../../../src/content/catalogue/expression";
import type { GameSpecies } from "../../../src/content/species/types";

const body = {
	actor: true,
	components: {
		vitality: { hp: 10, max: 10 },
		temperament: { boldness: { min: 20, max: 140 } },
	},
} satisfies GameSpecies;

const row = (min: number, max: number): ExpressionRow => ({
	gene: "size",
	component: "vitality",
	field: "max",
	min,
	max,
});

const maxAt = (size: number, rows: readonly ExpressionRow[]) =>
	express({ size }, rows, body).components.vitality?.max;

test("gene 0 expresses the row's min and GENE_MAX its max", () => {
	expect(maxAt(0, [row(6, 40)])).toBe(6);
	expect(maxAt(GENE_MAX, [row(6, 40)])).toBe(40);
});

test("a row with min above max expresses inversely", () => {
	expect(maxAt(0, [row(40, 6)])).toBe(40);
	expect(maxAt(GENE_MAX, [row(40, 6)])).toBe(6);
	for (let size = 1; size <= GENE_MAX; size++)
		expect(maxAt(size, [row(40, 6)])).toBeLessThanOrEqual(
			maxAt(size - 1, [row(40, 6)]) as number,
		);
});

test("a row on a component the body lacks adds nothing", () => {
	const rows: ExpressionRow[] = [
		{ gene: "size", component: "satiety", field: "value", min: 1, max: 9 },
	];
	expect(express({ size: 100 }, rows, body)).toEqual(body);
});

test("a row on a field the body holds as a range throws", () => {
	const rows: ExpressionRow[] = [
		{
			gene: "size",
			component: "temperament",
			field: "boldness",
			min: 0,
			max: 9,
		},
	];
	expect(() => express({ size: 100 }, rows, body)).toThrow(
		"expression size->temperament.boldness: the body holds a Range",
	);
});

test("express returns a new frozen species and leaves the body unchanged", () => {
	const before = structuredClone(body);
	const expressed = express({ size: GENE_MAX }, [row(6, 40)], body);
	expect(body).toEqual(before);
	expect(Object.isFrozen(expressed)).toBe(true);
	expect(expressed.components.vitality).toEqual({ hp: 10, max: 40 });
});
