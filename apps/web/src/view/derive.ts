import type { Look, Snapshot } from "@korr/protocol";

export type Spot = { x: number; y: number; opacity: 0 | 1 };
export type Track = { id: number; look: Look; from: Spot; to: Spot };
export type Timeline = {
	width: number;
	height: number;
	player: Track;
	tracks: readonly Track[];
};

// The snapshot's player carries no species.
const playerLook: Look = { stem: "player", tier: 0 };
// A stem with no theme row, so a species the server sent no look for draws as unknown.
const unknownLook: Look = { stem: "", tier: 0 };

const lookOf = (looks: Snapshot["looks"], species: string): Look =>
	(Object.hasOwn(looks, species) ? looks[species] : undefined) ?? unknownLook;

export function deriveView(
	prev: Snapshot | undefined,
	next: Snapshot,
): Timeline {
	const before = new Map(
		prev
			? prev.entities.map(([id, species, x, y]) => [
					id,
					{ look: lookOf(prev.looks, species), x, y },
				])
			: [],
	);
	const tracks: Track[] = [];
	for (const [id, species, x, y] of next.entities) {
		const was = before.get(id);
		const from: Spot = was
			? { x: was.x, y: was.y, opacity: 1 }
			: { x, y, opacity: prev ? 0 : 1 };
		const to: Spot = { x, y, opacity: 1 };
		tracks.push({ id, look: lookOf(next.looks, species), from, to });
		before.delete(id);
	}
	for (const [id, { look, x, y }] of before)
		tracks.push({
			id,
			look,
			from: { x, y, opacity: 1 },
			to: { x, y, opacity: 0 },
		});
	const { id, x, y } = next.player;
	const from = prev ? prev.player : next.player;
	return {
		width: next.width,
		height: next.height,
		player: {
			id,
			look: playerLook,
			from: { x: from.x, y: from.y, opacity: 1 },
			to: { x, y, opacity: 1 },
		},
		tracks,
	};
}
