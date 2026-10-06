import { type Static, Type } from "@sinclair/typebox";

const closed = { additionalProperties: false } as const;
const Delta = Type.Integer({ minimum: -1, maximum: 1 });

export const Move = Type.Object(
	{ type: Type.Literal("move"), dx: Delta, dy: Delta },
	closed,
);
export type Move = Static<typeof Move>;

export const Wait = Type.Object({ type: Type.Literal("wait") }, closed);
export type Wait = Static<typeof Wait>;

export const Eat = Type.Object(
	{
		type: Type.Literal("eat"),
		target: Type.Integer({ minimum: 1, maximum: 2 ** 31 - 1 }),
	},
	closed,
);
export type Eat = Static<typeof Eat>;

export const Command = Type.Union([Move, Wait, Eat]);
export type Command = Static<typeof Command>;

export const Snapshot = Type.Object(
	{
		type: Type.Literal("snapshot"),
		width: Type.Integer(),
		height: Type.Integer(),
		player: Type.Object(
			{
				id: Type.Integer(),
				x: Type.Integer(),
				y: Type.Integer(),
				hp: Type.Integer(),
				satiety: Type.Integer(),
			},
			closed,
		),
		entities: Type.Array(
			Type.Tuple([
				Type.Integer(),
				Type.String(),
				Type.Integer(),
				Type.Integer(),
			]),
		),
	},
	closed,
);
export type Snapshot = Static<typeof Snapshot>;
export type Entity = Snapshot["entities"][number];

export const Over = Type.Object({ type: Type.Literal("over") }, closed);
export type Over = Static<typeof Over>;

export const Rejected = Type.Object(
	{
		type: Type.Literal("rejected"),
		reason: Type.Union([Type.Literal("invalid"), Type.Literal("over")]),
	},
	closed,
);
export type Rejected = Static<typeof Rejected>;

export const ServerMessage = Type.Union([Snapshot, Over, Rejected]);
export type ServerMessage = Static<typeof ServerMessage>;
