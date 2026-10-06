export const schema = {
	// fleeing: nonzero from a flee until danger leaves the creature's cell.
	wary: { fleeing: "u8" },
} as const;

export const cells = {
	// Alone in its table: fear's tick buffers last turn's copy of it and of nothing else.
	danger: { eats: "u8" },
	burns: { near: "u8" },
	alarm: { eats: "u8" },
} as const;
