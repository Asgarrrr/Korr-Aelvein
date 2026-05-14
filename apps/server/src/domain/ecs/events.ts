// Typed event channels. Channels are defined once (`defineEvent<T>(name)`)
// and used to emit/drain values of type T. Storage is `Map<string, unknown[]>`
// on the World — type T is erased at runtime; the `EventChannel<T>` brand
// (phantom in function position) keeps it invariant at the type level so two
// channels of different T cannot be confused at compile time.
//
// The unknown→T transition at `drain` time is held by a single invariant:
// only `emit<T>` can push into a channel's bucket, and emit constrains the
// input to T. Drain therefore trusts every value in the bucket to be T.
// Expressed via a type predicate (`is T`) — the project's contract for
// crossing types without `as`.

import type { World } from "./world";

export type EventChannel<T> = {
  readonly name: string;
  // Phantom: never set at runtime, never read. T appears in both parameter
  // and return position so that under `strictFunctionTypes` T is invariant —
  // `EventChannel<A>` and `EventChannel<B>` are NOT structurally assignable
  // when A ≠ B, even when one is `unknown`. Without this, the two channels
  // collapse to `{name: string}` and become freely interchangeable.
  readonly _t?: (t: T) => T;
};

export function defineEvent<T>(name: string): EventChannel<T> {
  return { name };
}

export function emit<T>(
  world: World,
  channel: EventChannel<T>,
  event: T,
): void {
  const bucket = world.events.get(channel.name);
  if (bucket === undefined) {
    world.events.set(channel.name, [event]);
    return;
  }
  bucket.push(event);
}

export function drain<T>(world: World, channel: EventChannel<T>): T[] {
  const bucket = world.events.get(channel.name);
  if (bucket === undefined || bucket.length === 0) {
    if (bucket !== undefined) world.events.delete(channel.name);
    return [];
  }
  const out: T[] = [];
  for (const ev of bucket) {
    if (isEventOfChannel(ev, channel)) out.push(ev);
  }
  // Delete the Map entry rather than clearing in place — prevents
  // bucket-name accumulation when channel names are dynamic.
  world.events.delete(channel.name);
  return out;
}

// Trust-by-invariant type predicate. `emit<T>` is the only path into the
// bucket and constrains the value to T; every element is therefore T at
// runtime. This predicate is the single, named site where that invariant
// crosses into the type system.
function isEventOfChannel<T>(
  _value: unknown,
  _channel: EventChannel<T>,
): _value is T {
  return true;
}
