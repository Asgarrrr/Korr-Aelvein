import { expect, test } from "bun:test";
import { type Cell, type EntityId, NONE } from "../../../src/core/api";
import { CAP } from "../../../src/core/config";
import { ALIVE, PLAYER } from "../../../src/core/ecs/storage";
import type { Engine } from "../../../src/core/engine";
import { kill, spawn } from "../../../src/core/lifecycle/lifecycle";
import { saveFloor } from "../../../src/core/persistence/image";
import { saveWorld } from "../../../src/core/persistence/save";
import { loadFloor } from "../../../src/core/persistence/validate";
import { createEngine } from "../../../src/core/setup/registration";
import { ENTRY_HEAD } from "../../../src/core/travel/inbox";
import { advance, playerTurn } from "../../../src/core/turns/round";
import { loadEngine } from "../../../src/core/world";
import { game } from "../../fixtures";

const FLOORS = 3;
const SIDE = 12;

// Recounted from the raw inbox words, not from the inbox's own count.
function transitPlayers(e: Engine, floor: number): number {
	const { inbox } = e;
	let players = 0;
	const list = inbox.words(floor);
	for (let i = 0; i < inbox.count(floor); i++)
		if (((list[i * inbox.width + ENTRY_HEAD] ?? 0) & PLAYER) !== 0) players++;
	return players;
}

function rowPlayers(e: Engine, floor: number): number {
	const { storage } = e;
	let players = 0;
	const end = floor * CAP + (storage.highWater[floor] ?? 0);
	for (let s = floor * CAP; s < end; s++)
		if (
			((storage.masks[s * storage.maskWords] ?? 0) & (ALIVE | PLAYER)) ===
			(ALIVE | PLAYER)
		)
			players++;
	return players;
}

test("each floor's player tallies equal its player rows and the players in its inbox", () => {
	let inTransit = 0;
	const expectTally = (e: Engine) => {
		for (let f = 0; f < FLOORS; f++) {
			const rows = rowPlayers(e, f);
			const transit = transitPlayers(e, f);
			expect(e.players[f]).toBe(rows);
			expect(e.inbox.players(f)).toBe(transit);
			expect((e.players[f] ?? 0) + e.inbox.players(f)).toBe(rows + transit);
			inTransit += transit;
		}
	};
	const e = createEngine(
		{
			seed: 7,
			floors: FLOORS,
			width: SIDE,
			height: SIDE,
			popCap: CAP,
			events: true,
		},
		game.modules,
		game.species,
	);
	const stairs: EntityId[][] = [];
	for (let f = 0; f < FLOORS; f++) {
		const here: EntityId[] = [];
		const link = (floor: number, x: number, y: number) => ({
			actor: false,
			components: { link: { floor, x, y } },
		});
		if (f < FLOORS - 1) here.push(spawn(e, f, link(f + 1, 2, 9), 9, 2));
		if (f > 0) here.push(spawn(e, f, link(f - 1, 9, 2), 2, 9));
		stairs.push(here);
		for (let i = 0; i < 6; i++) spawn(e, f, "rat", i, 6);
	}
	const players = [
		spawn(e, 0, "rat", 8, 2, true),
		spawn(e, 1, "rat", 8, 3, true),
		spawn(e, 2, "rat", 3, 9, true),
	];
	expectTally(e);
	const travel = e.actionByName.get("core/travel") ?? 0;
	let departures = 0;
	let killed = 0;
	// Loads at round boundaries while players are on their way: load rebuilds both tallies.
	let reloads = 0;
	for (let round = 0; round < 40; round++) {
		for (let due = advance(e); due.length > 0; due = advance(e))
			for (const id of due) {
				const floor = e.storage.floorOf(id);
				const slot = e.storage.slotOf(floor, id);
				const { x, y } = e.grid;
				const near = stairs[floor]?.find((s) => {
					const t = e.storage.slotOf(floor, s);
					const d = Math.max(
						Math.abs((x[t] ?? 0) - (x[slot] ?? 0)),
						Math.abs((y[t] ?? 0) - (y[slot] ?? 0)),
					);
					return d <= 1;
				});
				if (near === undefined) playerTurn(e, floor, slot, e.idleIndex, 0);
				else {
					playerTurn(e, floor, slot, travel, near);
					if (e.storage.floorOf(id) < 0) departures++;
				}
				expectTally(e);
			}
		expectTally(e);
		if (e.inbox.players(0) + e.inbox.players(1) + e.inbox.players(2) > 0) {
			reloads++;
			for (const check of ["fast", "full"] as const) {
				expectTally(loadEngine(saveWorld(e), { ...game, check }));
				for (let f = 0; f < FLOORS; f++)
					loadFloor(e, saveFloor(e, f), f, check);
				expectTally(e);
			}
		}
		if (round % 10 === 5) {
			const victim = players.find((p) => e.storage.floorOf(p) >= 0);
			if (victim !== undefined) {
				kill(e, e.storage.floorOf(victim), victim, 0 as EntityId);
				killed++;
			}
			const floor = round % FLOORS;
			let cell = 0;
			while (e.grid.holdsOtherActor(floor, cell as Cell, NONE)) cell++;
			players.push(
				spawn(e, floor, "rat", cell % SIDE, (cell / SIDE) | 0, true),
			);
			expectTally(e);
		}
	}
	expect(departures).toBeGreaterThan(4);
	expect(killed).toBeGreaterThan(0);
	expect(inTransit).toBeGreaterThan(0);
	expect(reloads).toBeGreaterThan(0);
});
