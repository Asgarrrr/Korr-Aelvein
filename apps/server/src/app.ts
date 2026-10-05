import type { ClientMessage, ServerMessage } from "@korr/protocol";
import { Elysia } from "elysia";

export const createApp = () =>
	new Elysia().ws("/ws", {
		message(ws, raw) {
			const message = raw as ClientMessage;
			if (message.type === "ping") {
				const reply: ServerMessage = { type: "pong" };
				ws.send(reply);
			}
		},
	});
