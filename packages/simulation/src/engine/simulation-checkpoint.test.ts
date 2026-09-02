import { describe, expect, it } from "vitest";

import type { DecisionPromptInput } from "@god-sim/protocol";

import {
  simulationTestWorld,
  testPlugin,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";
import { createSimulation, type SimulationEngine } from "./simulation-engine";

function testEngine(): SimulationEngine {
  return createSimulation({
    worldDefinition: simulationTestWorld().map,
    plugins: [testPlugin],
    reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
    simulationRulesLock: testSimulationRulesLock,
  });
}

function bufferWaitDecision(
  engine: SimulationEngine,
  request: DecisionPromptInput,
): void {
  const option = request.taskOptions.find(
    (candidate) =>
      candidate.kind === "operation" && candidate.operationId === "core.wait",
  );
  if (!option) throw new Error(`No wait option for ${request.agentId}`);
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
      schemaVersion: 2,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: option.id,
        arguments: { durationTicks: 10 },
      },
      reason: "Wait in checkpoint test",
    },
  });
  if (!result.accepted) throw new Error(result.reason);
}

describe("simulation checkpoints", () => {
  it("prepares a version-three checkpoint with the authoritative rule lock", () => {
    expect(testEngine().prepareCheckpoint().snapshot).toMatchObject({
      schemaVersion: 3,
      simulationRulesLock: testSimulationRulesLock,
    });
  });

  it("keeps events until the matching stable checkpoint is acknowledged", () => {
    const engine = testEngine();
    const first = engine.prepareCheckpoint();

    expect(engine.prepareCheckpoint()).toEqual(first);
    expect(
      engine.acknowledgeCheckpoint("checkpoint:wrong" as never),
    ).toEqual({
      accepted: false,
      reason: expect.stringMatching(/match|pending/i),
    });
    expect(engine.prepareCheckpoint()).toEqual(first);
    expect(engine.acknowledgeCheckpoint(first.checkpointId).accepted).toBe(true);
  });

  it("acknowledges only the captured Event prefix", () => {
    const engine = testEngine();
    const first = engine.prepareCheckpoint();

    for (const request of engine.getPendingDecisionInputs()) {
      bufferWaitDecision(engine, request);
    }
    engine.tick();
    expect(engine.prepareCheckpoint()).toEqual(first);

    expect(engine.acknowledgeCheckpoint(first.checkpointId).accepted).toBe(true);
    const second = engine.prepareCheckpoint();

    expect(second.events.length).toBeGreaterThan(0);
    expect(second.events[0]?.sequence).toBe(first.snapshot.lastEventSequence + 1);
    expect(second.snapshot.lastEventSequence).toBeGreaterThan(
      first.snapshot.lastEventSequence,
    );
  });
});
