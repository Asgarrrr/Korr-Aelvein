import type { ServerMessage, Snapshot } from "@korr/protocol";

export type Gesture =
	| { kind: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
	| { kind: "wait" }
	| { kind: "eat" };

export type Ending = { kind: "over" };

export type Notice = "rejected" | "closed" | "fault";

export type PlayEvent =
	| { type: "message"; message: ServerMessage }
	| { type: "closed" }
	| { type: "fault" }
	| { type: "gesture"; gesture: Gesture };

export type Play = {
	status: "connecting" | "playing" | Ending;
	snapshot: Snapshot | undefined;
	inFlight: boolean;
	notice: Notice | undefined;
};
