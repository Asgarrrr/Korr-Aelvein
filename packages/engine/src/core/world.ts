import type { AnyModule } from "./api";
import { CAP, MAX_COORD, MAX_FLOORS, MAX_SEED } from "./config";
import type { EntityId } from "./ecs/ids";
import { INDEX_SIZE } from "./ecs/storage";
import { type Engine, FLOOR_STAGE } from "./engine";
import type { EventVisitor } from "./events/events";
import { GameWorld } from "./game-world";
import type { ComponentName, FieldName, Species } from "./lifecycle/species";
import { worldDigest } from "./persistence/hash";
import { identityProblem } from "./persistence/identity";
import { FLOOR_HEADER, readFloor, STAGE, SUM } from "./persistence/image";
import { readWorld } from "./persistence/save";
import { checkFloor, type LoadCheck } from "./persistence/validate";
import { createEngine } from "./setup/registration";

export interface WorldOptions<M extends readonly AnyModule[]> {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap?: number;
	readonly events?: boolean;
	readonly audit?: boolean;
	readonly modules: M;
	readonly species?: Readonly<Record<string, Species<M>>>;
	// A permutation of the floors, the order they run in within a round. Tests only: no
	// order may change the result.
	readonly floorOrder?: readonly number[];
}

export type Location =
	| { readonly floor: number; readonly x: number; readonly y: number }
	| "transit"
	| "dead";

export interface InputRecord {
	readonly round: number;
	readonly time: number;
	readonly player: EntityId;
	// As played: replaying a record is world.input(player, action, target).
	readonly action: string;
	readonly target: number | null;
}

export type { LoadCheck } from "./persistence/validate";

// "fast" only for images this server wrote and kept since; "full" for anything else, after a
// crash, and in tests. Both refuse a bad checksum; behind a good one, "fast" still refuses slots
// and cells off the floor, actors due outside [now, MAX_TICK] and stairs leading nowhere.
export interface LoadOptions {
	readonly check?: LoadCheck;
}

export interface World<M extends readonly AnyModule[]> {
	// `values` override the species' own for this entity. A registered component the species
	// lacks throws; one no module registers is skipped, as in a shape.
	spawn(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: Species<M>["components"],
	): EntityId;
	spawnPlayer(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: Species<M>["components"],
	): EntityId;
	// Throws when a player becomes due: a world with players moves through advance and input.
	runRounds(n: number): void;
	// Runs every floor until its round ends or a player on it is due, and returns the due
	// players. Empty means the round ended everywhere; the next call starts the next round.
	advance(): readonly EntityId[];
	// One decision for a due player, by registered action name ("core/step"). An unknown name
	// or a target the action cannot take is recorded and played as core/idle.
	input(player: EntityId, action: string, target: number | null): void;
	inputs(): readonly InputRecord[];
	alive(id: EntityId): boolean;
	// "dead" also covers an id never issued.
	locate(id: EntityId): Location;
	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number;
	hash(): string;
	// Writes into `into` when it is word-aligned and large enough: the result aliases it, so the
	// next save into it overwrites this image. Otherwise a fresh array: compare result.buffer.
	saveFloor(floor: number, into?: Uint8Array): Uint8Array;
	// Replaces one floor with an image saved at this same point of this world's run.
	loadFloor(floor: number, bytes: Uint8Array, options?: LoadOptions): void;
	save(): Uint8Array;
	// The visitor runs once per event, oldest first; the floor's events are gone afterwards.
	drainEvents(floor: number, visit: EventVisitor): void;
	eventType(name: string): number;
	setEvents(floor: number, on: boolean): void;
}

function build(options: WorldOptions<readonly AnyModule[]>): Engine {
	const { seed, floors, width, height } = options;
	const popCap = options.popCap ?? CAP;
	if (!(Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED))
		throw new Error(`seed ${seed} is not a u32`);
	if (!(Number.isInteger(floors) && floors >= 1 && floors <= MAX_FLOORS))
		throw new Error(`floors ${floors} outside [1, ${MAX_FLOORS}]`);
	for (const side of [width, height])
		if (!(Number.isInteger(side) && side >= 1 && side <= MAX_COORD))
			throw new Error(`floor side ${side} outside [1, ${MAX_COORD}]`);
	if (!(Number.isInteger(popCap) && popCap >= 1 && popCap <= CAP))
		throw new Error(`popCap ${popCap} outside [1, ${CAP}]`);
	const order = options.floorOrder;
	if (
		order !== undefined &&
		!(
			order.length === floors &&
			[...order].sort((a, b) => a - b).every((f, i) => f === i)
		)
	)
		throw new Error(`floor order ${order} is not a permutation of the floors`);
	const engine = createEngine(
		{
			seed,
			floors,
			width,
			height,
			popCap,
			events: options.events ?? true,
			audit: options.audit ?? false,
		},
		options.modules,
		options.species,
	);
	if (order !== undefined) engine.floorOrder = [...order];
	return engine;
}

export function createWorld<const M extends readonly AnyModule[]>(
	options: WorldOptions<M>,
): World<M> {
	return new GameWorld<M>(build(options));
}

type LoadTable<M extends readonly AnyModule[]> = {
	readonly modules: M;
	readonly species?: Readonly<Record<string, Species<M>>>;
} & LoadOptions;

export function loadWorld<const M extends readonly AnyModule[]>(
	bytes: Uint8Array,
	options: LoadTable<M>,
): World<M> {
	return new GameWorld<M>(loadEngine(bytes, options));
}

// The World keeps its engine private: tests that inspect a loaded engine start here.
export function loadEngine<const M extends readonly AnyModule[]>(
	bytes: Uint8Array,
	options: LoadTable<M>,
): Engine {
	const { header, hash, images } = readWorld(bytes);
	const { round, events, ...shape } = header;
	const { check = "full", modules, species } = options;
	const engine = build({
		...shape,
		modules,
		...(species === undefined ? {} : { species }),
	});
	const indexes = images.map(() => new Int32Array(INDEX_SIZE));
	const sums = new Int32Array(2 * images.length);
	const players = new Int32Array(images.length);
	images.forEach((image, f) => {
		players[f] = checkFloor(
			engine,
			image,
			f,
			round,
			indexes[f] as Int32Array,
			check,
		);
		const words = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
		sums[2 * f] = words[SUM] ?? 0;
		sums[2 * f + 1] = words[SUM + 1] ?? 0;
	});
	worldDigest(engine.sum, header, events, sums, engine.digest);
	if (engine.digest[0] !== hash[0] || engine.digest[1] !== hash[1])
		throw new Error("save file: contents do not match its hash");
	const started = images.map(
		(image) =>
			new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER)[STAGE] !==
			FLOOR_STAGE.waiting,
	);
	if (started.some((s) => s !== started[0]))
		throw new Error(
			"save file: some floors started the round and some did not",
		);
	images.forEach((image, f) => {
		readFloor(engine, image, indexes[f] as Int32Array, players[f] ?? 0);
	});
	// Across floors as within one: the fast check takes the world hash as proof the engine wrote it.
	const problem = check !== "fast" ? identityProblem(engine) : undefined;
	if (problem !== undefined) throw new Error(`save file: ${problem}`);
	engine.round = round;
	engine.events.enabled.set(events);
	return engine;
}
