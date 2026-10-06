import type { Column } from "../ecs/schema";

// A value survives a round trip through a one-element array of the same kind only if
// it is an integer inside that kind's range.
export function checked<A extends Column>(array: A, name: string): A {
	const probe = array.slice(0, 1);
	const check = (value: number, at: string) => {
		probe[0] = value;
		if (probe[0] !== value)
			throw new Error(
				`audit: ${name}${at} = ${value} does not fit its field kind`,
			);
	};
	const proxy: A = new Proxy(array, {
		get(target, key) {
			if (key === "fill")
				return (value: number, start?: number, end?: number) => {
					check(value, ".fill");
					target.fill(value, start, end);
					return proxy;
				};
			if (key === "set")
				return (source: ArrayLike<number>, offset = 0) => {
					for (let i = 0; i < source.length; i++)
						check(source[i] ?? 0, `[${offset + i}]`);
					target.set(source, offset);
				};
			if (key === "subarray")
				return (start?: number, end?: number) =>
					checked(target.subarray(start, end), name);
			if (key === "copyWithin")
				return () => {
					throw new Error(`audit: ${name}.copyWithin is not allowed`);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(target, key, value) {
			if (typeof key === "string" && !Number.isNaN(Number(key)))
				check(value, `[${key}]`);
			return Reflect.set(target, key, value);
		},
	});
	return proxy;
}
