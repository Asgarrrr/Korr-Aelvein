import type { Command, ServerMessage, Snapshot } from "@korr/protocol";
import { eatTarget } from "./edible";
import type { Ending, Gesture, Play, PlayEvent } from "./types";

export const initialPlay: Play = {
	status: "connecting",
	opened: false,
	snapshot: undefined,
	inFlight: false,
	notice: undefined,
};

export const isEnding = (status: Play["status"]): status is Ending =>
	typeof status === "object";

export function step(
	play: Play,
	event: PlayEvent,
): { play: Play; send: Command | undefined } {
	if (isEnding(play.status)) return { play, send: undefined };
	switch (event.type) {
		case "open":
			return { play: { ...play, opened: true }, send: undefined };
		case "message":
			return { play: receive(play, event.message), send: undefined };
		case "closed": {
			const cause = play.opened ? "dropped" : "unreachable";
			const status: Ending = { kind: "lost", cause, detail: event.detail };
			return { play: { ...play, status }, send: undefined };
		}
		case "fault":
			return {
				play: { ...play, status: { kind: "broken", detail: event.detail } },
				send: undefined,
			};
		case "gesture": {
			if (play.status !== "playing" || play.inFlight || !play.snapshot)
				return { play, send: undefined };
			const send = commandOf(event.gesture, play.snapshot);
			return send
				? { play: { ...play, inFlight: true }, send }
				: { play, send: undefined };
		}
	}
}

function receive(play: Play, message: ServerMessage): Play {
	const answered: Play = { ...play, inFlight: false, notice: undefined };
	switch (message.type) {
		case "snapshot":
			return { ...answered, status: "playing", snapshot: message };
		case "over":
			return { ...answered, status: { kind: "over" } };
		case "rejected":
			// The server sends rejected: over only after over, which already ended the game here.
			return message.reason === "over"
				? { ...answered, status: { kind: "broken", detail: "rejected: over" } }
				: { ...answered, notice: "rejected" };
	}
}

function commandOf(gesture: Gesture, snapshot: Snapshot): Command | undefined {
	if (gesture.kind === "move")
		return { type: "move", dx: gesture.dx, dy: gesture.dy };
	if (gesture.kind === "wait") return { type: "wait" };
	const target = eatTarget(snapshot);
	return target === undefined ? undefined : { type: "eat", target };
}
