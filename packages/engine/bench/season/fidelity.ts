// The sample size KS_REJECT holds for.
export const KS_SEEDS = 30;
// c(alpha) * sqrt(2 / n) * n = 12.6 at alpha = 0.01 per metric, about 0.05 after Bonferroni
// over 5-6 metrics; D * n is an integer, so 13 is the first rejected value.
export const KS_REJECT = 13;

// The two-sample Kolmogorov-Smirnov statistic D, times n, for two samples of size n.
export function ksStatistic(a: Int32Array, b: Int32Array): number {
	const n = a.length;
	if (b.length !== n)
		throw new Error(`KS samples differ in size: ${n} and ${b.length}`);
	const x = a.slice().sort();
	const y = b.slice().sort();
	let i = 0;
	let j = 0;
	let d = 0;
	while (i < n && j < n) {
		const v = Math.min(x[i] ?? 0, y[j] ?? 0);
		while (i < n && x[i] === v) i++;
		while (j < n && y[j] === v) j++;
		d = Math.max(d, Math.abs(i - j));
	}
	return d;
}
