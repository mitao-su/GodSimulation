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
      observable: { holder: null },
      interactionAvailability: [],
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

  it("does not offer an interaction the plugin reports as unavailable", () => {
    const base = simulationTestWorld();
    const alice = base.agents.get("alice" as never)!;
    const rememberedFridge = {
      entityId: "fridge-1" as never,
      displayName: "Fridge",
      status: "busy",
      summary: "Used by Bob",
      observable: { holder: "bob" },
      interactionAvailability: [
        {
          interactionId: "use",
          available: false as const,
          reasonCode: "in_use",
          summary: "Already in use",
        },
      ],
      position: { x: 4, y: 1 },
      sourceEventId: "event:memory:fridge-1" as never,
      observedAtTick: 0,
      observationKind: "vision" as const,
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
    ]);
  });
});
