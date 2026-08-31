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

describe("local worker process", () => {
  it("publishes a final snapshot before a normal shutdown", async () => {
    const { worker, messages } = await startTestWorker();

    await vi.waitFor(() => expect(latestView(messages)).toBeDefined());
    const beforeShutdown = latestView(messages)!;
    await worker.stop();

    const snapshot = messages
      .filter((message) => message.type === "snapshot_ready")
      .at(-1)?.snapshot;
    expect(snapshot).toMatchObject({
      worldId: beforeShutdown.worldId,
      worldVersion: beforeShutdown.worldVersion,
      worldTick: beforeShutdown.worldTick,
    });
  }, 20_000);

  it("keeps time frozen until every model result is accepted", async () => {
    const { worker, messages } = await startTestWorker();
    try {
      await vi.waitFor(() => expect(requests(messages)).toHaveLength(2));
      const before = latestView(messages)!;
      expect(before).toMatchObject({ mode: "THINKING", worldTick: 0 });

      await delay(150);
      expect(latestView(messages)?.worldTick).toBe(0);

      const [alice, bob] = requests(messages);
      for (const request of [alice!]) {
        const option = request.goalOptions.find((candidate) => candidate.goal.kind === "wait")!;
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
            proposal: {
              schemaVersion: 1,
              goalOptionId: option.id,
              reason: "Wait",
            },
          },
        });
      }
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({ mode: "THINKING", worldTick: 0 }),
      );

      const bobOption = bob!.goalOptions.find((candidate) => candidate.goal.kind === "wait")!;
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
          proposal: {
            schemaVersion: 1,
            goalOptionId: bobOption.id,
            reason: "Wait",
          },
        },
      });
      await vi.waitFor(() =>
        expect(latestView(messages)).toMatchObject({
          mode: "READY_FOR_RELEASE",
          worldTick: 0,
        }),
      );
    } finally {
      await worker.stop();
    }
  }, 20_000);

  it("freezes the authoritative world after a host technical failure", async () => {
    const { worker, messages } = await startTestWorker();
    try {
      await vi.waitFor(() => expect(requests(messages)).toHaveLength(2));
      for (const request of requests(messages)) {
        const option = request.goalOptions.find((candidate) => candidate.goal.kind === "wait")!;
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
            proposal: {
              schemaVersion: 1,
              goalOptionId: option.id,
              reason: "Wait",
            },
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
      await vi.waitFor(() => expect(latestView(messages)!.worldTick).toBeGreaterThan(blockedTick));
    } finally {
      await worker.stop();
    }
  }, 20_000);
});
