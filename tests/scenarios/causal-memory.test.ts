import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import { type DomainEvent, type TaskOption } from "@god-sim/protocol";
import {
  createSimulation,
  createSimulationRegistry,
  prepareOperationCall,
  restoreWorldSnapshot,
  runTickPipeline,
  type SimulationEngine,
} from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";
import {
  adoptTask,
  releaseCommand,
  selectWait,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

interface CausalSnapshotAgent {
  readonly id: string;
  readonly memories: ReadonlyArray<{
    readonly sourceEventId: string;
    readonly observationKind: string;
  }>;
  readonly knowledge: {
    readonly objects: ReadonlyArray<{ readonly sourceEventId: string }>;
    readonly agents: ReadonlyArray<{ readonly sourceEventId: string }>;
  };
}

function snapshotAgents(engine: SimulationEngine): readonly CausalSnapshotAgent[] {
  return (engine.createSnapshot().state as { readonly agents: readonly CausalSnapshotAgent[] })
    .agents;
}

function takeEvents(engine: SimulationEngine): readonly DomainEvent[] {
  const checkpoint = engine.prepareCheckpoint();
  const acknowledged = engine.acknowledgeCheckpoint(checkpoint.checkpointId);
  if (!acknowledged.accepted) throw new Error(acknowledged.reason);
  return checkpoint.events;
}

function lockedPassageEngine(): SimulationEngine {
  const worldDefinition = {
    ...starterHome,
    objects: starterHome.objects.map((object) =>
      object.id === "door-living-kitchen"
        ? { ...object, state: { open: false, locked: true } }
        : object,
    ),
  };
  return createSimulation({
    worldDefinition,
    plugins: [spatialPlugin, homePlugin, agentsPlugin],
    reviewRequired: true,
    seed: 1,
    simulationRulesLock: testSimulationRulesLock,
  });
}

describe("causal memory", () => {
  it("uses real startup events for every initial memory and known entity", () => {
    const engine = starterEngine({ reviewRequired: true });
    const eventIds = new Set(takeEvents(engine).map((event) => event.eventId));

    for (const agent of snapshotAgents(engine)) {
      for (const memory of agent.memories) {
        expect(eventIds.has(memory.sourceEventId), `${agent.id} memory ${memory.sourceEventId}`)
          .toBe(true);
      }
      for (const object of agent.knowledge.objects) {
        expect(eventIds.has(object.sourceEventId), `${agent.id} object ${object.sourceEventId}`)
          .toBe(true);
      }
      for (const knownAgent of agent.knowledge.agents) {
        expect(
          eventIds.has(knownAgent.sourceEventId),
          `${agent.id} agent ${knownAgent.sourceEventId}`,
        ).toBe(true);
      }
    }
  });

  it("remembers a failed automatic traversal from its action_failed event", () => {
    const source = lockedPassageEngine();
    const registry = createSimulationRegistry([
      spatialPlugin,
      homePlugin,
      agentsPlugin,
    ]);
    const lockedWorldDefinition = {
      ...starterHome,
      objects: starterHome.objects.map((object) =>
        object.id === "door-living-kitchen"
          ? { ...object, state: { open: false, locked: true } }
          : object,
      ),
    };
    let world = restoreWorldSnapshot(
      source.createSnapshot(),
      registry,
      lockedWorldDefinition,
      testSimulationRulesLock,
    );
    const legacyMoveOption: TaskOption = {
      kind: "operation",
      id: "task-option:alice:move-fridge" as never,
      operationId: "core.move" as never,
      label: "Move to refrigerator",
      taskSlots: ["BODY"],
      argumentSchema: {},
      fixedArguments: { targetEntityId: "fridge-1" },
    };
    const prepared = prepareOperationCall(
      world,
      registry,
      "alice" as never,
      legacyMoveOption,
      {},
      "operation-call:causal-memory:move" as never,
    );
    if (prepared.kind !== "prepared") {
      throw new Error(`Expected a prepared legacy move: ${JSON.stringify(prepared)}`);
    }
    const traversalIndex = prepared.operation.plan.actions.findIndex(
      (action) =>
        action.kind === "interact_object" &&
        action.purpose === "automatic_traversal" &&
        action.targetEntityId === "door-living-kitchen",
    );
    const traversal = prepared.operation.plan.actions[traversalIndex];
    const approach = prepared.operation.plan.actions[traversalIndex - 1];
    if (traversal?.kind !== "interact_object" || approach?.kind !== "move") {
      throw new Error("Expected the legacy move plan to approach the kitchen door");
    }
    const actions = prepared.operation.plan.actions.map((action, index) =>
      index < traversalIndex
        ? {
            ...action,
            progressTicks: action.durationTicks,
            ...(action.kind === "interact_object" ? { started: true } : {}),
          }
        : index === traversalIndex
          ? { ...action, progressTicks: 0, started: false }
          : action,
    );
    const activeOperation = {
      ...prepared.operation,
      progressTicks: actions
        .slice(0, traversalIndex)
        .reduce((total, action) => total + action.durationTicks, 0),
      plan: {
        ...prepared.operation.plan,
        currentActionIndex: traversalIndex,
        actions,
      },
    };
    const aliceBefore = world.agents.get("alice" as never);
    if (!aliceBefore) throw new Error("Missing Alice in locked-passage fixture");
    world = {
      ...world,
      mode: "RUNNING",
      decisionCycle: null,
      agents: new Map(world.agents).set(aliceBefore.id, {
        ...aliceBefore,
        position: approach.path.at(-1)!,
        taskTracks: {
          HEAD: { kind: "empty" },
          BODY: { kind: "operation", callId: activeOperation.callId },
        },
        activeOperations: new Map([[activeOperation.callId, activeOperation]]),
      }),
    };

    let failure: Extract<DomainEvent, { readonly type: "action_failed" }> | undefined;
    for (let count = 0; count < 3 && failure === undefined; count += 1) {
      const result = runTickPipeline(world, registry);
      world = result.world;
      failure = result.events.find(
        (event): event is Extract<DomainEvent, { readonly type: "action_failed" }> =>
          event.type === "action_failed",
      );
    }
    if (!failure) throw new Error("Expected an automatic traversal failure");
    const aliceAfter = world.agents.get("alice" as never);

    expect(aliceAfter?.memories).toContainEqual(
      expect.objectContaining({
        sourceEventId: failure.eventId,
        observationKind: "interaction",
      }),
    );
  });

  it("links an urgent bladder memory to its agent_need_changed event", () => {
    const engine = starterEngine({
      reviewRequired: true,
      aliceBladder: 74,
    });
    takeEvents(engine);
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    takeEvents(engine);
    engine.dispatch(releaseCommand(engine));
    engine.tick();
    engine.tick();
    const needEvent = takeEvents(engine)
      .find(
        (event) =>
          event.type === "agent_need_changed" &&
          event.agentId === "alice" &&
          event.newValue === 75,
      );
    if (!needEvent) throw new Error("Expected Alice's urgent bladder event");
    const alice = snapshotAgents(engine).find((agent) => agent.id === "alice");

    expect(alice?.memories).toContainEqual(
      expect.objectContaining({
        sourceEventId: needEvent.eventId,
        observationKind: "body",
      }),
    );
  });
});
