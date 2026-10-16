import type { Command } from "@korr/protocol";
import { gestureOf, type KeyPress } from "../input/keys";
import { initialPlay, step } from "../play/step";
import type { Play, PlayEvent } from "../play/types";

type Frame = { play: Play };
type Consumer = { show(frame: Frame): void };
type Link = { send(command: Command): void };

export function createClient({
	connect,
	consumers,
}: {
	connect: (onEvent: (event: PlayEvent) => void) => Link;
	consumers: readonly Consumer[];
}): { press(press: KeyPress): boolean } {
	let play = initialPlay;
	const show = () => {
		for (const consumer of consumers) consumer.show({ play });
	};
	const receive = (event: PlayEvent) => {
		const next = step(play, event);
		if (next.play !== play) {
			play = next.play;
			show();
		}
		if (next.send) link.send(next.send);
	};
	show();
	const link = connect(receive);
	return {
		press(press) {
			const gesture = gestureOf(press);
			if (!gesture) return false;
			receive({ type: "gesture", gesture });
			return true;
		},
	};
}
