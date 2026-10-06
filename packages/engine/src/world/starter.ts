import { createGame, type SpeciesName, type World } from "../game";

const layout: readonly { species: SpeciesName; x: number; y: number }[] = [
	{ species: "rat", x: 5, y: 3 },
	{ species: "rat", x: 8, y: 4 },
	{ species: "rat", x: 6, y: 11 },
	{ species: "rat", x: 24, y: 4 },
	{ species: "rat", x: 27, y: 11 },
	{ species: "rat", x: 13, y: 13 },
	{ species: "stoat", x: 29, y: 2 },
	{ species: "stoat", x: 2, y: 14 },
	{ species: "cheese", x: 6, y: 5 },
	{ species: "cheese", x: 9, y: 2 },
	{ species: "cheese", x: 7, y: 13 },
	{ species: "cheese", x: 25, y: 6 },
	{ species: "cheese", x: 26, y: 13 },
	{ species: "cheese", x: 14, y: 11 },
	{ species: "moss", x: 4, y: 8 },
	{ species: "moss", x: 28, y: 8 },
	{ species: "mushroom", x: 3, y: 9 },
	{ species: "mushroom", x: 5, y: 7 },
	{ species: "mushroom", x: 27, y: 9 },
	{ species: "mushroom", x: 20, y: 3 },
];

export const starter = Object.freeze({
	width: 32,
	height: 16,
	start: Object.freeze({ x: 16, y: 8 }),
	layout: Object.freeze(layout.map((entry) => Object.freeze(entry))),
});

export function createStarterGame(seed: number): World {
	const world = createGame({
		seed,
		floors: 1,
		width: starter.width,
		height: starter.height,
		events: false,
	});
	for (const { species, x, y } of starter.layout) world.spawn(0, species, x, y);
	return world;
}
