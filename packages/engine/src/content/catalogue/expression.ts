import type {
	ComponentName,
	FieldName,
	FieldRange,
} from "../../core/lifecycle/species";
import type { modules } from "../../registry";
import type { GameSpecies } from "../species/types";
import type { Gene } from "./types";

export const GENE_MAX = 255;

type Components = ComponentName<typeof modules>;

export type ExpressionRow = {
	readonly [C in Components]: {
		readonly gene: Gene;
		readonly component: C;
		readonly field: FieldName<typeof modules, C>;
		readonly min: number;
		readonly max: number;
	};
}[Components];

type Fields = Record<string, number | FieldRange | undefined>;

export function express(
	genome: Readonly<Record<Gene, number>>,
	rows: readonly ExpressionRow[],
	body: GameSpecies,
): GameSpecies {
	const components: Record<string, Fields> = {};
	for (const [name, fields] of Object.entries(body.components))
		components[name] = { ...fields };
	for (const { gene, component, field, min, max } of rows) {
		const fields = components[component];
		if (fields === undefined) continue;
		if (typeof fields[field] === "object")
			throw new Error(
				`expression ${gene}->${component}.${field}: the body holds a Range`,
			);
		fields[field] = min + Math.floor((genome[gene] * (max - min)) / GENE_MAX);
	}
	for (const fields of Object.values(components)) Object.freeze(fields);
	return Object.freeze({
		actor: body.actor,
		components: Object.freeze(components),
	}) as GameSpecies;
}
