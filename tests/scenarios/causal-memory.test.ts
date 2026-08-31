import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import type { DomainEvent } from "@god-sim/protocol";
import { createSimulation, type SimulationEngine } from "@god-sim/simulation";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import {
  adoptGoal,
  releaseCommand,
  selectUseObject,
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
  });
}

function runUntilActionFailure(engine: SimulationEngine): {
  readonly events: readonly DomainEvent[];
  readonly failure: Extract<DomainEvent, { readonly type: "action_failed" }>;
} {
  const events: DomainEvent[] = [];
  for (let count = 0; count < 500; count += 1) {
    engine.tick();
    events.push(...takeEvents(engine));
    const failure = events.find((event) => event.type === "action_failed");
    if (failure?.type === "action_failed") return { events, failure };
  }
  throw new Error("Expected an automatic traversal failure");
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
    const engine = lockedPassageEngine();
    takeEvents(engine);
    adoptGoal(engine, "alice" as never, selectUseObject("fridge-1"));
    adoptGoal(engine, "bob" as never, selectWait);
    engine.tick();
    takeEvents(engine);
    engine.dispatch(releaseCommand(engine));

    const { failure } = runUntilActionFailure(engine);
    const alice = snapshotAgents(engine).find((agent) => agent.id === "alice");

    expect(alice?.memories).toContainEqual(
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
    adoptGoal(engine, "alice" as never, selectWait);
    adoptGoal(engine, "bob" as never, selectWait);
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
