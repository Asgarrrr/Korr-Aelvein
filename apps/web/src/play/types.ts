import type { ServerMessage, Snapshot } from "@korr/protocol";

export type Gesture =
	| { kind: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
	| { kind: "wait" }
	| { kind: "eat" };

export type Ending =
	| { kind: "over" }
	| { kind: "lost"; cause: "unreachable" | "dropped"; detail: string }
	| { kind: "broken"; detail: string };

export type Notice = "rejected";

export type PlayEvent =
	| { type: "open" }
	| { type: "message"; message: ServerMessage }
	| { type: "closed"; detail: string }
	| { type: "fault"; detail: string }
	| { type: "gesture"; gesture: Gesture }
	| { type: "settled" };

export type Play = {
	status: "connecting" | "playing" | Ending;
	opened: boolean;
	snapshot: Snapshot | undefined;
	inFlight: boolean;
	notice: Notice | undefined;
	queued: Gesture | undefined;
	settled: boolean;
};
