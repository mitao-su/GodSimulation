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
});
