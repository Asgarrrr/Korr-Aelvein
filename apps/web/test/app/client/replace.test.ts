import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Consumer } from "../../../src/app/client";
import { asciiView } from "../../../src/debug/ascii";
import type { Play } from "../../../src/play/types";
import type { Poses } from "../../../src/view/sample";
import { opening, reply, right, started } from "./harness";

afterEach(() => {
	mock.restore();
});

const asciiOf = (play: Play | undefined) => {
	if (!play) throw new Error("no frame was shown");
	const element = { textContent: null as string | null };
	asciiView(element).show({ play });
	return element.textContent;
};

function swapped() {
	const drawn: Poses[] = [];
	const scene: Consumer = {
		show: () => {},
		draw: (poses) => drawn.push(poses),
	};
	const element = { textContent: null as string | null };
	const view = asciiView(element);
	let shows = 0;
	const ascii: Consumer = {
		show: (frame) => {
			shows++;
			view.show(frame);
		},
	};
	const game = started([scene]);
	game.deliver(opening);
	game.clock.settle();
	return { ...game, drawn, scene, ascii, element, shows: () => shows };
}

test("replace shows the current frame on the new consumer at once", () => {
	const { client, frames, scene, ascii, element } = swapped();
	client.replace(scene, ascii);
	expect(element.textContent).toBe(asciiOf(frames.at(-1)));
});

test("after a replace, later turns reach the new consumer and never the old one", () => {
	const { client, clock, frames, drawn, scene, ascii, element, deliver } =
		swapped();
	client.replace(scene, ascii);
	const draws = drawn.length;

	client.press(right);
	deliver(reply);
	clock.settle();

	expect(drawn).toHaveLength(draws);
	expect(element.textContent).toBe(asciiOf(frames.at(-1)));
	expect(element.textContent).not.toBe(asciiOf(frames[1]));
});

test("a second replace is a no-op", () => {
	const { client, scene, ascii, shows } = swapped();
	client.replace(scene, ascii);
	const once = shows();
	client.replace(scene, ascii);
	expect(shows()).toBe(once);
});

test("a consumer whose show throws when swapped in ends broken once", () => {
	spyOn(console, "error").mockImplementation(() => {});
	const { client, scene, ended, link } = swapped();
	const boom = new Error("boom");
	expect(() =>
		client.replace(scene, {
			show: () => {
				throw boom;
			},
		}),
	).not.toThrow();
	expect(ended).toEqual([{ kind: "broken", detail: boom.message }]);
	expect(link.closes).toBe(1);
});
