import type { Object3D } from "three/webgpu";
import type { Pose } from "../view/sample";
import { type Body, body, place } from "./entities";

export function player(parent: Object3D) {
	let mesh: Body | undefined;
	return {
		draw(pose: Pose): void {
			if (!mesh) {
				mesh = body(pose.look);
				parent.add(mesh);
			}
			place(mesh, pose);
		},
	};
}
