import type { FearBuilder } from "./situation";

// The views both the sense and the stamps read, taken once in setup.
export function readFear(b: FearBuilder) {
	return {
		diet: b.read("diet"),
		edible: b.read("edible"),
		burning: b.read("fire")?.left,
		wary: b.query(["wary"]),
		fleeing: b.write("wary").fleeing,
		danger: b.cells("danger"),
		heat: b.cells("heat"),
		presence: b.cells("presence"),
	};
}

export type FearReaders = ReturnType<typeof readFear>;
