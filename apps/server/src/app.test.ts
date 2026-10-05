import { afterAll, expect, test } from "bun:test";
import type { ClientMessage, ServerMessage } from "@korr/protocol";
import { createApp } from "./app";

const app = createApp().listen(0);
afterAll(() => app.stop());

test("answers a ping with a pong over the websocket", async () => {
	const socket = new WebSocket(`ws://localhost:${app.server?.port}/ws`);
	const reply = await new Promise<ServerMessage>((resolve, reject) => {
		socket.onopen = () =>
			socket.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
		socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
		socket.onerror = reject;
	});
	socket.close();
	expect(reply).toEqual({ type: "pong" });
});
