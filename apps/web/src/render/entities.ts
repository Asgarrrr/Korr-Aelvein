import {
	BoxGeometry,
	type BufferGeometry,
	CapsuleGeometry,
	ConeGeometry,
	CylinderGeometry,
	Mesh,
	MeshLambertNodeMaterial,
	type Object3D,
	OctahedronGeometry,
	SphereGeometry,
} from "three/webgpu";
import { type Shape, sizes, stems, unknownStem } from "../theme";
import type { Pose } from "../view/sample";

export type Body = Mesh<BufferGeometry, MeshLambertNodeMaterial>;

function geometryOf(shape: Shape): BufferGeometry {
	const size = sizes.body;
	const radius = size / 2;
	switch (shape) {
		case "box":
			return new BoxGeometry(size, size, size);
		case "sphere":
			return new SphereGeometry(radius);
		case "cone":
			return new ConeGeometry(radius, size);
		case "cylinder":
			return new CylinderGeometry(radius, radius, size);
		case "octahedron":
			return new OctahedronGeometry(radius);
		case "capsule":
			return new CapsuleGeometry(radius / 2, size - radius);
	}
}

export function body(look: Pose["look"]): Body {
	const { shape, colour } = stems.get(look.stem) ?? unknownStem;
	return new Mesh(
		geometryOf(shape),
		new MeshLambertNodeMaterial({ color: colour, transparent: true }),
	);
}

// Every shape is sizes.body tall and centred on its origin, so this rests it on the floor.
export function place(mesh: Body, { x, y, opacity }: Pose): void {
	mesh.position.set(x, sizes.body / 2, y);
	mesh.material.opacity = opacity;
}

// An entity's species never changes, so its body keeps the shape of its first look.
export function entities(parent: Object3D) {
	const bodies = new Map<number, Body>();
	return {
		draw(poses: readonly Pose[]): void {
			const live = new Set<number>();
			for (const pose of poses) {
				live.add(pose.id);
				let mesh = bodies.get(pose.id);
				if (!mesh) {
					mesh = body(pose.look);
					bodies.set(pose.id, mesh);
					parent.add(mesh);
				}
				place(mesh, pose);
			}
			for (const [id, mesh] of bodies)
				if (!live.has(id)) {
					parent.remove(mesh);
					mesh.geometry.dispose();
					mesh.material.dispose();
					bodies.delete(id);
				}
		},
	};
}
