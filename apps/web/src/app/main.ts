import { asciiView } from "../debug/ascii";
import { connect } from "../net/connect";
import { hud } from "../ui/hud";
import { createClient } from "./client";

const view = document.querySelector("#view");
const status = document.querySelector("#hud");
if (!view || !status) throw new Error("index.html lacks #view or #hud");

const client = createClient({
	connect: (onEvent) =>
		connect(() => new WebSocket(`ws://${location.host}/ws`), onEvent),
	consumers: [asciiView(view), hud(status)],
});

document.addEventListener("keydown", (event) => {
	if (client.press(event)) event.preventDefault();
});
