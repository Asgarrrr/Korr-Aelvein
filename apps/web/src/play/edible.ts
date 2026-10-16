import type { Snapshot } from "@korr/protocol";

// The player is a rat: the engine's hunger module lets its forage diet eat only forage-class food.
const edible: ReadonlySet<string> = new Set(["cheese", "mushroom"]);

export function eatTarget({ player, entities }: Snapshot): number | undefined {
	let target: number | undefined;
	for (const [id, species, x, y] of entities) {
		if (!edible.has(species)) continue;
		if (Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > 1) continue;
		if (target === undefined || id < target) target = id;
	}
	return target;
}
