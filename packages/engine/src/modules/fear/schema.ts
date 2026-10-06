export const schema = {
	// fleeing: nonzero from a flee until danger leaves the creature's cell.
	wary: { fleeing: "u8" },
} as const;

export const cells = {
	// Alone in its table: b.previous buffers a whole table, so only danger is copied.
	danger: { eats: "u8" },
	burns: { near: "u8" },
	// The classes whose danger first reached the cell this turn.
	alarm: { eats: "u8" },
	// The classes eaten by an eater within MARGIN of the cell at the tick.
	reach: { near: "u8" },
} as const;
