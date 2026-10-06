import { createGame, type EntityId, type World } from "@korr/engine";
import type { Command, ServerMessage, Snapshot } from "@korr/protocol";

export const FLOOR = { width: 16, height: 12 } as const;
export const START = { x: 8, y: 6 } as const;
// Every action costs one turn, so two advances end this round and reach the player in the next.
const MAX_ADVANCES = 8;

export class Session {
	readonly opening: ServerMessage;
	readonly #world: World;
	readonly #player: EntityId;
	#over = false;

	constructor(seed: number) {
		this.#world = createGame({ seed, floors: 1, ...FLOOR, events: false });
		this.#player = this.#world.spawnPlayer(0, "rat", START.x, START.y);
		this.opening = this.#settle();
	}

	handle(command: Command): ServerMessage {
		if (this.#over) return { type: "rejected", reason: "over" };
		if (command.type === "wait") {
			this.#world.input(this.#player, "core/idle", null);
			return this.#settle();
		}
		if (command.dx === 0 && command.dy === 0)
			return { type: "rejected", reason: "invalid" };
		const { x, y } = this.#position();
		const cell = (y + command.dy) * FLOOR.width + (x + command.dx);
		this.#world.input(this.#player, "core/step", cell);
		return this.#settle();
	}

	#settle(): ServerMessage {
		for (let i = 0; i < MAX_ADVANCES; i++) {
			const due = this.#world.advance();
			if (due.includes(this.#player)) return this.#snapshot();
			if (this.#world.locate(this.#player) === "dead") {
				this.#over = true;
				return { type: "over" };
			}
		}
		throw new Error(
			`player ${this.#player} not due after ${MAX_ADVANCES} advances`,
		);
	}

	#position() {
		const at = this.#world.locate(this.#player);
		if (typeof at === "string")
			throw new Error(`player ${this.#player} is ${at}`);
		return at;
	}

	#snapshot(): Snapshot {
		const id = this.#player;
		const { x, y } = this.#position();
		return {
			type: "snapshot",
			...FLOOR,
			player: {
				id,
				x,
				y,
				hp: this.#world.peek("vitality", "hp", id),
				satiety: this.#world.peek("satiety", "value", id),
			},
		};
	}
}
