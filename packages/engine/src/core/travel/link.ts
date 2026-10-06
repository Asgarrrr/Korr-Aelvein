// One rule for spawns and loads, so a run cannot write a save that load rejects.
export function validLink(
	own: number,
	to: number,
	x: number,
	y: number,
	floors: number,
	width: number,
	height: number,
): boolean {
	return (
		to >= 0 &&
		to < floors &&
		to !== own &&
		x >= 0 &&
		x < width &&
		y >= 0 &&
		y < height
	);
}
