import type { Play } from "../play/types";
import { floorGlyph, stems, unknownStem } from "../theme";

type Look = { stem: string; tier: number };

const playerLook: Look = { stem: "player", tier: 0 };

function glyphOf(look: Look | undefined): string {
	const glyph = (look && stems.get(look.stem)?.glyph) ?? unknownStem.glyph;
	return look !== undefined && look.tier > 0 ? glyph.toUpperCase() : glyph;
}

export function asciiView(element: { textContent: string | null }) {
	return {
		show({ play }: { play: Play }): void {
			if (!play.snapshot) return;
			const { width, height, player, entities, looks } = play.snapshot;
			const cells = new Array<string>(width * height).fill(floorGlyph);
			const place = (x: number, y: number, glyph: string) => {
				if (x >= 0 && x < width && y >= 0 && y < height)
					cells[y * width + x] = glyph;
			};
			for (const [, species, x, y] of entities)
				place(x, y, glyphOf(looks[species]));
			place(player.x, player.y, glyphOf(playerLook));
			const rows: string[] = [];
			for (let y = 0; y < height; y++)
				rows.push(cells.slice(y * width, (y + 1) * width).join(""));
			element.textContent = rows.join("\n");
		},
	};
}
