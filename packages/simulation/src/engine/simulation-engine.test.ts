import { describe, expect, it } from "vitest";

import type { GamePlugin } from "@god-sim/plugin-sdk";
import type { DecisionPromptInput, WorldCommand } from "@god-sim/protocol";

import {
  simulationTestWorld,
  testPlugin,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";
import { createSimulation, type SimulationEngine } from "./simulation-engine";

function testEngine(plugins: readonly GamePlugin[] = [testPlugin]): SimulationEngine {
  return createSimulation({
    worldDefinition: simulationTestWorld().map,
    plugins,
    reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
    simulationRulesLock: testSimulationRulesLock,
  });
}

function acceptDecision(
  engine: SimulationEngine,
  request: DecisionPromptInput,
  read: boolean,
): void {
  const result = engine.acceptDecision({
    identity: {
      requestId: request.requestId,
      agentId: request.agentId,
      worldId: request.worldId,
      worldVersion: request.worldVersion,
      decisionCycleId: request.decisionCycleId,
      schemaVersion: request.schemaVersion,
      pluginLockHash: request.pluginLockHash,
      ...(request.retryOfRequestId === undefined
        ? {}
        : { retryOfRequestId: request.retryOfRequestId }),
    },
    proposal: {
      schemaVersion: 3,
      head: read
        ? {
            kind: "replace",
            task: {
              kind: "operation",
              operationId: "core.read" as never,
              arguments: { hostDefinitionId: "test.fridge" },
            },
          }
        : { kind: "continue" },
      body: read
        ? { kind: "continue" }
        : {
            kind: "replace",
            task: {
              kind: "operation",
              operationId: "core.wait" as never,
              arguments: { durationTicks: 10 },
            },
          },
      reason: read ? "Read the fridge manual." : "Wait.",
    },
  });
  if (!result.accepted) throw new Error(result.reason);
}

function releaseCommand(engine: SimulationEngine, sequence: number): WorldCommand {
  const view = engine.getView();
  return {
    schemaVersion: 1,
    commandId: `command:release:read-test:${sequence}` as never,
    worldId: view.worldId,
    expectedWorldVersion: view.worldVersion,
    issuedAtRealTime: "2026-10-24T00:00:00.000Z",
    type: "release_execution",
  };
}

function completeDecisionCycle(engine: SimulationEngine, sequence: number): void {
  const requests = engine.getPendingDecisionInputs();
  expect(requests.some((request) => request.agentId === "alice")).toBe(true);
  for (const request of requests) {
    acceptDecision(engine, request, request.agentId === "alice");
  }
  engine.tick();
  expect(engine.getView().mode).toBe("READY_FOR_RELEASE");

  const queued = engine.dispatch(releaseCommand(engine, sequence));
  expect(queued.accepted).toBe(true);
  engine.tick();
}

describe("simulation engine immediate hosted operations", () => {
  it("completes repeated core.read calls and checkpoints results without advancing worldTick", () => {
    const engine = testEngine();

    completeDecisionCycle(engine, 1);

    expect(engine.getView()).toMatchObject({ mode: "THINKING", worldTick: 0 });
    const firstReadRequest = engine.getPendingDecisionInputs().find(
      (request) => request.agentId === "alice",
    );
    expect(firstReadRequest?.operationResults).toContainEqual(
      expect.objectContaining({
        operationId: "core.read",
        terminal: true,
        outcome: "completed",
        result: expect.objectContaining({
          kind: "manual",
          hostDefinitionId: "test.fridge",
        }),
      }),
    );

    const firstCheckpoint = engine.prepareCheckpoint();
    expect(firstCheckpoint.events.map((event) => event.type)).toContain(
      "operation_result",
    );
    expect(firstCheckpoint.snapshot.state).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "alice",
          pendingOperationResults: [
            expect.objectContaining({
              operationId: "core.read",
              outcome: "completed",
            }),
          ],
        }),
      ]),
    });
    expect(engine.acknowledgeCheckpoint(firstCheckpoint.checkpointId).accepted).toBe(
      true,
    );

    completeDecisionCycle(engine, 2);

    expect(engine.getView()).toMatchObject({ mode: "THINKING", worldTick: 0 });
    const secondReadRequest = engine.getPendingDecisionInputs().find(
      (request) => request.agentId === "alice",
    );
    expect(secondReadRequest?.operationResults).toContainEqual(
      expect.objectContaining({
        operationId: "core.read",
        terminal: true,
        outcome: "completed",
      }),
    );

    const secondCheckpoint = engine.prepareCheckpoint();
    expect(
      secondCheckpoint.events.filter((event) => event.type === "operation_result"),
    ).toHaveLength(1);
    expect(secondCheckpoint.snapshot.worldTick).toBe(0);
  });

  it("keeps every release event in the checkpoint when an immediate operation fails", () => {
    const mutablePlugin: GamePlugin = {
      ...testPlugin,
      objects: testPlugin.objects.map((object) => ({
        ...object,
        interactions: object.interactions.map((interaction) => ({
          ...interaction,
          manual: { ...interaction.manual },
        })),
      })),
      agents: testPlugin.agents.map((agent) => ({
        ...agent,
        operations: agent.operations.map((operation) => ({
          ...operation,
          manual: { ...operation.manual },
        })),
      })),
    };
    const engine = testEngine([mutablePlugin]);
    const fridgeDefinition = mutablePlugin.objects.find(
      (object) => object.id === "test.fridge",
    );
    const interaction = fridgeDefinition?.interactions.find(
      (candidate) => candidate.id === "configure",
    );
    if (!interaction) throw new Error("Missing fridge configure interaction");
    Object.assign(interaction, {
      manual: { ...interaction.manual, summary: "" },
    });
    completeDecisionCycle(engine, 1);

    expect(engine.getView()).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      worldTick: 0,
    });
    const checkpoint = engine.prepareCheckpoint();
    expect(checkpoint.events.map((event) => event.type)).toContain(
      "operation_started",
    );
    expect(checkpoint.events.map((event) => event.type)).toContain(
      "world_released",
    );
    expect(checkpoint.events.at(-1)?.sequence).toBe(
      checkpoint.snapshot.lastEventSequence,
    );
    for (const [index, event] of checkpoint.events.entries()) {
      expect(event.sequence).toBe(checkpoint.events[0]!.sequence + index);
    }
  });
});
