import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import {
  createSimulationRegistry,
  loadWorldDefinition,
  refreshAllPerceptions,
  type ActiveOperation,
} from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";

const registry = createSimulationRegistry([spatialPlugin, homePlugin, agentsPlugin]);
const fridgeCall: ActiveOperation = {
  callId: "operation-call:alice:fridge" as never,
  operationId: "object.home.refrigerator.use" as never,
  taskOptionId: "task-option:alice:fridge-1:use" as never,
  label: "Use refrigerator",
  taskSlots: ["BODY"],
  arguments: { targetEntityId: "fridge-1", parameters: {} },
  duration: { kind: "fixed", totalTicks: 10 },
  startedAtTick: 0,
  progressTicks: 0,
  state: {},
  plan: {
    currentActionIndex: 0,
    actions: [
      {
        id: "operation-call:alice:fridge:action:0",
        kind: "interact_object",
        purpose: "direct",
        targetEntityId: "fridge-1" as never,
        interactionId: "use",
        durationTicks: 10,
        progressTicks: 0,
        started: false,
      },
    ],
  },
};

function occupiedFridgeWorld() {
  const base = loadWorldDefinition(starterHome, registry, {
    simulationRulesLock: testSimulationRulesLock,
  }).world;
  const fridge = base.objects.get("fridge-1" as never)!;
  const alice = base.agents.get("alice" as never)!;
  return {
    ...base,
    objects: new Map(base.objects).set("fridge-1" as never, {
      ...fridge,
      version: 1,
      state: { occupiedBy: "bob" },
    }),
    agents: new Map(base.agents).set("alice" as never, {
      ...alice,
      taskTracks: {
        HEAD: { kind: "empty" as const },
        BODY: { kind: "operation" as const, callId: fridgeCall.callId },
      },
      activeOperations: new Map([[fridgeCall.callId, fridgeCall]]),
    }),
  };
}

function refreshAlice(world: ReturnType<typeof occupiedFridgeWorld>) {
  const result = refreshAllPerceptions(world, registry);
  const agent = result.world.agents.get("alice" as never)!;
  const conflict = result.conflicts.find((item) => item.agentId === agent.id)?.reason ?? null;
  return {
    agent,
    knowledge: agent.knowledge,
    memories: agent.memories,
    conflict,
    decisionRequested: conflict !== null,
  };
}

describe("perceived refrigerator conflict", () => {
  it("does not reveal occupancy through the wall", () => {
    const update = refreshAlice(occupiedFridgeWorld());

    expect(
      update.knowledge.objects
        .get("fridge-1" as never)
        ?.interactionAvailability.some(
          (availability) =>
            availability.interactionId === "use" && !availability.available,
        ),
    ).not.toBe(true);
    expect(update.decisionRequested).toBe(false);
  });

  it("requests thought only after Alice sees Bob's occupancy", () => {
    const hidden = refreshAlice(occupiedFridgeWorld());
    const alice = hidden.agent;
    const visibleWorld = {
      ...occupiedFridgeWorld(),
      agents: new Map(occupiedFridgeWorld().agents).set("alice" as never, {
        ...alice,
        position: { x: 14, y: 3 },
      }),
    };
    const visible = refreshAlice(visibleWorld);

    expect(
      visible.knowledge.objects.get("fridge-1" as never)?.interactionAvailability,
    ).toContainEqual({
      interactionId: "use",
      available: false,
      reasonCode: "occupied",
      summary: "Refrigerator used by bob",
    });
    expect(
      visible.memories.find(
        (memory) =>
          memory.relatedEntityId === ("fridge-1" as never) &&
          memory.observationKind === "vision",
      ),
    ).toMatchObject({
      observationKind: "vision",
      relatedEntityId: "fridge-1",
    });
    expect(visible.decisionRequested).toBe(true);
    expect(visible.conflict?.code).toBe("perceived_goal_conflict");
  });
});
