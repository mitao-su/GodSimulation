import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import type { ModelDecisionRequest, WorkerToHostMessage } from "@god-sim/protocol";

import { startTestWorker } from "./worker-test-harness";

function latestView(messages: readonly WorkerToHostMessage[]) {
  return messages.filter((message) => message.type === "world_view").at(-1)?.view;
}

function requests(messages: readonly WorkerToHostMessage[]): ModelDecisionRequest[] {
  return messages
    .filter((message) => message.type === "decision_requested")
    .map((message) => message.request);
}

function waitDecision(request: ModelDecisionRequest) {
  const option = request.taskOptions.find(
    (candidate) =>
      candidate.kind === "operation" && candidate.operationId === "core.wait",
  );
  if (!option) throw new Error(`No wait task option for ${request.agentId}`);
  return {
    schemaVersion: 2 as const,
    head: { kind: "continue" as const },
    body: {
      kind: "replace" as const,
      taskOptionId: option.id,
      arguments: { durationTicks: 600 },
    },
    reason: "Wait",
  };
}

describe("local worker process", () => {
  it("publishes a final checkpoint before a normal shutdown", async () => {
    const session = await startTestWorker();
    const { worker, messages } = session;
    const initialCheckpoint = await session.acknowledgeNextCheckpoint();
    await vi.waitFor(() => expect(requests(messages)).toHaveLength(2));

    const request = requests(messages)[0]!;
    await worker.send({
      type: "decision_result",
      result: {
        requestId: request.requestId,
        agentId: request.agentId,
        worldId: request.worldId,
        worldVersion: request.worldVersion,
        decisionCycleId: request.decisionCycleId,
        schemaVersion: request.schemaVersion,
        pluginLockHash: request.pluginLockHash,
        proposal: waitDecision(request),
      },
    });
    await vi.waitFor(() =>
      expect(latestView(messages)!.worldVersion).toBeGreaterThan(
        initialCheckpoint.snapshot.worldVersion,
      ),
    );
    const beforeShutdown = latestView(messages)!;
    await session.stop();

    const finalCheckpoint = messages
      .filter((message) => message.type === "checkpoint_ready")
      .at(-1);
    expect(finalCheckpoint?.checkpointId).not.toBe(initialCheckpoint.checkpointId);
    expect(finalCheckpoint?.snapshot).toMatchObject({
      worldId: beforeShutdown.worldId,
      worldVersion: beforeShutdown.worldVersion,
      worldTick: beforeShutdown.worldTick,
    });
  }, 20_000);

  it("keeps time frozen until every model result is accepted", async () => {
    const session = await startTestWorker();
    const { worker, messages } = session;
    try {
      await session.acknowledgeNextCheckpoint();
      await vi.waitFor(() => expect(requests(messages)).toHaveLength(2));
      const before = latestView(messages)!;
      expect(before).toMatchObject({ mode: "THINKING", worldTick: 0 });

      await delay(150);
      expect(latestView(messages)?.worldTick).toBe(0);

      const [alice, bob] = requests(messages);
      for (const request of [alice!]) {
        await worker.send({
          type: "decision_result",
          result: {
            requestId: request.requestId,
            agentId: request.agentId,
            worldId: request.worldId,
            worldVersion: request.worldVersion,
            decisionCycleId: request.decisionCycleId,
            schemaVersion: request.schemaVersion,
            pluginLockHash: request.pluginLockHash,
            proposal: waitDecision(request),
          },
        });
      }
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({ mode: "THINKING", worldTick: 0 }),
      );

      await worker.send({
        type: "decision_result",
        result: {
          requestId: bob!.requestId,
          agentId: bob!.agentId,
          worldId: bob!.worldId,
          worldVersion: bob!.worldVersion,
          decisionCycleId: bob!.decisionCycleId,
          schemaVersion: bob!.schemaVersion,
          pluginLockHash: bob!.pluginLockHash,
          proposal: waitDecision(bob!),
        },
      });
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({
          mode: "READY_FOR_RELEASE",
          worldTick: 0,
        }),
      );
    } finally {
      await session.stop();
    }
  }, 20_000);

  it("freezes the authoritative world after a host technical failure", async () => {
    const session = await startTestWorker();
    const { worker, messages } = session;
    try {
      await session.acknowledgeNextCheckpoint();
      await vi.waitFor(() => expect(requests(messages)).toHaveLength(2));
      for (const request of requests(messages)) {
        await worker.send({
          type: "decision_result",
          result: {
            requestId: request.requestId,
            agentId: request.agentId,
            worldId: request.worldId,
            worldVersion: request.worldVersion,
            decisionCycleId: request.decisionCycleId,
            schemaVersion: request.schemaVersion,
            pluginLockHash: request.pluginLockHash,
            proposal: waitDecision(request),
          },
        });
      }
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({ mode: "READY_FOR_RELEASE", worldTick: 0 }),
      );
      const ready = latestView(messages)!;
      await worker.send({
        type: "world_command",
        command: {
          schemaVersion: 1,
          commandId: "command:release:persistence-test" as never,
          worldId: ready.worldId,
          expectedWorldVersion: ready.worldVersion,
          issuedAtRealTime: "2026-08-31T00:00:00.000Z",
          type: "release_execution",
        },
      });
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({ mode: "RUNNING", worldTick: 0 }),
      );
      await delay(150);
      expect(latestView(messages)?.worldTick).toBe(0);
      await session.acknowledgeNextCheckpoint();
      await vi.waitFor(() => expect(latestView(messages)?.worldTick).toBeGreaterThan(0));

      await worker.send({
        type: "technical_failure",
        failure: {
          id: "failure:persistence:1",
          category: "persistence",
          message: "Unable to save the event batch",
          retryable: true,
          occurredAtRealTime: "2026-08-31T00:00:01.000Z",
        },
      });
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({
          mode: "TECHNICALLY_BLOCKED",
          technicalFailure: { id: "failure:persistence:1", category: "persistence" },
        }),
      );
      const blockedTick = latestView(messages)!.worldTick;

      await delay(150);

      expect(latestView(messages)).toMatchObject({
        mode: "TECHNICALLY_BLOCKED",
        worldTick: blockedTick,
      });

      const blocked = latestView(messages)!;
      await session.acknowledgeNextCheckpoint();
      await worker.send({
        type: "world_command",
        command: {
          schemaVersion: 1,
          commandId: "command:retry:persistence-test" as never,
          worldId: blocked.worldId,
          expectedWorldVersion: blocked.worldVersion,
          issuedAtRealTime: "2026-08-31T00:00:02.000Z",
          type: "retry_technical_failure",
          failureId: "failure:persistence:1",
        },
      });
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({
          mode: "RUNNING",
          technicalFailure: null,
        }),
      );
      await session.acknowledgeNextCheckpoint();
      await vi.waitFor(() => expect(latestView(messages)!.worldTick).toBeGreaterThan(blockedTick));
    } finally {
      await session.stop();
    }
  }, 20_000);
});
