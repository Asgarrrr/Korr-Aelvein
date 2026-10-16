import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { type OrthographicCamera, WebGPURenderer } from "three/webgpu";
import { createScene } from "../../../src/render/scene";

afterEach(() => {
	mock.restore();
	Reflect.deleteProperty(globalThis, "window");
});

const canvas = () =>
	({
		style: {},
		clientWidth: 8,
		clientHeight: 6,
		setAttribute() {},
		addEventListener() {},
		removeEventListener() {},
		getContext: () => null,
	}) as unknown as HTMLCanvasElement;

const loss = (message: string) => ({
	api: "WebGL" as const,
	message,
	reason: null,
	originalEvent: null,
});

// Stands in for a device: init resolves after `during` runs, and the renderer is kept to report later losses.
function fakeDevice(during: (renderer: WebGPURenderer) => void = () => {}) {
	Object.assign(globalThis, { window: { devicePixelRatio: 1 } });
	const device: { renderer?: WebGPURenderer } = {};
	spyOn(WebGPURenderer.prototype, "init").mockImplementation(function (
		this: WebGPURenderer,
	) {
		device.renderer = this;
		during(this);
		return Promise.resolve(this);
	});
	return device;
}

test("a renderer whose init fails resolves to a failure, not a throw", async () => {
	const result = await createScene(canvas(), {
		forceWebGL: true,
		lost: () => {},
	});
	expect(result).toEqual({ ok: false, detail: expect.any(String) });
});

test("a loss during init resolves to a failure with its cause and never calls lost", async () => {
	fakeDevice((renderer) => {
		renderer.onDeviceLost(loss("gone early"));
		renderer.onDeviceLost(loss("then later"));
	});
	const lost: string[] = [];
	const result = await createScene(canvas(), {
		forceWebGL: true,
		lost: (detail) => lost.push(detail),
	});
	expect(result).toEqual({
		ok: false,
		detail: expect.stringContaining("gone early"),
	});
	expect(result).not.toEqual({
		ok: false,
		detail: expect.stringContaining("later"),
	});
	expect(lost).toEqual([]);
});

test("after init, the first loss calls lost once with its cause", async () => {
	const device = fakeDevice();
	const lost: string[] = [];
	const result = await createScene(canvas(), {
		forceWebGL: true,
		lost: (detail) => lost.push(detail),
	});
	expect(result.ok).toBe(true);

	device.renderer?.onDeviceLost(loss("gone"));
	device.renderer?.onDeviceLost(loss("gone again"));
	expect(lost).toEqual([expect.stringContaining("gone")]);
	expect(lost[0]).not.toContain("again");
});

test("an uncaptured GPU error after init calls lost with its message", async () => {
	const device = fakeDevice();
	const lost: string[] = [];
	await createScene(canvas(), {
		forceWebGL: true,
		lost: (detail) => lost.push(detail),
	});
	const error = { api: "WebGPU", type: "GPUOutOfMemoryError", message: "oom" };
	device.renderer?.onError(error as unknown as string);
	expect(lost).toEqual([expect.stringContaining("oom")]);
});

test("each draw renders through a camera and a buffer fitted to the canvas's current size", async () => {
	fakeDevice();
	const aspects: number[] = [];
	const projected: number[] = [];
	const sizes = spyOn(WebGPURenderer.prototype, "setSize");
	spyOn(WebGPURenderer.prototype, "render").mockImplementation((_, camera) => {
		const { left, right, top, bottom, projectionMatrix } =
			camera as OrthographicCamera;
		aspects.push((right - left) / (top - bottom));
		const e = projectionMatrix.elements;
		projected.push((e[5] ?? 0) / (e[0] ?? 1));
	});
	const surface = canvas();
	const result = await createScene(surface, {
		forceWebGL: true,
		lost: () => {},
	});
	if (!result.ok) throw new Error(result.detail);
	const look = { stem: "player", tier: 0 };
	const player = { id: 1, look, x: 0, y: 0, opacity: 1 };
	const poses = { width: 2, height: 2, player, entities: [] };

	result.scene.draw(poses);
	result.scene.draw(poses);
	Object.assign(surface, { clientWidth: 12 });
	result.scene.draw(poses);
	expect(aspects).toEqual([8 / 6, 8 / 6, 12 / 6]);
	expect(projected).toEqual([8 / 6, 8 / 6, 12 / 6]);
	expect(sizes.mock.calls).toEqual([
		[8, 6, false],
		[12, 6, false],
	]);
});

test("a throw while setting the renderer up resolves to a failure, not a rejection", async () => {
	fakeDevice();
	spyOn(WebGPURenderer.prototype, "setClearColor").mockImplementation(() => {
		throw new Error("setup failed");
	});
	const outcome = await createScene(canvas(), {
		forceWebGL: true,
		lost: () => {},
	}).then(
		(value) => ({ resolved: value }),
		(error) => ({ rejected: String(error) }),
	);
	expect(outcome).toEqual({
		resolved: { ok: false, detail: expect.stringContaining("setup failed") },
	});
});

test("a zero-height canvas never reaches the camera or the renderer", async () => {
	fakeDevice();
	const sizes = spyOn(WebGPURenderer.prototype, "setSize");
	const matrices: number[][] = [];
	spyOn(WebGPURenderer.prototype, "render").mockImplementation((_, camera) => {
		matrices.push([
			...(camera as OrthographicCamera).projectionMatrix.elements,
		]);
	});
	const surface = canvas();
	Object.assign(surface, { clientHeight: 0 });
	const result = await createScene(surface, {
		forceWebGL: true,
		lost: () => {},
	});
	if (!result.ok) throw new Error(result.detail);
	const look = { stem: "player", tier: 0 };
	const player = { id: 1, look, x: 0, y: 0, opacity: 1 };
	const poses = { width: 2, height: 2, player, entities: [] };

	result.scene.draw(poses);
	Object.assign(surface, { clientHeight: 6 });
	result.scene.draw(poses);
	expect(sizes.mock.calls).toEqual([[8, 6, false]]);
	expect(matrices).toHaveLength(1);
	expect(matrices[0]?.every(Number.isFinite)).toBe(true);
});

test("a change of device pixel ratio between draws is applied to the renderer once", async () => {
	fakeDevice();
	const ratios = spyOn(WebGPURenderer.prototype, "setPixelRatio");
	spyOn(WebGPURenderer.prototype, "render").mockImplementation(() => {});
	const result = await createScene(canvas(), {
		forceWebGL: true,
		lost: () => {},
	});
	if (!result.ok) throw new Error(result.detail);
	const look = { stem: "player", tier: 0 };
	const player = { id: 1, look, x: 0, y: 0, opacity: 1 };
	const poses = { width: 2, height: 2, player, entities: [] };

	result.scene.draw(poses);
	Object.assign(window, { devicePixelRatio: 2 });
	result.scene.draw(poses);
	result.scene.draw(poses);
	expect(ratios.mock.calls).toEqual([[1], [2]]);
});
