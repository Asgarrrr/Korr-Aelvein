import type { Command } from "@korr/protocol";
import type { PlayEvent } from "../play/types";
import { decode } from "./decode";

export type WebSocketLike = {
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	send(data: string): void;
	close(): void;
};

const NO_REPLY = "no reply";
const UNDECODABLE = "undecodable server message";

export function connect(
	open: () => WebSocketLike,
	onEvent: (event: PlayEvent) => void,
	config: {
		openMs: number;
		replyMs: number;
		hidden: () => boolean;
		onVisible: (listener: () => void) => void;
	},
): { send(command: Command): void; close(): void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let budget = 0;
	const disarm = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	// A hidden page's timers are throttled and its user is away: silence there is no evidence of a dead server.
	const arm = (ms: number) => {
		clearTimeout(timer);
		budget = ms;
		timer = setTimeout(() => {
			if (config.hidden()) return arm(ms);
			timer = undefined;
			onEvent({ type: "closed", detail: NO_REPLY });
		}, ms);
	};
	config.onVisible(() => {
		if (timer !== undefined) arm(budget);
	});

	const socket = open();
	socket.onopen = () => onEvent({ type: "open" });
	socket.onmessage = (event) => {
		disarm();
		const message = decode(String(event.data));
		onEvent(
			message
				? { type: "message", message }
				: { type: "fault", detail: UNDECODABLE },
		);
	};
	socket.onclose = (event) => {
		disarm();
		onEvent({ type: "closed", detail: String(event.code) });
	};
	arm(config.openMs);
	return {
		send(command) {
			arm(config.replyMs);
			socket.send(JSON.stringify(command));
		},
		close() {
			disarm();
			socket.close();
		},
	};
}
