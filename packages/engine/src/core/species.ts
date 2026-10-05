import type { AnyModule } from "./api";
import type { Fields, FieldValue } from "./schema";

export interface SpeciesShape {
	readonly actor: boolean;
	readonly components: {
		readonly [component: string]:
			| { readonly [field: string]: number | undefined }
			| undefined;
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
