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

const I8 = 0x80;
const U8 = 0x100;
const I16 = 0x8000;
const U16 = 0x10000;
const I32 = 0x80000000;

// A typed array wraps what it cannot hold, so a value outside the kind would be stored as another.
// Anything but a column fits nothing.
export function fitsColumn(column: unknown, value: number): boolean {
	if (column instanceof Uint8Array) return value >= 0 && value < U8;
	if (column instanceof Uint16Array) return value >= 0 && value < U16;
	if (column instanceof Int8Array) return value >= -I8 && value < I8;
	if (column instanceof Int16Array) return value >= -I16 && value < I16;
	if (column instanceof Int32Array) return value >= -I32 && value < I32;
	return false;
}

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
