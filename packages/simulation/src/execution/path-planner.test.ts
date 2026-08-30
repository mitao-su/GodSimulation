import { describe, expect, it } from "vitest";

import { findPath } from "./path-planner";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

describe("findPath", () => {
  it("finds a four-way path that does not cross a wall", () => {
    const world = simulationTestWorld();
    const result = findPath(
      world,
      testPluginRegistry,
      "alice" as never,
      [{ x: 0, y: 2 }],
      { knownLockedDoorIds: new Set() },
    );

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.path[0]).toEqual({ x: 3, y: 2 });
    expect(result.path.at(-1)).toEqual({ x: 0, y: 2 });
    expect(result.path).not.toContainEqual({ x: 2, y: 2 });
  });

  it("reports no path when every route is blocked", () => {
    const world = simulationTestWorld();
    const result = findPath(
      world,
      testPluginRegistry,
      "alice" as never,
      [{ x: 2, y: 2 }],
      { knownLockedDoorIds: new Set() },
    );

    expect(result).toEqual({ kind: "not_found" });
  });
});
