import { endTexts } from "@korr/web/theme";
import { expect, test } from "@playwright/test";
import { centreIsClear, drawn, watchPage } from "./probe";
import { snapshotsOf, socketAt, tapWire } from "./wire";

const hudText = (hp: number, satiety: number) =>
	new RegExp(`^hp ${hp}\\s+satiety ${satiety}$`);

test("a game plays through the browser and survives drops of the link", async ({
	page,
}) => {
	const watched = watchPage(page);
	const sockets = await tapWire(page);
	const canvas = page.locator("#scene");
	const hud = page.locator("#hud");
	const endTitle = page.locator("#end-title");

	await test.step("boot: a scene drawn on WebGL, no error, HUD shows the opening snapshot (HUD not wired, scene never drawn)", async () => {
		await page.goto("/?webgl");
		await expect(canvas).toHaveAttribute("data-backend", "webgl");
		await drawn(page, 1);
		const [opening] = snapshotsOf(socketAt(sockets, 0));
		if (!opening) throw new Error("no opening snapshot on the wire");
		await expect(hud).toHaveText(
			hudText(opening.player.hp, opening.player.satiety),
		);
		expect(watched.pageErrors).toEqual([]);
		expect(watched.consoleErrors).toEqual([]);
	});

	await test.step("two turns: one command and one snapshot each, HUD and canvas follow (a lost, doubled or undrawn turn)", async () => {
		await page.keyboard.press(".");
		await drawn(page, 2);
		await page.keyboard.press(".");
		await drawn(page, 3);
		const socket = socketAt(sockets, 0);
		const [opening, , last] = snapshotsOf(socket);
		expect(socket.commands).toEqual([{ type: "wait" }, { type: "wait" }]);
		expect(socket.messages).toHaveLength(3);
		if (!opening || !last) throw new Error("fewer than three snapshots");
		await expect(hud).toHaveText(hudText(last.player.hp, last.player.satiety));
		expect(last.player.satiety).not.toBe(opening.player.satiety);
		expect(await centreIsClear(page)).toBe(false);
		expect(watched.pageErrors).toEqual([]);
		expect(watched.consoleErrors).toEqual([]);
	});

	await test.step("a drop ends on the dropped screen and New game starts a socket (a dead page, no reconnect)", async () => {
		await socketAt(sockets, 0).route.close({ code: 1011 });
		await expect(endTitle).toHaveText(endTexts.dropped);
		await page.getByRole("button", { name: "New game" }).click();
		await expect.poll(() => sockets.length).toBe(2);
		await drawn(page, 1);
	});

	await test.step("Enter on the end screen starts a third socket (the keyboard path missing)", async () => {
		await socketAt(sockets, 1).route.close({ code: 1011 });
		await expect(endTitle).toHaveText(endTexts.dropped);
		// The focused New game button would activate on Enter without a key handler.
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
		await page.keyboard.press("Enter");
		await expect.poll(() => sockets.length).toBe(3);
	});
});
