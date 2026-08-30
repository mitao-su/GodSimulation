import { describe, expect, it } from "vitest";

import { nextDeterministicRandom } from "./deterministic-random";

describe("deterministic random", () => {
  it("produces a stable sequence from a saved state", () => {
    const first = nextDeterministicRandom(1);
    const second = nextDeterministicRandom(first.state);
    const restoredSecond = nextDeterministicRandom(first.state);

    expect(first).toEqual({ state: 270369, value: 270369 });
    expect(second).toEqual({ state: 67634689, value: 67634689 });
    expect(restoredSecond).toEqual(second);
  });

  it("normalizes zero to a non-degenerate seed", () => {
    expect(nextDeterministicRandom(0).state).not.toBe(0);
  });
});
