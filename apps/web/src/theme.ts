// One row per Look stem; the player has no species, so it gets the "player" stem.
export const stems: ReadonlyMap<string, { glyph: string }> = new Map([
	["rat", { glyph: "r" }],
	["stoat", { glyph: "s" }],
	["cheese", { glyph: "%" }],
	["mushroom", { glyph: '"' }],
	["moss", { glyph: "~" }],
	["ember", { glyph: "*" }],
	["stairs", { glyph: ">" }],
	["player", { glyph: "@" }],
]);
export const unknownStem = { glyph: "?" };
export const floorGlyph = ".";

export const connectingText = "connecting…";
export const endTexts = { over: "game over" };
export const noticeTexts = {
	rejected: "command rejected",
	closed: "connection lost",
	fault: "unreadable server message",
};
