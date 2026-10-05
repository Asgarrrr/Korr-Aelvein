declare const entityBrand: unique symbol;
declare const slotBrand: unique symbol;
declare const cellBrand: unique symbol;

export type EntityId = number & { readonly [entityBrand]: true };
export type Slot = number & { readonly [slotBrand]: true };
export type Cell = number & { readonly [cellBrand]: true };

export const NO_ENTITY = 0 as EntityId;
export const NONE = -1 as Slot;
export const NO_CELL = -1 as Cell;
