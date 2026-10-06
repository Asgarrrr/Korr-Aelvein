import type {
	CellField,
	CellReader,
	CellView,
	CellWriter,
	ReadCtx,
	WriteCtx,
} from "../../api";
import { checked } from "../../audit/checked";
import type { Column, FieldKind } from "../../ecs/schema";
import type { Context } from "../../turns/context";
import { I8Reader, I8Writer, U8Reader, U8Writer } from "./bytes";
import { I16Reader, I16Writer, U16Reader, U16Writer } from "./shorts";
import { I32Reader, I32Writer } from "./words";

type Reader = CellReader<FieldKind>;
type Writer = CellWriter<FieldKind>;

const BYTES_PER_WORD = 4;

// The floor's slice of a column. `audit` names the column when its writes are range-checked.
function kindOf(column: Column): FieldKind {
	if (column instanceof Uint8Array) return "u8";
	if (column instanceof Int8Array) return "i8";
	if (column instanceof Uint16Array) return "u16";
	if (column instanceof Int16Array) return "i16";
	return "i32";
}

function slice(
	column: Column,
	from: number,
	cells: number,
	audit: string | undefined,
): { reader: Reader; writer: Writer } {
	const array = column.subarray(from, from + cells);
	const guarded = audit === undefined ? array : checked(array, audit);
	const words = (perWord: number) =>
		new Uint32Array(array.buffer, array.byteOffset, Math.ceil(cells / perWord));
	switch (kindOf(column)) {
		case "u8": {
			const w = words(BYTES_PER_WORD);
			const reader = new U8Reader(array as Uint8Array, w, cells);
			return { reader, writer: new U8Writer(guarded as Uint8Array, w, cells) };
		}
		case "i8": {
			const w = words(BYTES_PER_WORD);
			const reader = new I8Reader(array as Int8Array, w, cells);
			return { reader, writer: new I8Writer(guarded as Int8Array, w, cells) };
		}
		case "u16": {
			const w = words(BYTES_PER_WORD / 2);
			const reader = new U16Reader(array as Uint16Array, w, cells);
			return {
				reader,
				writer: new U16Writer(guarded as Uint16Array, w, cells),
			};
		}
		case "i16": {
			const w = words(BYTES_PER_WORD / 2);
			const reader = new I16Reader(array as Int16Array, w, cells);
			return { reader, writer: new I16Writer(guarded as Int16Array, w, cells) };
		}
		default: {
			const reader = new I32Reader(array as Int32Array, cells);
			return { reader, writer: new I32Writer(guarded as Int32Array, cells) };
		}
	}
}

function slices(
	column: Column,
	stride: number,
	cells: number,
	audit: string | undefined,
) {
	const floors = column.length / stride;
	return Array.from({ length: floors }, (_, f) =>
		slice(column, f * stride, cells, audit),
	);
}

// Built once per floor, so `read` and `write` allocate nothing; the context names the floor.
class Field implements CellField<FieldKind> {
	readonly #readers: readonly Reader[];
	readonly #writers: readonly Writer[];

	constructor(readers: readonly Reader[], writers: readonly Writer[]) {
		this.#readers = readers;
		this.#writers = writers;
		Object.freeze(this);
	}

	read(ctx: ReadCtx): Reader {
		return this.#readers[(ctx as Context).floor] as Reader;
	}

	write(ctx: WriteCtx): Writer {
		const context = ctx as Context;
		context.checkWritable("cell write");
		return this.#writers[context.floor] as Writer;
	}
}

class View implements CellView<FieldKind> {
	readonly #readers: readonly Reader[];

	constructor(readers: readonly Reader[]) {
		this.#readers = readers;
		Object.freeze(this);
	}

	read(ctx: ReadCtx): Reader {
		return this.#readers[(ctx as Context).floor] as Reader;
	}
}

// The buffer is derived and never saved, so only the tick it was copied for may read it.
class Previous implements CellView<FieldKind> {
	readonly #readers: readonly Reader[];
	readonly #owner: number;

	constructor(readers: readonly Reader[], owner: number) {
		this.#readers = readers;
		this.#owner = owner;
		Object.freeze(this);
	}

	read(ctx: ReadCtx): Reader {
		const context = ctx as Context;
		if (!context.inTickOf(this.#owner))
			throw new Error("a previous buffer is readable only in its owner's tick");
		return this.#readers[context.floor] as Reader;
	}
}

for (const kind of [Field, View, Previous]) Object.freeze(kind.prototype);

export function cellField(
	column: Column,
	stride: number,
	cells: number,
	audit: string | undefined,
): CellField<FieldKind> {
	const parts = slices(column, stride, cells, audit);
	return new Field(
		parts.map((p) => p.reader),
		parts.map((p) => p.writer),
	);
}

export function cellView(
	column: Column,
	stride: number,
	cells: number,
	owner?: number,
): CellView<FieldKind> {
	const readers = slices(column, stride, cells, undefined).map((p) => p.reader);
	return owner === undefined ? new View(readers) : new Previous(readers, owner);
}
