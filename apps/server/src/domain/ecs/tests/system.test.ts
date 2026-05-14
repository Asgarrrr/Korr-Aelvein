import { describe, expect, test } from "bun:test";
import { createRng } from "../../rng/index";
import {
  emptyWorld,
  query,
  runSystems,
  type System,
  setComponent,
  spawn,
} from "../index";

describe("runSystems", () => {
  test("calls nothing when no systems are registered", () => {
    const w = emptyWorld();
    const rng = createRng(1);
    runSystems(w, [], { rng, tick: 0 });
    // World is unchanged.
    expect(w.position.dense.length).toBe(0);
  });

  test("invokes systems left-to-right", () => {
    const trace: string[] = [];
    const a: System = () => {
      trace.push("a");
    };
    const b: System = () => {
      trace.push("b");
    };
    const c: System = () => {
      trace.push("c");
    };
    runSystems(emptyWorld(), [a, b, c], { rng: createRng(1), tick: 0 });
    expect(trace).toEqual(["a", "b", "c"]);
  });

  test("each system observes mutations made by the previous one", () => {
    const move: System = (w) => {
      for (const [h, e] of query(w, ["position"])) {
        setComponent(w, h, "position", {
          x: e.position.x + 1,
          y: e.position.y,
        });
      }
    };
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    runSystems(w, [move, move, move], { rng: createRng(1), tick: 0 });
    // 3 invocations × +1 each = +3.
    const final = collect(query(w, ["position"]));
    expect(final[0]?.[1].position).toEqual({ x: 3, y: 0 });
    expect(h.id).toBe(0);
  });

  test("ctx is the same reference across all systems in a tick", () => {
    const seen: number[] = [];
    const probe: System = (_, ctx) => {
      seen.push(ctx.tick);
    };
    runSystems(emptyWorld(), [probe, probe, probe], {
      rng: createRng(1),
      tick: 42,
    });
    expect(seen).toEqual([42, 42, 42]);
  });
});

function collect<T>(g: Iterable<T>): T[] {
  const out: T[] = [];
  for (const v of g) out.push(v);
  return out;
}
