import { stems } from "@korr/web/theme";
import { expect, test } from "@playwright/test";
import { drawn, watchPage } from "./probe";
import { snapshotsOf, socketAt, tapWire } from "./wire";

const player = stems.get("player")?.glyph;

test("losing the WebGL context shows the ASCII view and the game goes on (scene loss not handled, view stale or empty)", async ({
	page,
}) => {
	const watched = watchPage(page);
	const sockets = await tapWire(page);
	const canvas = page.locator("#scene");
	const glyphAt = (x: number, y: number) => async () =>
		((await page.locator("#view").textContent()) ?? "").split("\n")[y]?.[x];

	await page.goto("/?webgl");
	await expect(canvas).toHaveAttribute("data-backend", "webgl");
	await drawn(page, 1);
	const socket = socketAt(sockets, 0);
	const [opening] = snapshotsOf(socket);
	if (!opening || !player) throw new Error("no scene to lose");

	const lost = await page.evaluate(() => {
		const extension = document
			.querySelector<HTMLCanvasElement>("#scene")
			?.getContext("webgl2")
			?.getExtension("WEBGL_lose_context");
		extension?.loseContext();
		return extension !== undefined && extension !== null;
	});
	expect(lost).toBe(true);
	await expect(canvas).toBeHidden();
	await expect.poll(glyphAt(opening.player.x, opening.player.y)).toBe(player);

	await page.keyboard.press("ArrowRight");
	await expect.poll(() => socket.messages.length).toBe(2);
	const [, moved] = snapshotsOf(socket);
	expect(socket.commands).toEqual([{ type: "move", dx: 1, dy: 0 }]);
	if (!moved) throw new Error("no second snapshot");
	expect(moved.player).toMatchObject({
		x: opening.player.x + 1,
		y: opening.player.y,
	});
	await expect.poll(glyphAt(moved.player.x, moved.player.y)).toBe(player);
	expect(watched.pageErrors).toEqual([]);
	expect(watched.consoleErrors).toEqual([
		expect.stringContaining("3D scene lost"),
	]);
});
