import { Command, type Rejected } from "@korr/protocol";
import { Elysia, ValidationError } from "elysia";
import type { ElysiaWS } from "elysia/ws";
import { Session } from "./session";

const INTERNAL_ERROR = 1011;
const INVALID: Rejected = { type: "rejected", reason: "invalid" };

type Options = {
	seed?: number;
	createSession?: (seed: number) => Session;
};

type Socket = Pick<ElysiaWS, "id" | "close">;

const drawSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] as number;

export const createApp = ({
	seed,
	createSession = (seed) => new Session(seed),
}: Options = {}) => {
	const sessions = new Map<string, Session>();

	const fail = (ws: Socket, error: unknown) => {
		console.error(error);
		sessions.delete(ws.id);
		ws.close(INTERNAL_ERROR);
	};

	return new Elysia().ws("/ws", {
		body: Command,
		open(ws) {
			try {
				const created = createSession(seed ?? drawSeed());
				sessions.set(ws.id, created);
				return created.opening;
			} catch (error) {
				fail(ws, error);
			}
		},
		message(ws, command) {
			try {
				const current = sessions.get(ws.id);
				if (!current) throw new Error(`no session for socket ${ws.id}`);
				return current.handle(command);
			} catch (error) {
				fail(ws, error);
			}
		},
		close(ws) {
			sessions.delete(ws.id);
		},
		// Elysia hands this hook the request context, not the socket, so socket errors are caught above.
		error({ error }) {
			if (error instanceof ValidationError) return INVALID;
			console.error(error);
		},
	});
};
