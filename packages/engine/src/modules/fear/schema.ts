export const schema = {
	// fleeing: nonzero from a flee until danger leaves the creature's cell.
	wary: { fleeing: "u8" },
} as const;

export const cells = {
	// danger and spotted sit alone in their tables: b.previous buffers a whole table, so only they are copied.
	danger: { eats: "u8" },
	burns: { near: "u8" },
	// spotted: classes eaten by an eater within alarmRadius at the tick. alarm: the classes that arrived this turn.
	spotted: { eats: "u8" },
	alarm: { eats: "u8" },
	// The classes eaten by an eater within MARGIN of the cell at the tick.
	reach: { near: "u8" },
} as const;
