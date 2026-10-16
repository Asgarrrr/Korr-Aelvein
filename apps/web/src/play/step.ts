import type { Command, ServerMessage, Snapshot } from "@korr/protocol";
import { eatTarget } from "./edible";
import type { Gesture, Play, PlayEvent } from "./types";

export const initialPlay: Play = {
	status: "connecting",
	snapshot: undefined,
	inFlight: false,
	notice: undefined,
};

export function step(
	play: Play,
	event: PlayEvent,
): { play: Play; send: Command | undefined } {
	switch (event.type) {
		case "message":
			return { play: receive(play, event.message), send: undefined };
		case "closed":
		case "fault":
			return { play: { ...play, notice: event.type }, send: undefined };
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
			return { ...answered, notice: "rejected" };
	}
}

function commandOf(gesture: Gesture, snapshot: Snapshot): Command | undefined {
	if (gesture.kind === "move")
		return { type: "move", dx: gesture.dx, dy: gesture.dy };
	if (gesture.kind === "wait") return { type: "wait" };
	const target = eatTarget(snapshot);
	return target === undefined ? undefined : { type: "eat", target };
}
