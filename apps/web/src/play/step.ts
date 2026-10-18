import type { Command, ServerMessage, Snapshot } from "@korr/protocol";
import { eatTarget } from "./edible";
import type { Ending, Gesture, Play, PlayEvent } from "./types";

// The engine's step fails into a cell held by another actor; every actor species has one of these stems.
const actorStems: ReadonlySet<string> = new Set(["rat", "stoat"]);

export const initialPlay: Play = {
	status: "connecting",
	opened: false,
	snapshot: undefined,
	inFlight: false,
	notice: undefined,
	queued: undefined,
	settled: false,
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
			return { play: { ...play, status, queued: undefined }, send: undefined };
		}
		case "fault": {
			const status: Ending = { kind: "broken", detail: event.detail };
			return { play: { ...play, status, queued: undefined }, send: undefined };
		}
		case "gesture":
			if (play.status !== "playing" || !play.snapshot)
				return { play, send: undefined };
			if (play.inFlight || !play.settled)
				return { play: { ...play, queued: event.gesture }, send: undefined };
			return dispatch(play, play.snapshot, event.gesture);
		case "settled": {
			if (play.inFlight)
				return { play: { ...play, settled: true }, send: undefined };
			const settled: Play = { ...play, settled: true, queued: undefined };
			return play.queued && play.snapshot
				? dispatch(settled, play.snapshot, play.queued)
				: { play: settled, send: undefined };
		}
	}
}

function dispatch(
	play: Play,
	snapshot: Snapshot,
	gesture: Gesture,
): { play: Play; send: Command | undefined } {
	const send = commandOf(gesture, snapshot);
	return send
		? { play: { ...play, inFlight: true }, send }
		: { play, send: undefined };
}

function receive(play: Play, message: ServerMessage): Play {
	const answered: Play = { ...play, inFlight: false, notice: undefined };
	switch (message.type) {
		case "snapshot":
			return {
				...answered,
				status: "playing",
				snapshot: message,
				settled: false,
				queued: kept(play.queued, play.snapshot, message),
			};
		case "over":
			return { ...answered, status: { kind: "over" }, queued: undefined };
		case "rejected":
			// The server sends rejected: over only after over, which already ended the game here.
			return message.reason === "over"
				? {
						...answered,
						status: { kind: "broken", detail: "rejected: over" },
						queued: undefined,
					}
				: { ...answered, notice: "rejected", queued: undefined };
	}
}

// A gesture queued against the previous snapshot is dropped when the new one makes it a likely mistake.
function kept(
	queued: Gesture | undefined,
	prev: Snapshot | undefined,
	next: Snapshot,
): Gesture | undefined {
	if (!queued) return undefined;
	if (prev && next.player.hp < prev.player.hp) return undefined;
	if (queued.kind === "eat" && eatTarget(next) === undefined) return undefined;
	if (queued.kind === "move" && heldByActor(next, queued.dx, queued.dy))
		return undefined;
	return queued;
}

function heldByActor(snapshot: Snapshot, dx: number, dy: number): boolean {
	const x = snapshot.player.x + dx;
	const y = snapshot.player.y + dy;
	return snapshot.entities.some(
		([, species, atX, atY]) =>
			atX === x &&
			atY === y &&
			actorStems.has(snapshot.looks[species]?.stem ?? ""),
	);
}

function commandOf(gesture: Gesture, snapshot: Snapshot): Command | undefined {
	if (gesture.kind === "move")
		return { type: "move", dx: gesture.dx, dy: gesture.dy };
	if (gesture.kind === "wait") return { type: "wait" };
	const target = eatTarget(snapshot);
	return target === undefined ? undefined : { type: "eat", target };
}
