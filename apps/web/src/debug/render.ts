import type { Look, Snapshot } from "@korr/protocol";
import { floorGlyph, glyphs, playerGlyph, unknownGlyph } from "../theme";

function glyphOf(look: Look | undefined): string {
	const glyph = look === undefined ? undefined : glyphs.get(look.stem);
	if (look === undefined || glyph === undefined) return unknownGlyph;
	return look.tier > 0 ? glyph.toUpperCase() : glyph;
}

export function render({
	width,
	height,
	player,
	entities,
	looks,
}: Snapshot): string {
	const cells = new Array<string>(width * height).fill(floorGlyph);
	for (const [, species, x, y] of entities) {
		if (x < 0 || x >= width || y < 0 || y >= height) continue;
		cells[y * width + x] = glyphOf(looks[species]);
	}
	cells[player.y * width + player.x] = playerGlyph;
	const lines: string[] = [];
	for (let y = 0; y < height; y++)
		lines.push(cells.slice(y * width, (y + 1) * width).join(""));
	lines.push(`hp ${player.hp}  satiety ${player.satiety}`);
	return lines.join("\n");
}
