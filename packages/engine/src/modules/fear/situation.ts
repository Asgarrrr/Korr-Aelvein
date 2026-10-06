import {
	type Builder,
	type Candidates,
	type Cell,
	type EntityId,
	NO_CELL,
	NO_ENTITY,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import type { fearConfig } from "./config";
import type { cells, schema } from "./schema";

export type FearBuilder = Builder<typeof schema, typeof cells>;
export type FearConfig = typeof fearConfig;

// What one proposal derived for its actor. Read only after a fill that returned true,
// which writes every field.
export interface Situation {
	threat: EntityId;
	close: boolean;
	heated: boolean;
	escape: Cell;
}

export type Proposal = (
	ctx: ReadCtx,
	actor: Slot,
	s: Situation,
	out: Candidates,
) => void;

export const newSituation = (): Situation => ({
	threat: NO_ENTITY,
	close: false,
	heated: false,
	escape: NO_CELL,
});

// A burning cell next door is always a threat, so no radius lets a creature step into fire.
export const fireReach = (cfg: FearConfig): number =>
	Math.max(cfg.fireRadius, 1);
