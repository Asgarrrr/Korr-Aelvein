import type { Command } from "@korr/protocol";
import { gestureOf, type KeyPress } from "../input/keys";
import { initialPlay, isEnding, step } from "../play/step";
import type { Ending, Play, PlayEvent } from "../play/types";

type Frame = { play: Play };
type Consumer = { show(frame: Frame): void };
type Link = { send(command: Command): void; close(): void };

export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function createClient({
	connect,
	consumers,
	ended,
}: {
	connect: (onEvent: (event: PlayEvent) => void) => Link;
	consumers: readonly Consumer[];
	ended: (ending: Ending) => void;
}): { receive(event: PlayEvent): void; press(press: KeyPress): boolean } {
	let play = initialPlay;
	let link: Link | undefined;
	let sent: Command | undefined;
	let done = false;
	const end = (ending: Ending) => {
		if (done) return;
		done = true;
		try {
			link?.close();
		} catch (error) {
			console.error(error);
		}
		try {
			ended(ending);
		} catch (error) {
			console.error(error);
		}
	};
	// The broken ending is built here, not by step, so a throwing step cannot throw again on its own fault.
	const guarded = (work: () => void) => {
		if (done) return;
		try {
			work();
		} catch (error) {
			console.error(error);
			end(
				isEnding(play.status)
					? play.status
					: { kind: "broken", detail: messageOf(error) },
			);
		}
	};
	const show = () => {
		for (const consumer of consumers) consumer.show({ play });
	};
	const receive = (event: PlayEvent) =>
		guarded(() => {
			const next = step(play, event);
			if (
				event.type === "message" &&
				event.message.type === "rejected" &&
				event.message.reason === "invalid"
			)
				console.error("command rejected", sent);
			if (next.play !== play) {
				play = next.play;
				show();
			}
			if (next.send) {
				sent = next.send;
				link?.send(next.send);
			}
			if (isEnding(play.status)) end(play.status);
		});
	guarded(() => {
		show();
		link = connect(receive);
		if (done) link.close();
	});
	return {
		receive,
		press(press) {
			const gesture = gestureOf(press);
			if (!gesture) return false;
			receive({ type: "gesture", gesture });
			return true;
		},
	};
}
