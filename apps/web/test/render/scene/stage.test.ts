import { expect, test } from "bun:test";
import type { Entity, Look, Snapshot } from "@korr/protocol";
import {
	InstancedMesh,
	Matrix4,
	Mesh,
	type Object3D,
	Vector3,
} from "three/webgpu";
import { stage } from "../../../src/render/scene";
import { deriveView } from "../../../src/view/derive";
import { type Pose, type Poses, sample } from "../../../src/view/sample";
import { snapshot } from "../../snapshot";

type Stage = ReturnType<typeof stage>;

const looks: Record<string, Look> = {
	rat: { stem: "rat", tier: 0 },
	cheese: { stem: "cheese", tier: 0 },
};

function at(player: { x: number; y: number }, entities: Entity[]): Snapshot {
	return { ...snapshot(player, entities), looks };
}

const visible = (root: Object3D) => {
	const found: Object3D[] = [];
	root.traverseVisible((object) => found.push(object));
	return found;
};
const bodies = (view: Stage) =>
	visible(view.scene).filter(
		(object): object is Mesh =>
			object instanceof Mesh && !(object instanceof InstancedMesh),
	);
const tiles = (view: Stage) =>
	visible(view.scene).filter(
		(object): object is InstancedMesh => object instanceof InstancedMesh,
	);
const cellOf = (object: Object3D) => {
	const world = object.getWorldPosition(new Vector3());
	return [world.x, world.z];
};
const byCell = (a: number[], b: number[]) =>
	(a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0);

const pose = (id: number, x: number, y: number, stem = "rat"): Pose => ({
	id,
	look: { stem, tier: 0 },
	x,
	y,
	opacity: 1,
});
const poses = (player: Pose, entities: Pose[] = []): Poses => ({
	width: 8,
	height: 8,
	player: { ...player, look: { stem: "player", tier: 0 } },
	entities,
});

// Entities enter, leave and move every turn, so stale and missing meshes both show up.
const turn = (t: number): Snapshot =>
	at(
		{ x: t % 8, y: (t * 3) % 8 },
		[0, 1, 2, 3, 4]
			.map((k): Entity => {
				const id = 2 + t + k * (t % 3);
				return [id, id % 2 ? "rat" : "cheese", (id * 5 + t) % 8, id % 8];
			})
			.filter(([id], i, all) => all.findIndex(([o]) => o === id) === i),
	);

test("over many turns, the bodies after each settled draw are the live entities plus the player, and departed ones are disposed", () => {
	const view = stage();
	const disposed = new Set<Mesh>();
	const seen = new Set<Mesh>();
	let prev: Snapshot | undefined;
	for (let t = 0; t < 30; t++) {
		const next = turn(t);
		const timeline = deriveView(prev, next);
		for (const progress of [0, 0.5, 1]) {
			view.draw(sample(timeline, progress));
			for (const body of bodies(view))
				if (!seen.has(body)) {
					seen.add(body);
					let parts = 0;
					const both = () => {
						if (++parts === 2) disposed.add(body);
					};
					body.geometry.addEventListener("dispose", both);
					for (const material of [body.material].flat())
						material.addEventListener("dispose", both);
				}
		}
		const live = [
			[next.player.x, next.player.y],
			...next.entities.map(([, , x, y]) => [x, y]),
		];
		expect(bodies(view).map(cellOf).sort(byCell)).toEqual(live.sort(byCell));
		prev = next;
	}
	const kept = new Set(bodies(view));
	for (const body of seen) expect(disposed.has(body)).toBe(!kept.has(body));
});

test("a fading entity's body carries the opacity of its pose", () => {
	const view = stage();
	view.draw(poses(pose(1, 0, 0), [{ ...pose(2, 3, 5), opacity: 0.25 }]));
	const fading = bodies(view).find(
		(body) => cellOf(body).join() === [3, 5].join(),
	);
	const material = [fading?.material].flat()[0];
	expect(material?.opacity).toBe(0.25);
	expect(material?.transparent).toBe(true);
});

test("the floor tiles cover each cell of a non-square floor once, and a new size replaces them", () => {
	const view = stage();
	const cells = (mesh: InstancedMesh) =>
		Array.from({ length: mesh.count }, (_, i) => {
			const matrix = new Matrix4();
			mesh.getMatrixAt(i, matrix);
			const place = new Vector3().setFromMatrixPosition(matrix);
			return [place.x, place.z];
		}).sort(byCell);
	const grid = (width: number, height: number) =>
		Array.from({ length: width * height }, (_, i) => [
			i % width,
			Math.floor(i / width),
		]).sort(byCell);

	view.draw({ ...poses(pose(1, 0, 0)), width: 4, height: 2 });
	const [first] = tiles(view);
	expect(tiles(view).map(cells)).toEqual([grid(4, 2)]);
	view.draw({ ...poses(pose(1, 0, 0)), width: 4, height: 2 });
	expect(tiles(view)).toHaveLength(1);
	expect(tiles(view)[0]).toBe(first);

	let disposed = false;
	first?.geometry.addEventListener("dispose", () => {
		disposed = true;
	});
	view.draw({ ...poses(pose(1, 0, 0)), width: 3, height: 3 });
	expect(tiles(view).map(cells)).toEqual([grid(3, 3)]);
	expect(disposed).toBe(true);
});

const ndc = (view: Stage, cell: number[]) => {
	const body = bodies(view).find((mesh) => cellOf(mesh).join() === cell.join());
	if (!body) throw new Error(`no body at ${cell}`);
	return body.getWorldPosition(new Vector3()).project(view.camera);
};

test("on screen, x + 1 is to the right and y + 1 is below", () => {
	const view = stage();
	view.draw(poses(pose(1, 4, 4), [pose(2, 5, 4), pose(3, 4, 5)]));
	const centre = ndc(view, [4, 4]);
	const right = ndc(view, [5, 4]);
	const below = ndc(view, [4, 5]);

	expect(right.x).toBeGreaterThan(centre.x);
	expect(right.y).toBeCloseTo(centre.y);
	expect(below.y).toBeLessThan(centre.y);
	expect(below.x).toBeCloseTo(centre.x);
});

test("the camera stays centred on the player's sampled pose, with no lag", () => {
	const view = stage();
	view.draw(poses(pose(1, 4, 4)));
	const first = ndc(view, [4, 4]);
	view.draw(poses(pose(1, 6.5, 2)));
	const moved = ndc(view, [6.5, 2]);

	expect(first.x).toBeCloseTo(0);
	expect(moved.x).toBeCloseTo(0);
	expect(moved.y).toBeCloseTo(first.y);
});
