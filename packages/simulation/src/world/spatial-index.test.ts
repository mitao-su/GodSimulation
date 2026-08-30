import { describe, expect, it } from "vitest";

import { SpatialIndex } from "./spatial-index";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

describe("SpatialIndex interaction positions", () => {
  it("rotates local interaction offsets with an east-facing object", () => {
    const base = simulationTestWorld();
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set("fridge-1" as never, {
        ...fridge,
        facing: "east" as const,
      }),
    };

    expect(new SpatialIndex(world, testPluginRegistry).interactionPositions(fridge.id)).toEqual([
      { x: 5, y: 1 },
    ]);
  });
});
