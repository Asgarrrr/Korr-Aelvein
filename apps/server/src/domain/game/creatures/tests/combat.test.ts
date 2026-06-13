import { describe, expect, test } from "bun:test";
import {
  emptyWorld,
  getComponent,
  isLiveHandle,
  spawn,
} from "../../../ecs/index";
import { createRng } from "../../../rng/index";
import { attack } from "../combat";

describe("attack: damage and kill semantics", () => {
  test("reduces target hp by the rolled damage (1-3 range)", () => {
    const w = emptyWorld();
    const target = spawn(w, { hp: { current: 10, max: 10 } });
    const rng = createRng(42);
    const result = attack(w, rng, target);
    expect(result.damage).toBeGreaterThanOrEqual(1);
    expect(result.damage).toBeLessThanOrEqual(3);
    const hp = getComponent(w, target, "hp");
    expect(hp?.current).toBe(10 - result.damage);
    expect(hp?.max).toBe(10);
  });

  test("clamps hp at 0 on overkill and reports killed=true", () => {
    const w = emptyWorld();
    const target = spawn(w, { hp: { current: 1, max: 5 } });
    const rng = createRng(7);
    const result = attack(w, rng, target);
    expect(result.killed).toBe(true);
    const hp = getComponent(w, target, "hp");
    expect(hp?.current).toBe(0);
    expect(hp?.max).toBe(5);
    // Combat itself never despawns — the caller decides.
    expect(isLiveHandle(w, target)).toBe(true);
  });

  test("damage rolls are deterministic for the same rng state", () => {
    function run(): number {
      const w = emptyWorld();
      const t = spawn(w, { hp: { current: 100, max: 100 } });
      const rng = createRng(1234);
      let total = 0;
      for (let i = 0; i < 10; i++) total += attack(w, rng, t).damage;
      return total;
    }
    expect(run()).toBe(run());
  });

  test("throws when the target has no hp component", () => {
    const w = emptyWorld();
    const target = spawn(w, { position: { x: 0, y: 0 } });
    const rng = createRng(0);
    expect(() => attack(w, rng, target)).toThrow(/hp component/);
  });
});
