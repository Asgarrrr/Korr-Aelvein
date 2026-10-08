import { expect, test } from "bun:test";
import { EventLog } from "../../../src/core/events/events";
import type { EntityId } from "../../../src/core/module/api";

const NO_CAUSE = 0 as EntityId;
const BURST = 5000;

const emit = (log: EventLog, count: number, from = 0) => {
	log.startTurn(0);
	for (let i = 0; i < count; i++) log.emit(0, 1, NO_CAUSE, from + i, 0, 0);
};
const drained = (log: EventLog) => {
	const seen: number[] = [];
	log.drain(0, (_type, _cause, a) => seen.push(a));
	return seen;
};

test("a drained ring far above its last batch shrinks, and still keeps order", () => {
	const log = new EventLog(1, true);
	emit(log, BURST);
	expect(drained(log)).toHaveLength(BURST);
	const burst = log.bytes(0);
	emit(log, 10);
	expect(drained(log)).toEqual(Array.from({ length: 10 }, (_, i) => i));
	expect(log.bytes(0)).toBeLessThan(burst / 4);
	emit(log, BURST, 100);
	expect(drained(log)).toEqual(
		Array.from({ length: BURST }, (_, i) => 100 + i),
	);
});
