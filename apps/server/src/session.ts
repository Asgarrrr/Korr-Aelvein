import {
	createStarterGame,
	type EntityId,
	starter,
	type World,
} from "@korr/engine";
import type { Command, Entity, ServerMessage, Snapshot } from "@korr/protocol";

// Every action costs one turn, so two advances end this round and reach the player in the next.
const MAX_ADVANCES = 8;

export class Session {
	readonly opening: ServerMessage;
	readonly #world: World;
	readonly #player: EntityId;
	#over = false;

	constructor(seed: number) {
		this.#world = createStarterGame(seed);
		this.#player = this.#world.spawnPlayer(
			0,
			"rat",
			starter.start.x,
			starter.start.y,
		);
		this.opening = this.#settle();
	}

	handle(command: Command): ServerMessage {
		if (this.#over) return { type: "rejected", reason: "over" };
		if (command.type === "wait") {
			this.#world.input(this.#player, "core/idle", null);
			return this.#settle();
		}
		if (command.type === "eat") {
			this.#world.input(this.#player, "hunger/eat", command.target);
			return this.#settle();
		}
		if (command.dx === 0 && command.dy === 0)
			return { type: "rejected", reason: "invalid" };
		const { x, y } = this.#position();
		const cell = (y + command.dy) * starter.width + (x + command.dx);
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
		const entities: Entity[] = [];
		this.#world.entities(0, (other, species, atX, atY) => {
			if (other !== id) entities.push([other, species, atX, atY]);
		});
		return {
			type: "snapshot",
			width: starter.width,
			height: starter.height,
			player: {
				id,
				x,
				y,
				hp: this.#world.peek("vitality", "hp", id),
				satiety: this.#world.peek("satiety", "value", id),
			},
			entities,
		};
	}
}
