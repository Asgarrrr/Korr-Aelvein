export const hungerConfig = {
	decayPerTurn: 3,
	hungryBelow: 500,
	max: 1000,
	eatCost: 100,
	scoreBase: 100,
	scoreStep: 50,
	scorePerStep: 20,
} as const;

// One bit per class: a diet's `eats` is the union of the classes it eats.
export const foodClass = {
	forage: 1,
	meat: 2,
} as const;
