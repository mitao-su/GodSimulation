import { describe, expect, it } from "vitest";

import { computeVisibleCells } from "./visibility-system";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

describe("computeVisibleCells", () => {
  it("includes the blocking wall but not cells hidden directly behind it", () => {
    const base = simulationTestWorld();
    const alice = base.agents.get("alice" as never)!;
    const world = {
      ...base,
      agents: new Map(base.agents).set("alice" as never, {
        ...alice,
        position: { x: 0, y: 2 },
      }),
    };

    const visible = computeVisibleCells(world, testPluginRegistry, "alice" as never, 6);

    expect(visible.has("2,2")).toBe(true);
    expect(visible.has("3,2")).toBe(false);
    expect(visible.has("4,2")).toBe(false);
  });
});
