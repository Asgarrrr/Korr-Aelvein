export function outCubic(t: number): number {
	const rest = 1 - t;
	return 1 - rest * rest * rest;
}
