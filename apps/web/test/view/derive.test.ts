import { expect, test } from "bun:test";
import type { Entity, Look, Snapshot } from "@korr/protocol";
import { stems } from "../../src/theme";
import { deriveView } from "../../src/view/derive";
import { type Poses, sample } from "../../src/view/sample";
import { snapshot } from "../snapshot";

const known: Record<string, Look> = {
	rat: { stem: "rat", tier: 0 },
	cheese: { stem: "cheese", tier: 0 },
	"stoat.1": { stem: "stoat", tier: 1 },
};

// Like the server: looks carries only the species present in the snapshot.
function at(player: { x: number; y: number }, entities: Entity[]): Snapshot {
	const looks: Record<string, Look> = {};
	for (const [, species] of entities) {
		const look = known[species];
		if (look) looks[species] = look;
	}
	return { ...snapshot(player, entities), looks };
}

// The player's look is checked once against the theme; positions are compared everywhere.
const byId = ({ width, height, player, entities }: Poses) => ({
	width,
	height,
	player: { id: player.id, x: player.x, y: player.y, opacity: player.opacity },
	entities: [...entities].sort((a, b) => a.id - b.id),
});

function knownLook(species: string): Look {
	const look = known[species];
	if (!look) throw new Error(`no look for ${species} in the test table`);
	return look;
}

const rest = (s: Snapshot) => ({
	width: s.width,
	height: s.height,
	player: { id: s.player.id, x: s.player.x, y: s.player.y, opacity: 1 },
	entities: s.entities
		.map(([id, species, x, y]) => ({
			id,
			look: knownLook(species),
			x,
			y,
			opacity: 1,
		}))
		.sort((a, b) => a.id - b.id),
});

test("sampled at 0 the timeline is the previous snapshot at rest, at 1 the next", () => {
	const prev = at({ x: 4, y: 4 }, [
		[2, "rat", 1, 1],
		[3, "cheese", 5, 5],
	]);
	const next = at({ x: 5, y: 4 }, [
		[2, "rat", 2, 1],
		[4, "stoat.1", 6, 6],
	]);
	const timeline = deriveView(prev, next);

	expect(byId(sample(timeline, 0))).toEqual(rest(prev));
	expect(byId(sample(timeline, 1))).toEqual(rest(next));
});

test("reordered entity arrays still pair entities by id", () => {
	const prev = at({ x: 4, y: 4 }, [
		[2, "rat", 1, 1],
		[5, "cheese", 3, 3],
	]);
	const next = at({ x: 4, y: 4 }, [
		[5, "cheese", 3, 4],
		[2, "rat", 1, 2],
	]);

	expect(byId(sample(deriveView(prev, next), 0))).toEqual(rest(prev));
});

test("midway an entity and the player stand halfway between their cells", () => {
	const prev = at({ x: 4, y: 4 }, [[2, "rat", 1, 1]]);
	const next = at({ x: 5, y: 4 }, [[2, "rat", 2, 2]]);
	const poses = sample(deriveView(prev, next), 0.5);

	expect(poses.player).toMatchObject({ x: 4.5, y: 4 });
	expect(poses.entities).toEqual([
		{ id: 2, look: knownLook("rat"), x: 1.5, y: 1.5, opacity: 1 },
	]);
});

test("an outgoing entity fades out in its previous look and is gone at 1", () => {
	const prev = at({ x: 4, y: 4 }, [[3, "stoat.1", 6, 6]]);
	const next = at({ x: 4, y: 4 }, []);
	const timeline = deriveView(prev, next);

	expect(sample(timeline, 0.5).entities).toEqual([
		{ id: 3, look: knownLook("stoat.1"), x: 6, y: 6, opacity: 0.5 },
	]);
	expect(sample(timeline, 1).entities).toEqual([]);
});

test("the first snapshot starts at rest, with a player that has a theme row", () => {
	const first = at({ x: 4, y: 4 }, [[2, "rat", 1, 1]]);
	const timeline = deriveView(undefined, first);

	expect(byId(sample(timeline, 0))).toEqual(rest(first));
	expect(byId(sample(timeline, 1))).toEqual(rest(first));
	expect(stems.has(timeline.player.look.stem)).toBe(true);
});

test("an entity whose species has no look still gets one, without a theme row", () => {
	const poses = sample(
		deriveView(undefined, at({ x: 4, y: 4 }, [[2, "dragon", 1, 1]])),
		1,
	);
	const [dragon] = poses.entities;
	expect(dragon?.look).toBeDefined();
	expect(stems.has(dragon?.look.stem ?? "")).toBe(false);
});
