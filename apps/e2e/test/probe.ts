import { inflateSync } from "node:zlib";
import { palette } from "@korr/web/theme";
import { expect, type Page } from "@playwright/test";

// Lighting and colour management shift a rendered colour by a few levels.
const TOLERANCE = 8;

export function watchPage(page: Page) {
	const watched = { pageErrors: [] as string[], consoleErrors: [] as string[] };
	page.on("pageerror", (error) => watched.pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") watched.consoleErrors.push(message.text());
	});
	return watched;
}

const framesOf = (page: Page) =>
	page
		.locator("#scene")
		.getAttribute("data-frames")
		.then((frames) => Number(frames ?? 0));

// Under reduced motion each snapshot is drawn once, and nothing else draws.
export async function drawn(page: Page, snapshots: number): Promise<void> {
	await expect.poll(() => framesOf(page)).toBe(snapshots);
}

// A 1x1 PNG holds one row: a filter byte, then the pixel. Every filter type
// leaves the first pixel of the first row as stored.
export async function centreIsClear(page: Page): Promise<boolean> {
	const box = await page.locator("#scene").boundingBox();
	if (!box) throw new Error("the canvas has no box");
	const png = await page.screenshot({
		clip: {
			x: box.x + Math.floor(box.width / 2),
			y: box.y + Math.floor(box.height / 2),
			width: 1,
			height: 1,
		},
	});
	const data: Buffer[] = [];
	for (let at = 8; at < png.length; ) {
		const length = png.readUInt32BE(at);
		if (png.toString("ascii", at + 4, at + 8) === "IDAT")
			data.push(png.subarray(at + 8, at + 8 + length));
		at += length + 12;
	}
	const pixel = [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
	const clear = [
		palette.clear >> 16,
		(palette.clear >> 8) & 0xff,
		palette.clear & 0xff,
	];
	return pixel.every(
		(level, i) => Math.abs(level - (clear[i] ?? 0)) <= TOLERANCE,
	);
}
