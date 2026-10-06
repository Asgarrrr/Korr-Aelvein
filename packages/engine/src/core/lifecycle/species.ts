import {
	type Column,
	type FieldKind,
	type Fields,
	type FieldValue,
	fitsColumn,
} from "../ecs/schema";
import { ACTOR } from "../ecs/storage";
import type { Component } from "../engine";
import {
	type CoreSchema,
	coreSchema,
	healthy,
	I16_MAX,
} from "../health/vitality";
import type { AnyModule } from "../module/api";
import { hashName, MAX_BOUND } from "../random/rng";

// Each entity draws its own value at birth, triangular around the middle of [min, max].
export interface FieldRange {
	readonly min: number;
	readonly max: number;
}

// `Range` is never for spawn values: only a species draws from a range.
type ShapeComponents<Range> = {
	readonly [component: string]:
		| { readonly [field: string]: number | Range | undefined }
		| undefined;
};

export interface SpeciesShape {
	readonly actor: boolean;
	readonly components: ShapeComponents<FieldRange>;
}

export type SpawnValues = ShapeComponents<never>;

export interface RangeDraw {
	readonly column: Column;
	readonly min: number;
	readonly max: number;
	readonly ownerKey: number;
	// Keyed by name, not position: adding or moving a field re-rolls no other field.
	readonly fieldKey: number;
}

// The species index of a shape spawned outside the world's species table.
export const UNNAMED = 0;

export interface CompiledSpecies {
	readonly actor: boolean;
	// 1 + the position of its name among the world's sorted species names, or UNNAMED.
	readonly index: number;
	readonly link: Int32Array | undefined;
	readonly mask: Int32Array;
	readonly columns: readonly Column[];
	readonly values: Int32Array;
	readonly ranges: readonly RangeDraw[];
	// Who the species is in its errors: "species rat", "flora species".
	readonly label: string;
}

export function speciesError(label: string, problem: string): Error {
	return new Error(`${label}: ${problem}`);
}

export function checkHealth(hp: number, max: number, label: string): void {
	if (!healthy(hp, max))
		throw speciesError(
			label,
			`vitality hp ${hp}, max ${max}: needs 0 < hp <= max <= ${I16_MAX}`,
		);
}

// An own "__proto__" key, as JSON.parse makes, is data no component or column can hold.
export function checkKey(key: string, label: string): void {
	if (key === "__proto__")
		throw speciesError(label, "__proto__ is not a component or field name");
}

// The one check for a species' fields and a spawn's values. Own fields only: a name from
// Object.prototype must not reach a column write.
export function checkField(
	component: Component,
	componentName: string,
	field: string,
	value: number | undefined,
	label: string,
): Column {
	checkKey(field, label);
	const { columns } = component;
	const column = Object.hasOwn(columns, field) ? columns[field] : undefined;
	if (!column)
		throw speciesError(label, `${componentName} has no field ${field}`);
	if (!Number.isInteger(value))
		throw speciesError(label, `${componentName}.${field} is not an integer`);
	if (!fitsColumn(column, value ?? 0))
		throw speciesError(
			label,
			`${componentName}.${field} ${value} does not fit its kind`,
		);
	return column;
}

function checkRange(
	component: Component,
	componentName: string,
	field: string,
	range: FieldRange,
	label: string,
): RangeDraw {
	const name = `${componentName}.${field}`;
	// A drawn hp or link would escape the health and link checks made on the species.
	if (Object.hasOwn(coreSchema, componentName))
		throw speciesError(label, `${name}: a core field takes no range`);
	const { min, max } = range;
	const column = checkField(component, componentName, field, min, label);
	checkField(component, componentName, field, max, label);
	if (min > max)
		throw speciesError(label, `${name}: min ${min} above max ${max}`);
	if (max - min >= MAX_BOUND)
		throw speciesError(label, `${name}: range wider than ${MAX_BOUND} values`);
	const { ownerKey } = component;
	return { column, min, max, ownerKey, fieldKey: hashName(name) };
}

export function compileSpecies(
	species: SpeciesShape,
	components: ReadonlyMap<string, Component>,
	maskWords: number,
	label = "species",
	index = UNNAMED,
): CompiledSpecies {
	const link = species.components.link;
	// Only what never moves may lead somewhere: a link is checked against the floor it sits on.
	if (link !== undefined && species.actor)
		throw speciesError(
			label,
			"a link on an actor: only non-actors may lead to a floor",
		);
	const mask = new Int32Array(maskWords);
	if (species.actor) mask[0] = ACTOR;
	const columns: Column[] = [];
	const values: number[] = [];
	const ranges: RangeDraw[] = [];
	for (const componentName in species.components) {
		checkKey(componentName, label);
		// A species may name components of modules this world does not register.
		const component = components.get(componentName);
		if (!component) continue;
		const { word, bit } = component.bit;
		mask[word] = (mask[word] ?? 0) | bit;
		const fields = species.components[componentName];
		for (const field in fields) {
			const value = fields[field];
			if (typeof value === "object" && value !== null) {
				ranges.push(checkRange(component, componentName, field, value, label));
				continue;
			}
			columns.push(checkField(component, componentName, field, value, label));
			values.push(value ?? 0);
		}
	}
	// After the fields: a range on a core field has thrown, so these read integers.
	const int = (value: number | FieldRange | undefined) =>
		typeof value === "number" ? value : 0;
	const vitality = species.components.vitality;
	if (vitality !== undefined)
		checkHealth(int(vitality.hp), int(vitality.max), label);
	return {
		actor: species.actor,
		index,
		link:
			link === undefined
				? undefined
				: Int32Array.of(int(link.floor), int(link.x), int(link.y)),
		mask,
		columns,
		values: Int32Array.from(values),
		ranges,
		label,
	};
}

type SchemaUnion<M extends readonly AnyModule[]> =
	| M[number]["schema"]
	| CoreSchema;
type KeysOf<T> = T extends unknown ? keyof T & string : never;
type FieldsOf<T, N extends string> = T extends unknown
	? N extends keyof T
		? T[N] extends Fields
			? T[N]
			: never
		: never
	: never;

export type ComponentName<M extends readonly AnyModule[]> = KeysOf<
	SchemaUnion<M>
>;
export type FieldName<
	M extends readonly AnyModule[],
	N extends string,
> = keyof FieldsOf<SchemaUnion<M>, N> & string;

export interface Species<M extends readonly AnyModule[], Range = FieldRange> {
	readonly actor: boolean;
	readonly components: {
		readonly [N in ComponentName<M>]?: {
			readonly [F in FieldName<M, N>]?:
				| FieldValue<FieldsOf<SchemaUnion<M>, N>[F] & FieldKind>
				| Range;
		};
	};
}

// A spawn's values are integers: only a species draws from a range.
export type SpawnFields<M extends readonly AnyModule[]> = Species<
	M,
	never
>["components"];
