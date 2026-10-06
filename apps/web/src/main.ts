import type { ServerMessage, Snapshot } from "@korr/protocol";
import { render } from "./debug/render";
import { commandFor } from "./input/keys";
import { rejectedNoticeMs } from "./theme";

const view = document.querySelector<HTMLPreElement>("#view");
const status = document.querySelector<HTMLParagraphElement>("#status");
const socket = new WebSocket(`ws://${location.host}/ws`);

let snapshot: Snapshot | undefined;
let over = false;
let ended = false;
let pending = false;
let state = "";
let notice: ReturnType<typeof setTimeout> | undefined;

function show(text: string): void {
	if (status) status.textContent = text;
}

function settle(text: string): void {
	state = text;
	clearTimeout(notice);
	show(text);
}

socket.onmessage = (event) => {
	pending = false;
	let message: ServerMessage;
	try {
		message = JSON.parse(String(event.data)) as ServerMessage;
	} catch {
		return;
	}
	if (message.type === "snapshot") {
		snapshot = message;
		if (view) view.textContent = render(message);
		settle("connected");
	} else if (message.type === "over") {
		over = true;
		settle("game over");
	} else if (message.type === "rejected") {
		show(`command rejected: ${message.reason}`);
		clearTimeout(notice);
		notice = setTimeout(() => show(state), rejectedNoticeMs);
	}
};
socket.onerror = () => {
	ended = true;
	settle("server unreachable");
};
socket.onclose = () => {
	if (!over && !ended) settle("connection lost");
	ended = true;
};

document.addEventListener("keydown", (event) => {
	if (!snapshot || over || ended || pending) return;
	if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
	const command = commandFor(event.key, snapshot);
	if (!command) return;
	event.preventDefault();
	pending = true;
	socket.send(JSON.stringify(command));
});
