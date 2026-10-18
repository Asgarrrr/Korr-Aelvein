import type { ExpressionRow } from "./expression";

// Both rows share their bounds, so hp never exceeds max.
export const rows: readonly ExpressionRow[] = [
	{ gene: "size", component: "vitality", field: "hp", min: 6, max: 40 },
	{ gene: "size", component: "vitality", field: "max", min: 6, max: 40 },
];

const LARGE_FROM = 24;

// vitality.max thresholds: a Look's tier counts those at or below it.
export const tiers: readonly number[] = [LARGE_FROM];
