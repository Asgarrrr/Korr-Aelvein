export const fearConfig = {
	// Above hunger's highest score: a starving creature still runs first.
	score: 1000,
	fireScore: 900,
	// Burning cells this close are threats to flee.
	fireRadius: 2,
} as const;
