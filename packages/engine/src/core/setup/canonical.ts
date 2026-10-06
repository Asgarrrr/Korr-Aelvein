const isPlain = (value: object) => {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

// Sorted keys, so two equal values always give one string. Data only: integers, strings,
// arrays and plain objects; anything else in config or species is a bug, and throws.
export function canonical(value: unknown, path: string): string {
	if (typeof value === "number") {
		if (!Number.isInteger(value))
			throw new Error(`${path} is ${value}, not an integer`);
		return String(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++)
			if (!(i in value))
				throw new Error(`${path}[${i}] is a hole in a sparse array`);
		return `[${value.map((item, i) => canonical(item, `${path}[${i}]`)).join(",")}]`;
	}
	if (typeof value === "object" && value !== null && isPlain(value)) {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		const parts = keys.map(
			(key) =>
				`${JSON.stringify(key)}:${canonical(record[key], `${path}.${key}`)}`,
		);
		return `{${parts.join(",")}}`;
	}
	throw new Error(`${path} is ${typeof value}, not data`);
}

// The engine keeps its own frozen copy, so the caller's objects stay theirs to change.
export function frozenCopy<T>(value: T): T {
	if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as T;
	if (typeof value === "object" && value !== null && isPlain(value)) {
		const copy: Record<string, unknown> = {};
		// Defined, not assigned: assigning "__proto__" would set the prototype and drop the key.
		for (const [key, item] of Object.entries(value))
			Object.defineProperty(copy, key, {
				value: frozenCopy(item),
				enumerable: true,
			});
		return Object.freeze(copy) as T;
	}
	return value;
}
