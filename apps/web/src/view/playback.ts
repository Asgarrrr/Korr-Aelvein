export type Playback = { duration: number; start: number | undefined };

export function frame(
	playback: Playback,
	now: number,
): { playback: Playback; progress: number } {
	const start = playback.start ?? now;
	const started = { ...playback, start };
	if (playback.duration === 0) return { playback: started, progress: 1 };
	const progress = Math.min(1, (now - start) / playback.duration);
	return { playback: started, progress };
}
