import { lowbias32 } from "./rng";

const LANES = 8;
const LANE_MASK = LANES - 1;
const WORD_BITS = 32;
const SEED_0 = 0x9e3779b1;
const SEED_1 = 0x85ebca77;
const SEED_2 = 0xc2b2ae3d;
const SEED_3 = 0x27d4eb2f;
const SEED_4 = 0x165667b1;
const SEED_5 = 0xd3a2646c;
const SEED_6 = 0xfd7046c5;
const SEED_7 = 0xb55a4f09;
const SEEDS = [SEED_0, SEED_1, SEED_2, SEED_3, SEED_4, SEED_5, SEED_6, SEED_7];
const MUL_A = 0xcc9e2d51;
const MUL_B = 0x1b873593;
const MUL_C = 0x85ebca6b;
const MUL_D = 0xc2b2ae35;
const ROT_A = 13;
const ROT_B = 15;
const ROT_E = 17;
const ROT_F = 11;
const MULS = Int32Array.from([
	MUL_A,
	MUL_B,
	MUL_C,
	MUL_D,
	MUL_A,
	MUL_B,
	MUL_C,
	MUL_D,
]);
const ROTS = Int32Array.from([
	ROT_A,
	ROT_B,
	ROT_A,
	ROT_B,
	ROT_E,
	ROT_F,
	ROT_E,
	ROT_F,
]);
const L1 = 1;
const L2 = 2;
const L3 = 3;
const L4 = 4;
const L5 = 5;
const L6 = 6;
const L7 = 7;

// Word i goes to lane i mod 8: independent multiply chains run in parallel, which keeps a
// full-floor check inside the restore budget.
export class Checksum {
	private readonly lanes = Int32Array.from(SEEDS);
	private n = 0;

	reset(): void {
		this.lanes.set(SEEDS);
		this.n = 0;
	}

	word(v: number): void {
		const lane = this.n & LANE_MASK;
		this.n++;
		const x = Math.imul((this.lanes[lane] ?? 0) ^ v, MULS[lane] ?? 0);
		const r = ROTS[lane] ?? 0;
		this.lanes[lane] = (x << r) | (x >>> (WORD_BITS - r));
	}

	words(src: Int32Array, from: number, count: number): void {
		let i = from;
		const end = from + count;
		while (i < end && (this.n & LANE_MASK) !== 0) this.word(src[i++] ?? 0);
		const start = i;
		const whole = i + ((end - i) & ~LANE_MASK);
		const lanes = this.lanes;
		let a = lanes[0] ?? 0;
		let b = lanes[L1] ?? 0;
		let c = lanes[L2] ?? 0;
		let d = lanes[L3] ?? 0;
		let e = lanes[L4] ?? 0;
		let f = lanes[L5] ?? 0;
		let g = lanes[L6] ?? 0;
		let h = lanes[L7] ?? 0;
		for (; i < whole; i += LANES) {
			a = Math.imul(a ^ (src[i] ?? 0), MUL_A);
			a = (a << ROT_A) | (a >>> (WORD_BITS - ROT_A));
			b = Math.imul(b ^ (src[i + L1] ?? 0), MUL_B);
			b = (b << ROT_B) | (b >>> (WORD_BITS - ROT_B));
			c = Math.imul(c ^ (src[i + L2] ?? 0), MUL_C);
			c = (c << ROT_A) | (c >>> (WORD_BITS - ROT_A));
			d = Math.imul(d ^ (src[i + L3] ?? 0), MUL_D);
			d = (d << ROT_B) | (d >>> (WORD_BITS - ROT_B));
			e = Math.imul(e ^ (src[i + L4] ?? 0), MUL_A);
			e = (e << ROT_E) | (e >>> (WORD_BITS - ROT_E));
			f = Math.imul(f ^ (src[i + L5] ?? 0), MUL_B);
			f = (f << ROT_F) | (f >>> (WORD_BITS - ROT_F));
			g = Math.imul(g ^ (src[i + L6] ?? 0), MUL_C);
			g = (g << ROT_E) | (g >>> (WORD_BITS - ROT_E));
			h = Math.imul(h ^ (src[i + L7] ?? 0), MUL_D);
			h = (h << ROT_F) | (h >>> (WORD_BITS - ROT_F));
		}
		lanes[0] = a;
		lanes[L1] = b;
		lanes[L2] = c;
		lanes[L3] = d;
		lanes[L4] = e;
		lanes[L5] = f;
		lanes[L6] = g;
		lanes[L7] = h;
		this.n += whole - start;
		while (i < end) this.word(src[i++] ?? 0);
	}

	digest(out: Int32Array, at: number): void {
		const lanes = this.lanes;
		let first = lowbias32(this.n);
		let second = first;
		for (let lane = 0; lane < LANES; lane++) {
			first = lowbias32(first ^ (lanes[lane] ?? 0));
			second = lowbias32((second + first) | 0);
		}
		out[at] = first;
		out[at + 1] = second;
	}
}
