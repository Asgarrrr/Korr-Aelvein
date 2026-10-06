import type { EntityId } from "./ids";

interface ArrayByKind {
	i8: Int8Array;
	u8: Uint8Array;
	i16: Int16Array;
	u16: Uint16Array;
	i32: Int32Array;
	entity: Int32Array;
}

export type FieldKind = keyof ArrayByKind;
export type Fields = Readonly<Record<string, FieldKind>>;
export type Schema = Readonly<Record<string, Fields>>;
export type Column = ArrayByKind[FieldKind];
export type Columns<F extends Fields> = {
	readonly [K in keyof F]: ArrayByKind[F[K]];
};
export type FieldValue<K extends FieldKind> = K extends "entity"
	? EntityId
	: number;

export function createColumn(kind: FieldKind, length: number): Column {
	switch (kind) {
		case "i8":
			return new Int8Array(length);
		case "u8":
			return new Uint8Array(length);
		case "i16":
			return new Int16Array(length);
		case "u16":
			return new Uint16Array(length);
		case "i32":
		case "entity":
			return new Int32Array(length);
	}
}
