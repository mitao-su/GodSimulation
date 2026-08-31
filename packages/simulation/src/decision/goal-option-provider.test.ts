import { describe, expect, it } from "vitest";

import { buildGoalOptions } from "./goal-option-provider";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

describe("buildGoalOptions", () => {
  it("does not offer an object the agent has never perceived or remembered", () => {
    const world = simulationTestWorld();

    const options = buildGoalOptions(world, testPluginRegistry, "alice" as never);

    expect(options.map((option) => option.goal)).toEqual([
      { kind: "wait", durationTicks: 600 },
    ]);
  });

  it("offers observation and active interactions for a remembered object", () => {
    const base = simulationTestWorld();
    const alice = base.agents.get("alice" as never)!;
    const rememberedFridge = {
      entityId: "fridge-1" as never,
      displayName: "Fridge",
      status: "available",
      summary: "Available",
      observable: { occupiedBy: null },
      position: { x: 4, y: 1 },
      sourceEventId: "event:memory:fridge-1" as never,
      observedAtTick: 0,
      observationKind: "memory" as const,
    };
    const world = {
      ...base,
      agents: new Map(base.agents).set("alice" as never, {
        ...alice,
        knowledge: {
          ...alice.knowledge,
          objects: new Map([[rememberedFridge.entityId, rememberedFridge]]),
        },
      }),
    };

    const options = buildGoalOptions(world, testPluginRegistry, "alice" as never);

    expect(options.map((option) => option.goal)).toEqual([
      { kind: "wait", durationTicks: 600 },
      { kind: "observe", targetEntityId: "fridge-1" },
      {
        kind: "use_object",
        targetEntityId: "fridge-1",
        interactionId: "use",
      },
    ]);
  });
});
