import type { Command } from "@korr/protocol";
import { type Consumer, createClient } from "../../../src/app/client";
import { asciiView } from "../../../src/debug/ascii";
import type { KeyPress } from "../../../src/input/keys";
import type { Ending, Play, PlayEvent } from "../../../src/play/types";
import { motion } from "../../../src/theme";
import { hud } from "../../../src/ui/hud";
import { snapshot } from "../../snapshot";

export const right: KeyPress = {
	key: "l",
	code: "KeyL",
	repeat: false,
	ctrlKey: false,
	altKey: false,
	metaKey: false,
	isComposing: false,
	keyCode: 76,
};

export const down: KeyPress = { ...right, key: "j", code: "KeyJ", keyCode: 74 };
export const wait: KeyPress = {
	...right,
	key: ".",
	code: "Period",
	keyCode: 190,
};

export function fakeFrames() {
	const due = new Map<number, (now: number) => void>();
	let next = 0;
	let now = 0;
	const tick = (elapsed = motion.turnMs) => {
		const callbacks = [...due.values()];
		due.clear();
		now += elapsed;
		for (const callback of callbacks) callback(now);
	};
	return {
		requestFrame: (callback: (now: number) => void) => {
			const id = next++;
			due.set(id, callback);
			return () => {
				due.delete(id);
			};
		},
		turnMs: motion.turnMs,
		pending: () => due.size,
		tick,
		// Bounded, so a loop that never stops asking fails the test instead of hanging it.
		settle() {
			for (let i = 0; i < 10 && due.size > 0; i++) tick();
			if (due.size > 0) throw new Error("frames still pending after settle");
		},
	};
}

export const idle = { requestFrame: () => () => {}, turnMs: motion.turnMs };

export const consumers = () => [
	asciiView({ textContent: null }),
	hud({ textContent: null }),
];

export function started(extra: Consumer[] = []) {
	const frames: Play[] = [];
	const sent: Command[] = [];
	const ended: Ending[] = [];
	const text = { textContent: null as string | null };
	const link = { closes: 0 };
	let deliver: (event: PlayEvent) => void = () => {};
	const clock = fakeFrames();
	const client = createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return {
				send: (command) => sent.push(command),
				close: () => link.closes++,
			};
		},
		consumers: [{ show: ({ play }) => frames.push(play) }, hud(text), ...extra],
		ended: (ending) => ended.push(ending),
		requestFrame: clock.requestFrame,
		turnMs: clock.turnMs,
	});
	return {
		clock,
		frames,
		sent,
		ended,
		text,
		link,
		client,
		deliver: (event: PlayEvent) => deliver(event),
	};
}

export const opening: PlayEvent = {
	type: "message",
	message: snapshot({ x: 4, y: 4 }),
};
export const reply: PlayEvent = {
	type: "message",
	message: snapshot({ x: 5, y: 4 }),
};
