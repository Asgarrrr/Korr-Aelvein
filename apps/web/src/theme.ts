export type Shape =
	| "box"
	| "sphere"
	| "cone"
	| "cylinder"
	| "octahedron"
	| "capsule";
type Stem = { glyph: string; shape: Shape; colour: number };

// One row per Look stem; the player has no species, so it gets the "player" stem.
export const stems: ReadonlyMap<string, Stem> = new Map([
	["rat", { glyph: "r", shape: "sphere", colour: 0x8a7a6a }],
	["stoat", { glyph: "s", shape: "cone", colour: 0xb5763a }],
	["cheese", { glyph: "%", shape: "box", colour: 0xe8c547 }],
	["mushroom", { glyph: '"', shape: "cylinder", colour: 0xc4553f }],
	["moss", { glyph: "~", shape: "box", colour: 0x5f8a3a }],
	["ember", { glyph: "*", shape: "octahedron", colour: 0xff6a1a }],
	["stairs", { glyph: ">", shape: "box", colour: 0x6b6f7a }],
	["player", { glyph: "@", shape: "capsule", colour: 0x3f7fd9 }],
]);
export const unknownStem: Stem = {
	glyph: "?",
	shape: "box",
	colour: 0xd23cd2,
};
export const floorGlyph = ".";

export const palette = { clear: 0xd8d4cc, floor: 0x9c968a };
export const rendering = { antialias: true };
export const sizes = { tile: 0.94, body: 0.6 };
// Cells: the frustum height, in world units. Height and back: the camera's offset from the player's cell.
export const cameraRig = {
	cells: 12,
	height: 10,
	back: 7,
	near: 0.1,
	far: 100,
};
export const lights = {
	sky: 0xffffff,
	ground: 0x5a5448,
	hemisphere: 1.6,
	sun: { colour: 0xffffff, intensity: 1.4, x: 3, y: 10, z: 5 },
};

export const connectingText = "connecting…";
export const endTexts = {
	over: "game over",
	unreachable: "server unreachable",
	dropped: "connection lost",
	broken: "the game broke",
};
export const noticeTexts = { rejected: "command rejected" };

export const motion = { turnMs: 120 };
