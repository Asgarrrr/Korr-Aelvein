import type { Look } from "@korr/protocol";
import type { Timeline, Track } from "./derive";

export type Pose = {
	id: number;
	look: Look;
	x: number;
	y: number;
	opacity: number;
};
export type Poses = {
	width: number;
	height: number;
	player: Pose;
	entities: readonly Pose[];
};

const between = (from: number, to: number, t: number) => from + (to - from) * t;

function poseOf({ id, look, from, to }: Track, t: number): Pose {
	return {
		id,
		look,
		x: between(from.x, to.x, t),
		y: between(from.y, to.y, t),
		opacity: between(from.opacity, to.opacity, t),
	};
}

// A fully faded pose is dropped, so t = 0 holds only the previous entities and t = 1 only the next.
export function sample(timeline: Timeline, t: number): Poses {
	const entities: Pose[] = [];
	for (const track of timeline.tracks) {
		const pose = poseOf(track, t);
		if (pose.opacity > 0) entities.push(pose);
	}
	return {
		width: timeline.width,
		height: timeline.height,
		player: poseOf(timeline.player, t),
		entities,
	};
}
