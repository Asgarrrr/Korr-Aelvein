import type { AnyModule } from "./api";
import type { Component } from "./engine";
import type { Column, Fields, FieldValue } from "./schema";
import { ACTOR } from "./storage";

export interface SpeciesShape {
	readonly actor: boolean;
	readonly components: {
		readonly [component: string]:
			| { readonly [field: string]: number | undefined }
			| undefined;
	};
}

export interface CompiledSpecies {
	readonly actor: boolean;
	readonly mask: Int32Array;
	readonly columns: readonly Column[];
	readonly values: Int32Array;
}

export function compileSpecies(
	species: SpeciesShape,
	components: ReadonlyMap<string, Component>,
	maskWords: number,
): CompiledSpecies {
	const mask = new Int32Array(maskWords);
	if (species.actor) mask[0] = ACTOR;
	const columns: Column[] = [];
	const values: number[] = [];
	for (const name in species.components) {
		// A species may name components of modules this world does not register.
		const component = components.get(name);
		if (!component) continue;
		const { word, bit } = component.bit;
		mask[word] = (mask[word] ?? 0) | bit;
		const fields = species.components[name];
		for (const field in fields) {
			const column = component.columns[field];
			if (!column) throw new Error(`${name} has no field ${field}`);
			const value = fields[field];
			if (!Number.isInteger(value))
				throw new Error(`${name}.${field} is not an integer`);
			columns.push(column);
			values.push(value ?? 0);
		}
	}
	return {
		actor: species.actor,
		mask,
		columns,
		values: Int32Array.from(values),
	};
}

type SchemaUnion<M extends readonly AnyModule[]> = M[number]["schema"];
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
				FieldsOf<SchemaUnion<M>, N>[F]
			>;
		};
	};
}
