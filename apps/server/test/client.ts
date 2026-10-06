import type { ServerMessage } from "@korr/protocol";

export type Client = {
	next: () => Promise<ServerMessage>;
	send: (raw: unknown) => Promise<ServerMessage>;
	closed: Promise<number>;
	close: () => void;
};

export const connect = (port: number | undefined): Promise<Client> => {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const queued: ServerMessage[] = [];
	const waiting: ((message: ServerMessage) => void)[] = [];
	socket.onmessage = (event) => {
		const message = JSON.parse(String(event.data)) as ServerMessage;
		const resolve = waiting.shift();
		if (resolve) resolve(message);
		else queued.push(message);
	};
	const closed = new Promise<number>((resolve) => {
		socket.onclose = (event) => resolve(event.code);
	});
	const next = () => {
		const message = queued.shift();
		if (message) return Promise.resolve(message);
		return new Promise<ServerMessage>((resolve) => waiting.push(resolve));
	};
	const client: Client = {
		next,
		send: (raw) => {
			socket.send(typeof raw === "string" ? raw : JSON.stringify(raw));
			return next();
		},
		closed,
		close: () => socket.close(),
	};
	return new Promise((resolve, reject) => {
		socket.onopen = () => resolve(client);
		socket.onerror = reject;
	});
};
