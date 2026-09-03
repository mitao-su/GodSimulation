import { describe, expect, it } from "vitest";

import type { EntityId } from "@god-sim/protocol";

import { buildTaskOptions } from "./operation-catalog";
import {
  simulationTestWorld,
  testPluginRegistry,
} from "../testing/simulation-test-fixtures";

function withKnownFridge(options: { readonly visible: boolean; readonly inRange: boolean }) {
  const base = simulationTestWorld();
  const aliceId = "alice" as never;
  const alice = base.agents.get(aliceId)!;
  const fridgeId = "fridge-1" as EntityId;
  const knownFridge = {
    entityId: fridgeId,
    displayName: "Fridge",
    status: "available",
    summary: "Available",
    observable: { holder: null },
    interactionAvailability: [],
    position: { x: 4, y: 1 },
    sourceEventId: "event:memory:fridge-1" as never,
    observedAtTick: 0,
    observationKind: "vision" as const,
  };
  return {
    ...base,
    agents: new Map(base.agents).set(aliceId, {
      ...alice,
      position: options.inRange ? { x: 4, y: 2 } : alice.position,
      knowledge: {
        ...alice.knowledge,
        objects: new Map([[fridgeId, knownFridge]]),
        visibleEntityIds: options.visible ? new Set([fridgeId]) : new Set(),
      },
    }),
  };
}

describe("operation task option catalog", () => {
  it("always offers one stable empty task per track", () => {
    const options = buildTaskOptions(
      simulationTestWorld(),
      testPluginRegistry,
      "alice" as never,
    );

    expect(
      options
        .filter((option) => option.kind === "empty")
        .map((option) => option.taskSlots),
    ).toEqual([["HEAD"], ["BODY"]]);
  });

  it("offers a separate move but no remote object interaction", () => {
    const options = buildTaskOptions(
      withKnownFridge({ visible: true, inRange: false }),
      testPluginRegistry,
      "alice" as never,
    );

    expect(
      options.find(
        (option) =>
          option.kind === "operation" && option.operationId === "core.move",
      ),
    ).toMatchObject({
      taskSlots: ["BODY"],
      fixedArguments: { targetEntityId: "fridge-1" },
    });
    expect(
      options.find(
        (option) =>
          option.kind === "operation" &&
          option.operationId === "object.test.fridge.use",
      ),
    ).toBeUndefined();
  });

  it("offers an object interaction only after reaching interaction range", () => {
    const options = buildTaskOptions(
      withKnownFridge({ visible: true, inRange: true }),
      testPluginRegistry,
      "alice" as never,
    );

    expect(
      options.find(
        (option) =>
          option.kind === "operation" &&
          option.operationId === "object.test.fridge.use",
      ),
    ).toMatchObject({
      taskSlots: ["BODY"],
      fixedArguments: { targetEntityId: "fridge-1" },
    });
    expect(
      options.find(
        (option) =>
          option.kind === "operation" && option.operationId === "core.move",
      ),
    ).toBeUndefined();
  });

  it("offers observation on HEAD only for a currently visible target", () => {
    const hidden = buildTaskOptions(
      withKnownFridge({ visible: false, inRange: false }),
      testPluginRegistry,
      "alice" as never,
    );
    const visible = buildTaskOptions(
      withKnownFridge({ visible: true, inRange: false }),
      testPluginRegistry,
      "alice" as never,
    );

    expect(
      hidden.some(
        (option) =>
          option.kind === "operation" && option.operationId === "core.observe",
      ),
    ).toBe(false);
    expect(
      visible.find(
        (option) =>
          option.kind === "operation" && option.operationId === "core.observe",
      ),
    ).toMatchObject({ taskSlots: ["HEAD"] });
  });

  it("does not offer a plugin interaction known to be unavailable", () => {
    const base = withKnownFridge({ visible: true, inRange: true });
    const aliceId = "alice" as never;
    const alice = base.agents.get(aliceId)!;
    const fridgeId = "fridge-1" as EntityId;
    const known = alice.knowledge.objects.get(fridgeId)!;
    const world = {
      ...base,
      agents: new Map(base.agents).set(aliceId, {
        ...alice,
        knowledge: {
          ...alice.knowledge,
          objects: new Map(alice.knowledge.objects).set(fridgeId, {
            ...known,
            interactionAvailability: [
              {
                interactionId: "use",
                available: false as const,
                reasonCode: "occupied",
                summary: "Fridge occupied",
              },
            ],
          }),
        },
      }),
    };

    expect(
      buildTaskOptions(world, testPluginRegistry, aliceId).some(
        (option) =>
          option.kind === "operation" &&
          option.operationId === "object.test.fridge.use",
      ),
    ).toBe(false);
  });
});
