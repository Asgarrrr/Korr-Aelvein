import type { ServerMessage } from "@korr/protocol";

const status = document.querySelector<HTMLParagraphElement>("#status");
const socket = new WebSocket(`ws://${location.host}/ws`);

socket.onmessage = (event) => {
	const message = JSON.parse(String(event.data)) as ServerMessage;
	if (status && message.type === "snapshot")
		status.textContent = "serveur connecté";
};
socket.onerror = () => {
	if (status) status.textContent = "serveur injoignable";
};
