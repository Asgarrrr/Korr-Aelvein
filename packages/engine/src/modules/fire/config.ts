export const fireConfig = {
	// An ember refreshes its cell every tick, so any value above zero keeps it burning.
	emberLeft: 2,
	// Out of 100, per round, for fuel beside a burning cell.
	spreadChance: 60,
	damage: 4,
} as const;
