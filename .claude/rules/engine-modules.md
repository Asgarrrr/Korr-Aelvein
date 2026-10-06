---
paths: ["packages/engine/src/modules/**", "packages/engine/src/content/**", "packages/engine/src/contracts/**"]
---

# Module author checklist

Context, terms and recipes: `engine.md`. Example: `bench/reference/thirst.ts`.

1. Folder `modules/<name>/`: `schema.ts` (entity components; `cells` for
   cell columns), `config.ts`, `index.ts`. Config is read once, frozen,
   and joins the fingerprint.
2. `b.write` gives owned typed arrays, indexed by slot. `b.cells` gives
   owned cell fields: `.read(ctx)` / `.write(ctx)` per callback. `b.read`
   gives a contract view, or `undefined`.
3. Tick: environment work, an inline loop over `q.slots(ctx)`. Propose:
   read-only, `out.push`. Action: returns a cost `>= 1`, `FAIL` or
   `ctx.instead(...)`.
4. Propose goal actions whose target persists (an `EntityId`). Reach
   `ctx.step` / `ctx.idle` / `ctx.travel` only through `instead`. The
   action re-validates its target on every run: it may run cached.
5. `requires` lists every component the action writes or needs on the
   actor. Names come from the own schema, `contracts/` or the core.
6. A second module reads your component: add it to `Contracts`, and the
   owner's `schema` `satisfies Schema & Pick<Contracts, ...>`. For a cell
   column: `CellContracts`, on `cells` (`modules/fire/schema.ts`).
7. Any state in `setup` that outlives a callback (a `let`, a mutated
   array, map or object) passes the lint but breaks save/load. Forbidden.

## What the checks forbid

- `scripts/module-syntax.ts`, in `modules/**`: casts other than
  `as const`; `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`;
  `Object.keys/values/entries/assign/defineProperty...`, `Reflect`,
  `globalThis`, `__proto__`, `.constructor`, `new Proxy`, `eval`,
  `Function(...)`, dynamic `import()`, writes to built-ins; `let` at
  module scope; any `var`.
- `scripts/check-architecture.ts`: import rules, see `CLAUDE.md` § Where
  code goes (Enforcement) and § Engine invariants.
- `scripts/lint/determinism.grit` (engine `src`, `bench`): `Math.random`,
  transcendental `Math`, `Math[key]`, `Date`, `performance.now()`, `crypto`
  random calls. `runtime.grit` (`src`): `Bun`, `process`, `performance`,
  `globalThis`.
- `biome.json`: no Node modules and no magic numbers in engine `src` and
  `bench` (name them, or move them to config); no explicit `any` in
  `modules/**`.

## Skeleton

```ts
// schema.ts
export const schema = { chill: { value: "i16" }, hearth: {} } as const;
// config.ts
export const warmthConfig = {
	perTurn: 2,
	coldAbove: 300,
	max: 1000,
	score: 200,
	cost: 100,
} as const;
// index.ts
import { defineModule, FAIL, NO_CELL, NONE } from "../../core/module/api";
import { warmthConfig } from "./config";
import { schema } from "./schema";

export const warmth = defineModule({
	name: "warmth",
	schema,
	config: warmthConfig,
	setup(b, cfg) {
		const { value } = b.write("chill");
		const cold = b.query(["chill"]);
		const hearths = b.query(["hearth"]);
		b.tick((ctx) => {
			const rows = cold.slots(ctx);
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				value[s] = Math.min(cfg.max, (value[s] ?? 0) + cfg.perTurn);
			}
		});
		const warm = b.action("warm", "entity", ["chill"], (ctx, actor, target) => {
			const h = ctx.slotOf(target);
			if (h === NONE || !hearths.has(h)) return FAIL;
			const dx = Math.abs(ctx.x(h) - ctx.x(actor));
			const dy = Math.abs(ctx.y(h) - ctx.y(actor));
			if (Math.max(dx, dy) > 1) {
				const cell = ctx.approach(actor, ctx.x(h), ctx.y(h));
				// Blocked is not wrong: idle and keep the intent.
				return cell === NO_CELL
					? ctx.instead(ctx.idle, null)
					: ctx.instead(ctx.step, cell);
			}
			value[actor] = 0;
			return cfg.cost;
		});
		b.propose((_ctx, actor, perception, out) => {
			if (!cold.has(actor) || (value[actor] ?? 0) <= cfg.coldAbove) return;
			for (let i = 0; i < perception.count; i++)
				if (hearths.has(perception.slot(i)))
					return out.push(warm, perception.id(i), cfg.score);
		});
	},
});
```
