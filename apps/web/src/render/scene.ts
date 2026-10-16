import {
	DirectionalLight,
	HemisphereLight,
	Scene,
	WebGPURenderer,
} from "three/webgpu";
import { lights, palette, rendering } from "../theme";
import type { Poses } from "../view/sample";
import { rig } from "./camera";
import { entities } from "./entities";
import { floor } from "./floor";
import { player } from "./player";

export function stage() {
	const scene = new Scene();
	const { sun } = lights;
	const light = new DirectionalLight(sun.colour, sun.intensity);
	light.position.set(sun.x, sun.y, sun.z);
	scene.add(
		new HemisphereLight(lights.sky, lights.ground, lights.hemisphere),
		light,
	);
	const tiles = floor(scene);
	const bodies = entities(scene);
	const self = player(scene);
	const eye = rig();
	return {
		scene,
		camera: eye.camera,
		fit: eye.fit,
		draw(poses: Poses): void {
			tiles.draw(poses.width, poses.height);
			bodies.draw(poses.entities);
			self.draw(poses.player);
			eye.follow(poses.player);
		},
	};
}

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// The typings declare a string, but three passes { api, type, message }.
const describe = (info: unknown): string =>
	String((info as { message: unknown }).message);

export async function createScene(
	canvas: HTMLCanvasElement,
	{ forceWebGL, lost }: { forceWebGL: boolean; lost: (detail: string) => void },
): Promise<
	| { ok: true; scene: { show(): void; draw(poses: Poses): void } }
	| { ok: false; detail: string }
> {
	let ready = false;
	let early: string | undefined;
	let reported = false;
	const fail = (detail: string) => {
		if (!ready) early ??= detail;
		else if (!reported) {
			reported = true;
			lost(detail);
		}
	};
	let renderer: WebGPURenderer;
	let view: ReturnType<typeof stage>;
	try {
		renderer = new WebGPURenderer({
			canvas,
			forceWebGL,
			antialias: rendering.antialias,
		});
		renderer.onDeviceLost = (info) =>
			fail(`${info.api} device lost: ${info.message}`);
		renderer.onError = (info: unknown) =>
			fail(`uncaptured GPU error: ${describe(info)}`);
		await renderer.init();
		if (early !== undefined) return { ok: false, detail: early };
		ready = true;
		// The fallback replaces renderer.backend during init(); isWebGPURenderer stays true under it.
		canvas.dataset.backend = (renderer.backend as { isWebGPUBackend?: boolean })
			.isWebGPUBackend
			? "webgpu"
			: "webgl";
		renderer.setClearColor(palette.clear);
		view = stage();
	} catch (error) {
		return { ok: false, detail: messageOf(error) };
	}
	let size = { width: 0, height: 0, ratio: 0 };
	let frames = 0;
	return {
		ok: true,
		scene: {
			show() {},
			draw(poses) {
				const { clientWidth: width, clientHeight: height } = canvas;
				const ratio = window.devicePixelRatio;
				if (width === 0 || height === 0) return;
				if (
					width !== size.width ||
					height !== size.height ||
					ratio !== size.ratio
				) {
					size = { width, height, ratio };
					renderer.setPixelRatio(ratio);
					renderer.setSize(width, height, false);
					view.fit(width / height);
				}
				view.draw(poses);
				renderer.render(view.scene, view.camera);
				canvas.dataset.frames = String(++frames);
			},
		},
	};
}
