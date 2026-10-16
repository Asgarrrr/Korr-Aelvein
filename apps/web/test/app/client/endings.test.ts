import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createClient } from "../../../src/app/client";
import * as stepModule from "../../../src/play/step";
import type { Ending, PlayEvent } from "../../../src/play/types";
import { connectingText, endTexts } from "../../../src/theme";
import * as deriveModule from "../../../src/view/derive";
import { idle, opening, reply, right, started } from "./harness";

afterEach(() => {
	mock.restore();
});

test("an ending is reported once, closes the link once, and leaves the HUD to the end screen", () => {
	const { text, ended, link, deliver } = started();
	expect(text.textContent).toBe(connectingText);

	deliver(opening);
	deliver({ type: "message", message: { type: "over" } });
	deliver({ type: "closed", detail: "1006" });

	expect(ended).toEqual([{ kind: "over" }]);
	expect(link.closes).toBe(1);
	expect(text.textContent).not.toContain(endTexts.over);
});

const boom = new Error("boom");

test.each([
	[
		"a consumer's show",
		(armed: { on: boolean }) => {
			const consumer = {
				show: () => {
					if (armed.on) throw boom;
				},
			};
			return [consumer];
		},
		0,
	],
	[
		"step",
		(armed: { on: boolean }) => {
			const real = stepModule.step;
			spyOn(stepModule, "step").mockImplementation((play, event) => {
				if (armed.on) throw boom;
				return real(play, event);
			});
			return [];
		},
		0,
	],
	[
		"deriveView",
		(armed: { on: boolean }) => {
			const real = deriveModule.deriveView;
			spyOn(deriveModule, "deriveView").mockImplementation((prev, next) => {
				if (armed.on) throw boom;
				return real(prev, next);
			});
			return [];
		},
		1,
	],
	[
		"a consumer's draw",
		(armed: { on: boolean }) => {
			const consumer = {
				show: () => {},
				draw: () => {
					if (armed.on) throw boom;
				},
			};
			return [consumer];
		},
		1,
	],
] as const)(
	"a throw in %s ends broken once and sends nothing more",
	(_, arm, sends) => {
		spyOn(console, "error").mockImplementation(() => {});
		const armed = { on: false };
		const { client, clock, sent, ended, link, deliver } = started(arm(armed));
		deliver(opening);
		clock.settle();
		armed.on = true;

		client.press(right);
		deliver(reply);
		clock.settle();
		armed.on = false;
		deliver(opening);
		clock.settle();
		client.press(right);

		expect(ended).toEqual([{ kind: "broken", detail: boom.message }]);
		expect(sent).toHaveLength(sends);
		expect(link.closes).toBe(1);
	},
);

test.each([
	[
		"the first show",
		{
			consumers: [
				{
					show: () => {
						throw boom;
					},
				},
			],
			connect: () => ({ send: () => {}, close: () => {} }),
		},
	],
	[
		"connect",
		{
			consumers: [],
			connect: () => {
				throw boom;
			},
		},
	],
])("a throw in %s during start ends broken without throwing", (_, wiring) => {
	spyOn(console, "error").mockImplementation(() => {});
	const ended: Ending[] = [];
	expect(() =>
		createClient({ ...wiring, ...idle, ended: (ending) => ended.push(ending) }),
	).not.toThrow();
	expect(ended).toEqual([{ kind: "broken", detail: boom.message }]);
});

test("a step that always throws still ends broken exactly once", () => {
	spyOn(console, "error").mockImplementation(() => {});
	spyOn(stepModule, "step").mockImplementation(() => {
		throw boom;
	});
	const { client, ended, sent, deliver } = started();
	deliver(opening);
	client.press(right);
	deliver({ type: "fault", detail: "late" });

	expect(ended).toEqual([{ kind: "broken", detail: boom.message }]);
	expect(sent).toEqual([]);
});

test("a consumer throwing on the ending frame keeps the first ending", () => {
	spyOn(console, "error").mockImplementation(() => {});
	const { ended, deliver } = started([
		{
			show: ({ play }) => {
				if (typeof play.status === "object") throw new Error("boom");
			},
		},
	]);
	deliver(opening);
	deliver({ type: "message", message: { type: "over" } });
	expect(ended).toEqual([{ kind: "over" }]);
});

test("a link whose close throws still gets its ending reported", () => {
	const ended: Ending[] = [];
	let deliver: (event: PlayEvent) => void = () => {};
	spyOn(console, "error").mockImplementation(() => {});
	createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return {
				send: () => {},
				close: () => {
					throw new Error("close");
				},
			};
		},
		consumers: [],
		ended: (ending) => ended.push(ending),
		...idle,
	});
	deliver(opening);
	deliver({ type: "message", message: { type: "over" } });
	expect(ended).toEqual([{ kind: "over" }]);
});

test.each([
	["closes cleanly", false],
	["throws on close", true],
])(
	"an ending delivered before connect returns still closes the link, and the link %s",
	(_, throws) => {
		spyOn(console, "error").mockImplementation(() => {});
		let closes = 0;
		const ended: Ending[] = [];
		createClient({
			connect: (onEvent) => {
				onEvent({ type: "closed", detail: "1006" });
				return {
					send: () => {},
					close: () => {
						closes++;
						if (throws) throw boom;
					},
				};
			},
			consumers: [],
			ended: (ending) => ended.push(ending),
			...idle,
		});
		expect(ended).toHaveLength(1);
		expect(closes).toBe(1);
	},
);

test("a consumer throw followed by a throwing ended does not escape receive", () => {
	spyOn(console, "error").mockImplementation(() => {});
	let calls = 0;
	let deliver: (event: PlayEvent) => void = () => {};
	createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return { send: () => {}, close: () => {} };
		},
		consumers: [
			{
				show: ({ play }) => {
					if (play.snapshot) throw boom;
				},
			},
		],
		ended: () => {
			calls++;
			throw new Error("ended");
		},
		...idle,
	});
	expect(() => deliver(opening)).not.toThrow();
	expect(calls).toBe(1);
});

test("an ending cancels the pending frame", () => {
	const { clock, deliver } = started();
	deliver(opening);
	expect(clock.pending()).toBe(1);

	deliver({ type: "closed", detail: "1006" });
	expect(clock.pending()).toBe(0);
});
