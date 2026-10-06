import { BANDS, INERTIA } from "../config";

export type BandName = keyof typeof BANDS;

interface Bounds {
	readonly min: number;
	readonly max: number;
}

const WEIGHT_MAX = 255;
const topOf = (bands: Readonly<Record<string, Bounds>>) =>
	Math.max(...Object.values(bands).map((b) => b.max));
const TOP = topOf(BANDS);

// band() caps every band but the top at max - INERTIA, so a band must be wider than INERTIA.
export function checkBands(
	bands: Readonly<Record<string, Bounds>>,
	inertia: number,
): void {
	const top = topOf(bands);
	for (const [name, { min, max }] of Object.entries(bands))
		if (max !== top && max - min <= inertia)
			throw new Error(`band ${name} must be wider than INERTIA (${inertia})`);
}
checkBands(BANDS, INERTIA);

// Weight 0 is no candidate; 1..255 spread over the band. Below the top band, 255 lands INERTIA
// under the band's max, so inertia never lifts a candidate into the band above.
export function band(name: BandName, weight: number): number {
	if (!Number.isInteger(weight) || weight < 0 || weight > WEIGHT_MAX)
		throw new Error(`band weight ${weight} is not an integer in 0..255`);
	if (weight === 0) return 0;
	const { min, max } = BANDS[name];
	const ceiling = max === TOP ? max : max - INERTIA;
	return min + Math.floor(((weight - 1) * (ceiling - min)) / (WEIGHT_MAX - 1));
}
