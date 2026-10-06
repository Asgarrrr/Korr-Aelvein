import type { Command, Snapshot } from "@korr/protocol";

// The player is a rat: the engine's hunger module lets its forage diet eat only forage-class food.
const edible: ReadonlySet<string> = new Set(["cheese", "mushroom"]);

const commands: ReadonlyMap<string, Command> = new Map<string, Command>([
	["ArrowLeft", { type: "move", dx: -1, dy: 0 }],
	["ArrowRight", { type: "move", dx: 1, dy: 0 }],
	["ArrowUp", { type: "move", dx: 0, dy: -1 }],
	["ArrowDown", { type: "move", dx: 0, dy: 1 }],
	["h", { type: "move", dx: -1, dy: 0 }],
	["l", { type: "move", dx: 1, dy: 0 }],
	["k", { type: "move", dx: 0, dy: -1 }],
	["j", { type: "move", dx: 0, dy: 1 }],
	["y", { type: "move", dx: -1, dy: -1 }],
	["u", { type: "move", dx: 1, dy: -1 }],
	["b", { type: "move", dx: -1, dy: 1 }],
	["n", { type: "move", dx: 1, dy: 1 }],
	[".", { type: "wait" }],
]);

export function commandFor(
	key: string,
	snapshot: Snapshot,
): Command | undefined {
	return key === "e" ? eat(snapshot) : commands.get(key);
}

function eat({ player, entities }: Snapshot): Command | undefined {
	let target: number | undefined;
	for (const [id, species, x, y] of entities) {
		if (!edible.has(species)) continue;
		if (Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > 1) continue;
		if (target === undefined || id < target) target = id;
	}
	return target === undefined ? undefined : { type: "eat", target };
}
