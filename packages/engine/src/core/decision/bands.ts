import { BANDS, INERTIA } from "../config";

export type BandName = keyof typeof BANDS;

const WEIGHT_MAX = 255;
const TOP = Math.max(...Object.values(BANDS).map((b) => b.max));

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
