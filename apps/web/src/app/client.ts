import type { Command } from "@korr/protocol";
import { gestureOf, type KeyPress } from "../input/keys";
import { initialPlay, isEnding, step } from "../play/step";
import type { Ending, Play, PlayEvent } from "../play/types";
import { deriveView, type Timeline } from "../view/derive";
import { outCubic } from "../view/easing";
import { frame, type Playback } from "../view/playback";
import { type Poses, sample } from "../view/sample";

type Frame = { play: Play; timeline: Timeline | undefined };
export type Consumer = { show(frame: Frame): void; draw?(poses: Poses): void };
type Link = { send(command: Command): void; close(): void };

export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function createClient({
	connect,
	consumers,
	ended,
	requestFrame,
	turnMs,
}: {
	connect: (onEvent: (event: PlayEvent) => void) => Link;
	consumers: readonly Consumer[];
	ended: (ending: Ending) => void;
	requestFrame: (callback: (now: number) => void) => () => void;
	turnMs: number;
}): {
	receive(event: PlayEvent): void;
	press(press: KeyPress): boolean;
	replace(from: Consumer, to: Consumer): void;
} {
	const list = [...consumers];
	let play = initialPlay;
	let timeline: Timeline | undefined;
	let playback: Playback = { duration: turnMs, start: undefined };
	let cancelFrame: (() => void) | undefined;
	let link: Link | undefined;
	let sent: Command | undefined;
	let done = false;
	const end = (ending: Ending) => {
		if (done) return;
		done = true;
		cancelFrame?.();
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
		for (const consumer of list) consumer.show({ play, timeline });
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
			if (next.play.snapshot && next.play.snapshot !== play.snapshot) {
				timeline = deriveView(play.snapshot, next.play.snapshot);
				playback = { duration: turnMs, start: undefined };
				cancelFrame ??= requestFrame(animate);
			}
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
	const animate = (now: number) =>
		guarded(() => {
			cancelFrame = undefined;
			if (!timeline) return;
			const result = frame(playback, now);
			playback = result.playback;
			const poses = sample(timeline, outCubic(result.progress));
			for (const consumer of list) consumer.draw?.(poses);
			if (result.progress < 1) cancelFrame = requestFrame(animate);
			else if (!play.settled) receive({ type: "settled" });
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
		replace: (from, to) =>
			guarded(() => {
				const index = list.indexOf(from);
				if (index < 0) return;
				list[index] = to;
				to.show({ play, timeline });
			}),
	};
}
