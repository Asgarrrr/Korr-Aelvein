import type { Command, ServerMessage, Snapshot } from "@korr/protocol";
import type { Page, WebSocketRoute } from "@playwright/test";

export type Tapped = {
	route: WebSocketRoute;
	commands: Command[];
	messages: ServerMessage[];
};

// Both directions are forwarded here: an onMessage handler on a route stops Playwright's own forwarding.
export async function tapWire(page: Page): Promise<Tapped[]> {
	const sockets: Tapped[] = [];
	await page.routeWebSocket(/\/ws$/, (route) => {
		const server = route.connectToServer();
		const tapped: Tapped = { route, commands: [], messages: [] };
		route.onMessage((data) => {
			tapped.commands.push(JSON.parse(String(data)));
			server.send(data);
		});
		server.onMessage((data) => {
			tapped.messages.push(JSON.parse(String(data)));
			route.send(data);
		});
		sockets.push(tapped);
	});
	return sockets;
}

export function snapshotsOf(tapped: Tapped): Snapshot[] {
	return tapped.messages.filter(
		(message): message is Snapshot => message.type === "snapshot",
	);
}

export function socketAt(sockets: Tapped[], index: number): Tapped {
	const tapped = sockets[index];
	if (!tapped) throw new Error(`socket ${index} was never opened`);
	return tapped;
}
