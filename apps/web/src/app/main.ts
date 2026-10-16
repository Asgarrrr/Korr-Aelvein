import { asciiView } from "../debug/ascii";
import { watchdogs } from "../net/config";
import { connect } from "../net/connect";
import type { Ending } from "../play/types";
import { createScene } from "../render/scene";
import { endTexts, motion } from "../theme";
import { hud } from "../ui/hud";
import { createClient, messageOf } from "./client";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const view = document.querySelector("#view");
const status = document.querySelector("#hud");
const end = document.querySelector<HTMLElement>("#end");
const endTitle = document.querySelector("#end-title");
const endDetail = document.querySelector("#end-detail");
const newGame = document.querySelector<HTMLButtonElement>("#new-game");
if (!canvas || !view || !status || !end || !endTitle || !endDetail || !newGame)
	throw new Error(
		"index.html lacks an element of the scene, view, HUD or end screen",
	);

const showEnd = (ending: Ending) => {
	endTitle.textContent =
		endTexts[ending.kind === "lost" ? ending.cause : ending.kind];
	endDetail.textContent = ending.kind === "over" ? "" : ending.detail;
	end.hidden = false;
	newGame.focus();
};

const params = new URLSearchParams(location.search);
const ascii = asciiView(view);
// A promise holds a loss reported before the client exists.
let lost: (detail: string) => void = () => {};
const sceneLost = new Promise<string>((resolve) => {
	lost = resolve;
});
const created = params.has("debug")
	? undefined
	: await createScene(canvas, { forceWebGL: params.has("webgl"), lost });
if (created && !created.ok)
	console.error(
		"3D scene unavailable, showing the ASCII view:",
		created.detail,
	);
const scene = created?.ok ? created.scene : undefined;
canvas.hidden = !scene;

const client = createClient({
	connect: (onEvent) =>
		connect(() => new WebSocket(`ws://${location.host}/ws`), onEvent, {
			...watchdogs,
			hidden: () => document.hidden,
			onVisible: (listener) =>
				document.addEventListener("visibilitychange", () => {
					if (!document.hidden) listener();
				}),
		}),
	consumers: [scene ?? ascii, hud(status)],
	ended: showEnd,
	requestFrame: (callback) => {
		const id = requestAnimationFrame(callback);
		return () => cancelAnimationFrame(id);
	},
	turnMs: matchMedia("(prefers-reduced-motion: reduce)").matches
		? 0
		: motion.turnMs,
});

if (scene)
	sceneLost.then((detail) => {
		console.error("3D scene lost, showing the ASCII view:", detail);
		canvas.hidden = true;
		client.replace(scene, ascii);
	});

newGame.addEventListener("click", () => location.reload());
document.addEventListener("keydown", (event) => {
	if (!end.hidden) {
		if (event.key !== "Enter") return;
		event.preventDefault();
		location.reload();
	} else if (client.press(event)) event.preventDefault();
});

window.addEventListener("error", (event) =>
	client.receive({
		type: "fault",
		detail: messageOf(event.error ?? event.message),
	}),
);
window.addEventListener("unhandledrejection", (event) =>
	client.receive({ type: "fault", detail: messageOf(event.reason) }),
);
// The socket sat frozen while the page was cached, so the server may have dropped it.
window.addEventListener("pageshow", (event) => {
	if (event.persisted)
		client.receive({
			type: "closed",
			detail: "restored from the back-forward cache",
		});
});
