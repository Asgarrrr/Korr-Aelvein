import { BANDS } from "../config";

export type BandName = keyof typeof BANDS;

const WEIGHT_MAX = 255;

// Weight 0 is no candidate; 1..255 spread over the band, 255 landing on its max.
export function band(name: BandName, weight: number): number {
	if (!Number.isInteger(weight) || weight < 0 || weight > WEIGHT_MAX)
		throw new Error(`band weight ${weight} is not an integer in 0..255`);
	if (weight === 0) return 0;
	const { min, max } = BANDS[name];
	return min + Math.floor(((weight - 1) * (max - min)) / (WEIGHT_MAX - 1));
}
