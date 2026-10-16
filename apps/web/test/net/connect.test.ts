import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { connect, type WebSocketLike } from "../../src/net/connect";
import type { PlayEvent } from "../../src/play/types";
import { snapshot } from "../snapshot";

const openMs = 300;
const replyMs = 200;

class FakeSocket implements WebSocketLike {
	onopen: WebSocketLike["onopen"] = null;
	onmessage: WebSocketLike["onmessage"] = null;
	onclose: WebSocketLike["onclose"] = null;
	readonly sent: string[] = [];
	send(data: string) {
		this.sent.push(data);
	}
	close() {}
	receive(data: string) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
}

function connected() {
	const socket = new FakeSocket();
	const events: PlayEvent[] = [];
	const page = { hidden: false, visible: () => {} };
	const link = connect(
		() => socket,
		(event) => events.push(event),
		{
			openMs,
			replyMs,
			hidden: () => page.hidden,
			onVisible: (listener) => {
				page.visible = listener;
			},
		},
	);
	const hide = () => {
		page.hidden = true;
	};
	const show = () => {
		page.hidden = false;
		page.visible();
	};
	const reply = () => socket.receive(JSON.stringify(snapshot({ x: 1, y: 1 })));
	return { socket, events, link, hide, show, reply };
}

const types = (events: PlayEvent[]) => events.map((event) => event.type);
const wait = { type: "wait" } as const;

beforeEach(() => {
	jest.useFakeTimers();
});
afterEach(() => {
	jest.useRealTimers();
});

test("an open socket reports open, and a close reports its code", () => {
	const { socket, events } = connected();
	socket.onopen?.(new Event("open"));
	socket.onclose?.(new CloseEvent("close", { code: 1006 }));
	expect(events).toEqual([
		{ type: "open" },
		{ type: "closed", detail: "1006" },
	]);
});

test("a garbled frame is a fault", () => {
	const { socket, events } = connected();
	socket.receive("{not json");
	expect(events).toEqual([{ type: "fault", detail: expect.any(String) }]);
});

test("no first message closes with no reply after openMs", () => {
	const { events } = connected();
	jest.advanceTimersByTime(openMs - 1);
	expect(events).toEqual([]);
	jest.advanceTimersByTime(1);
	expect(events).toEqual([{ type: "closed", detail: "no reply" }]);
});

test("a first message clears the open watchdog", () => {
	const { events, reply } = connected();
	reply();
	jest.advanceTimersByTime(openMs * 2);
	expect(types(events)).toEqual(["message"]);
});

test("a send with no reply closes after replyMs", () => {
	const { events, link, reply } = connected();
	reply();
	link.send(wait);
	jest.advanceTimersByTime(replyMs - 1);
	expect(types(events)).toEqual(["message"]);
	jest.advanceTimersByTime(1);
	expect(events.at(-1)).toEqual({ type: "closed", detail: "no reply" });
});

test("a send then its reply closes nothing", () => {
	const { events, link, reply } = connected();
	reply();
	link.send(wait);
	jest.advanceTimersByTime(replyMs - 1);
	reply();
	jest.advanceTimersByTime(replyMs * 2);
	expect(types(events)).toEqual(["message", "message"]);
});

test("an expiry after a hidden period re-arms, then a reply clears it", () => {
	const { events, link, reply, hide, show } = connected();
	reply();
	link.send(wait);
	hide();
	jest.advanceTimersByTime(replyMs / 2);
	show();
	jest.advanceTimersByTime(replyMs / 2);
	expect(types(events)).toEqual(["message"]);
	reply();
	jest.advanceTimersByTime(replyMs * 2);
	expect(types(events)).toEqual(["message", "message"]);
});

test("an expiry while still hidden re-arms, and the fresh budget after show still expires", () => {
	const { events, link, reply, hide, show } = connected();
	reply();
	link.send(wait);
	hide();
	jest.advanceTimersByTime(replyMs * 2 + replyMs / 2);
	expect(types(events)).toEqual(["message"]);
	show();
	jest.advanceTimersByTime(replyMs - 1);
	expect(types(events)).toEqual(["message"]);
	jest.advanceTimersByTime(1);
	expect(events).toEqual([
		expect.objectContaining({ type: "message" }),
		{ type: "closed", detail: "no reply" },
	]);
});

test("a closed socket disarms the watchdog, so the close is reported once", () => {
	const { socket, events } = connected();
	socket.onclose?.(new CloseEvent("close", { code: 1006 }));
	jest.advanceTimersByTime(openMs * 2);
	expect(events).toEqual([{ type: "closed", detail: "1006" }]);
});

test("an idle page that is hidden then shown starts no watchdog", () => {
	const { events, reply, hide, show } = connected();
	reply();
	hide();
	show();
	jest.advanceTimersByTime(openMs * 2);
	expect(types(events)).toEqual(["message"]);
});

test.each([
	["before any command", false],
	["after a command", true],
])("closing the link %s disarms the watchdog", (_, sends) => {
	const { events, link } = connected();
	if (sends) link.send(wait);
	link.close();
	jest.advanceTimersByTime((sends ? replyMs : openMs) * 2);
	expect(events).toEqual([]);
});
