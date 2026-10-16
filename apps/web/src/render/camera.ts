import { OrthographicCamera } from "three/webgpu";
import { cameraRig } from "../theme";

export function rig() {
	const camera = new OrthographicCamera();
	camera.near = cameraRig.near;
	camera.far = cameraRig.far;
	const fit = (aspect: number) => {
		const half = cameraRig.cells / 2;
		camera.left = -half * aspect;
		camera.right = half * aspect;
		camera.top = half;
		camera.bottom = -half;
		camera.updateProjectionMatrix();
	};
	return {
		camera,
		fit,
		follow({ x, y }: { x: number; y: number }) {
			camera.position.set(x, cameraRig.height, y + cameraRig.back);
			camera.lookAt(x, 0, y);
			camera.updateMatrixWorld();
		},
	};
}
