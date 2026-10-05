export const PHASE = {
	propose: 1,
	action: 2,
	tick: 3,
	spawn: 4,
	core: 5,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const SUBJECT = {
	entity: 1,
	cell: 2,
} as const;
export type SubjectKind = (typeof SUBJECT)[keyof typeof SUBJECT];

const MUL_A = 0x7feb352d;
const MUL_B = 0x846ca68b;
const GOLDEN = 0x9e3779b9;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
export const MAX_BOUND = 0x10000;

export function lowbias32(input: number): number {
	let x = input ^ (input >>> 16);
	x = Math.imul(x, MUL_A);
	x ^= x >>> 15;
	x = Math.imul(x, MUL_B);
	x ^= x >>> 16;
	return x >>> 0;
}

export const mix = (h: number, v: number) => lowbias32(((h ^ v) + GOLDEN) | 0);

export function draw(
	seed: number,
	moduleKey: number,
	phase: Phase,
	time: number,
	kind: SubjectKind,
	subject: number,
	n: number,
): number {
	let h = mix(seed, moduleKey);
	h = mix(h, phase);
	h = mix(h, time);
	h = mix(h, kind);
	h = mix(h, subject);
	return mix(h, n);
}

export function bounded(h: number, bound: number): number {
	return ((h >>> 16) * bound) >>> 16;
}

export function hashName(name: string): number {
	let h = FNV_OFFSET;
	for (let i = 0; i < name.length; i++)
		h = Math.imul(h ^ name.charCodeAt(i), FNV_PRIME);
	return lowbias32(h);
}
