/**
 * Pure snapshot→ASCII converter. Extracted from `Game.tsx`'s subscription
 * handler so it can be benched + tested in isolation. The client component
 * still does the React state update; this module only owns the layout.
 *
 * Contract: `renderGrid(input)` returns a `\n`-joined string of `height`
 * rows, each `width` chars wide. Glyph priority per cell: player > mob >
 * tile (wall `#`, floor `.`, door `+`, never-seen fog ` `).
 *
 * Implementation notes (see `bench/render.variants.bench.ts` for the
 * measured comparison):
 *
 *   - **Flat mob index** instead of `Map<string, string>`. The previous
 *     `Map.set(`${x},${y}`, glyph)` per mob + `Map.get(`${x},${y}`)` per
 *     cell was the dominant cost — every iteration allocated a template-
 *     literal key, hashed it, then looked it up. Flat `Array<string |
 *     undefined>` indexed by `y * width + x` removes the alloc + hash. On
 *     its own (V2 in the variant bench) this alone wins ~80 % across all
 *     grid sizes.
 *
 *   - **Uint8Array char-code buffer** instead of `row +=` + `rows.join`.
 *     Writes char codes (numbers) into a single pre-allocated buffer,
 *     decodes once at the end via `TextDecoder`. No intermediate string
 *     allocs. Compounds with the flat mob index to land V0→production at
 *     ~95 % under baseline (S2 donjon 80×30: 65 µs → 3 µs).
 *
 * Glyph constraint: mob glyphs must be single ASCII chars (the current
 * `@` / `r` / `v` / `x` set qualifies). Multi-byte glyphs (e.g. emoji)
 * would be silently truncated to their first code unit. Add a server-side
 * guard if that constraint ever becomes load-bearing for gameplay.
 */

import type { WireTile } from "server";

export type RenderInput = {
  readonly width: number;
  readonly height: number;
  /**
   * Row-major tile array, length `width × height`. Values: 0 wall, 1 floor,
   * 2 door — matching the server's `TILE_*` constants — plus the wire-only
   * 255 (never-seen fog, `TILE_UNSEEN` in the server's app.ts). Accepts the
   * plain-array form the WS snapshot ships (TypeBox round-trips Uint8Array
   * as `number[]`).
   */
  readonly tiles: ReadonlyArray<number>;
  readonly player: { readonly x: number; readonly y: number };
  readonly mobs: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly glyph: string;
  }>;
};

// ASCII char codes for the tile/entity glyphs the renderer emits.
const CODE_WALL = 35; // '#'
const CODE_FLOOR = 46; // '.'
const CODE_DOOR = 43; // '+'
const CODE_PLAYER = 64; // '@'
const CODE_SPACE = 32; // ' ' — fog (never-seen tile)
const CODE_NL = 10; // '\n'

/**
 * Wire sentinel for a never-seen tile. Typed `WireTile` (the server's wire
 * union, consumed type-only via Eden) so a drift in the server's
 * `TILE_UNSEEN` becomes a client compile error here — not a silent repaint
 * of the whole fog as `#`. Must be branched explicitly: the tile
 * fallthrough renders any unhandled value as a wall.
 */
const TILE_UNSEEN: WireTile = 255;
// Wire tile values branched explicitly below; typed `WireTile` so a drift in
// the server's tile union surfaces here. Wall (0) is the fallthrough default.
const TILE_FLOOR: WireTile = 1;
const TILE_DOOR: WireTile = 2;

// One decoder for the module's lifetime — `decode` without `{ stream: true }`
// resets its internal state each call, and `renderGrid` is synchronous, so the
// shared instance is safe and skips a per-frame allocation. (Stays safe as long
// as no caller ever passes `{ stream: true }` to this instance.)
const DECODER = new TextDecoder();

export function renderGrid(input: RenderInput): string {
  const { width, height, tiles, player, mobs } = input;
  // Flat mob index: `Array<string | undefined>` keyed by `y * width + x`.
  // `new Array(N)` leaves slots `undefined`; we only assign the mob cells.
  const mobByCell: Array<string | undefined> = new Array(width * height);
  for (const m of mobs) mobByCell[m.y * width + m.x] = m.glyph;

  // Pre-sized output buffer: `width × height` cells + `(height - 1)` row
  // separators. Single alloc, no growth.
  const buf = new Uint8Array(width * height + Math.max(0, height - 1));
  let idx = 0;
  for (let y = 0; y < height; y++) {
    if (y > 0) {
      buf[idx] = CODE_NL;
      idx += 1;
    }
    for (let x = 0; x < width; x++) {
      let code: number;
      if (x === player.x && y === player.y) {
        code = CODE_PLAYER;
      } else {
        const cellIdx = y * width + x;
        const mob = mobByCell[cellIdx];
        if (mob !== undefined) {
          code = mob.charCodeAt(0) ?? CODE_WALL;
        } else {
          const t = tiles[cellIdx] ?? 0;
          // No visible-vs-remembered distinction in monochrome ASCII —
          // both render at full brightness until the Canvas renderer dims
          // memory. Fog alone is blank; wall (0) + any unhandled value is `#`.
          switch (t) {
            case TILE_UNSEEN:
              code = CODE_SPACE;
              break;
            case TILE_FLOOR:
              code = CODE_FLOOR;
              break;
            case TILE_DOOR:
              code = CODE_DOOR;
              break;
            default:
              code = CODE_WALL;
          }
        }
      }
      buf[idx] = code;
      idx += 1;
    }
  }
  return DECODER.decode(buf);
}
