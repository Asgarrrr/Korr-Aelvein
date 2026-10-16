import type { Entity, Look, ServerMessage, Snapshot } from "@korr/protocol";

// Eat.target's range: an id outside it could never be sent back.
const MAX_ID = 2 ** 31 - 1;

type Fields = { readonly [key: string]: unknown };

const isFields = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown): value is number =>
	Number.isSafeInteger(value);

const isId = (value: unknown): value is number =>
	isInteger(value) && value >= 1 && value <= MAX_ID;

export function decode(text: string): ServerMessage | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isFields(value)) return undefined;
	switch (value.type) {
		case "snapshot":
			return snapshotOf(value);
		case "over":
			return { type: "over" };
		case "rejected":
			return value.reason === "invalid" || value.reason === "over"
				? { type: "rejected", reason: value.reason }
				: undefined;
		default:
			return undefined;
	}
}

function snapshotOf(value: Fields): Snapshot | undefined {
	const { width, height, player, entities, looks } = value;
	if (!isInteger(width) || !isInteger(height)) return undefined;
	if (!isFields(player)) return undefined;
	const { id, x, y, hp, satiety } = player;
	if (!isId(id) || !isInteger(x) || !isInteger(y)) return undefined;
	if (!isInteger(hp) || !isInteger(satiety)) return undefined;
	if (!Array.isArray(entities) || !isFields(looks)) return undefined;
	const decodedEntities: Entity[] = [];
	for (const entity of entities) {
		const decoded = entityOf(entity);
		if (!decoded) return undefined;
		decodedEntities.push(decoded);
	}
	const decodedLooks: [string, Look][] = [];
	for (const [species, look] of Object.entries(looks)) {
		const decoded = lookOf(look);
		if (!decoded) return undefined;
		decodedLooks.push([species, decoded]);
	}
	return {
		type: "snapshot",
		width,
		height,
		player: { id, x, y, hp, satiety },
		entities: decodedEntities,
		// fromEntries defines own properties, so a species named "__proto__" stays an entry.
		looks: Object.fromEntries(decodedLooks),
	};
}

function entityOf(value: unknown): Entity | undefined {
	if (!Array.isArray(value) || value.length !== 4) return undefined;
	const [id, species, x, y]: unknown[] = value;
	if (!isId(id) || typeof species !== "string") return undefined;
	if (!isInteger(x) || !isInteger(y)) return undefined;
	return [id, species, x, y];
}

function lookOf(value: unknown): Look | undefined {
	if (!isFields(value)) return undefined;
	const { stem, tier } = value;
	if (typeof stem !== "string" || !isInteger(tier) || tier < 0)
		return undefined;
	return { stem, tier };
}
