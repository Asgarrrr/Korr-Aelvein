import type { ClientMessage, ServerMessage } from "@korr/protocol";

const status = document.querySelector<HTMLParagraphElement>("#status");
const socket = new WebSocket(`ws://${location.host}/ws`);

socket.onopen = () =>
	socket.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
socket.onmessage = (event) => {
	const message = JSON.parse(String(event.data)) as ServerMessage;
	if (status && message.type === "pong")
		status.textContent = "serveur connecté";
};
socket.onerror = () => {
	if (status) status.textContent = "serveur injoignable";
};
