import type { Command } from "@korr/protocol";
import type { PlayEvent } from "../play/types";
import { decode } from "./decode";

export function connect(
	open: () => WebSocket,
	onEvent: (event: PlayEvent) => void,
): { send(command: Command): void } {
	const socket = open();
	socket.onmessage = (event) => {
		const message = decode(String(event.data));
		onEvent(message ? { type: "message", message } : { type: "fault" });
	};
	socket.onclose = () => onEvent({ type: "closed" });
	return { send: (command) => socket.send(JSON.stringify(command)) };
}
