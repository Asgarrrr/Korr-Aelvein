/**
 * Branded primitive types + their construction factories.
 *
 * THE ONE SANCTIONED `as`. Project rule is no `as` anywhere — it lies to the
 * type system. A brand factory is the single exception, and it lives only in
 * files named `brands.ts`: turning a runtime `number` into a branded `ZoneId`
 * is a widening TS cannot express without an assertion, the assertion is
 * provably safe (it tags a value, changes nothing at runtime), and confining
 * it here keeps the exception greppable to one place. CLAUDE.md § "Code style
 * and types" records the carve-out. No `as` may appear outside a `brands.ts`.
 *
 * Why brand at all: a zone key and (say) an entity id are both `number`
 * structurally — nothing stops passing one where the other is meant. `ZoneId`
 * is the only brand today; `Brand<T, Tag>` is generic so the next one reuses
 * the same machinery. Branding makes a mix a compile error, at zero runtime cost.
 */

// One module-private symbol, distinguished by the `Tag` string, so
// `Brand<number, "ZoneId">` and a future `Brand<number, "EntityId">` are
// distinct and non-forgeable (the symbol can't be named outside this file).
declare const BRAND: unique symbol;
export type Brand<T, Tag extends string> = T & { readonly [BRAND]: Tag };

/** Integer key into `GameState.zones`. */
export type ZoneId = Brand<number, "ZoneId">;

/**
 * Brand a raw number as a `ZoneId`. The trust boundary: call it where an
 * untrusted/plain number first becomes a domain zone key (the WS transport
 * edge, the zone constants in `newGame`). Does not validate that the id
 * exists — that stays a runtime `getZone` concern; this only fixes the type.
 */
export function zoneId(n: number): ZoneId {
  return n as ZoneId;
}
