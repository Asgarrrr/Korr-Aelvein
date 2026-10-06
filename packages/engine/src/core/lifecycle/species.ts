import type { AnyModule } from "../api";
import {
	type Column,
	type FieldKind,
	type Fields,
	type FieldValue,
	fitsColumn,
} from "../ecs/schema";
import { ACTOR } from "../ecs/storage";
import type { Component } from "../engine";
import { type CoreSchema, healthy, I16_MAX } from "../health/vitality";

export interface SpeciesShape {
	readonly actor: boolean;
	readonly components: {
		readonly [component: string]:
			| { readonly [field: string]: number | undefined }
			| undefined;
	};
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

export function compileSpecies(
	species: SpeciesShape,
	components: ReadonlyMap<string, Component>,
	maskWords: number,
	label = "species",
	index = UNNAMED,
): CompiledSpecies {
	const vitality = species.components.vitality;
	if (vitality !== undefined)
		checkHealth(vitality.hp ?? 0, vitality.max ?? 0, label);
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
			columns.push(checkField(component, componentName, field, value, label));
			values.push(value ?? 0);
		}
	}
	return {
		actor: species.actor,
		index,
		link:
			link === undefined
				? undefined
				: Int32Array.of(link.floor ?? 0, link.x ?? 0, link.y ?? 0),
		mask,
		columns,
		values: Int32Array.from(values),
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

export interface Species<M extends readonly AnyModule[]> {
	readonly actor: boolean;
	readonly components: {
		readonly [N in ComponentName<M>]?: {
			readonly [F in FieldName<M, N>]?: FieldValue<
				FieldsOf<SchemaUnion<M>, N>[F] & FieldKind
			>;
		};
	};
}
