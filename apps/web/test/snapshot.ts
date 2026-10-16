import type { Entity, Snapshot } from "@korr/protocol";

export function snapshot(
	player: { x: number; y: number },
	entities: Entity[] = [],
): Snapshot {
	return {
		type: "snapshot",
		width: 8,
		height: 8,
		player: { id: 1, ...player, hp: 10, satiety: 800 },
		entities,
		looks: {},
	};
}
