import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { JsonValueSchema, type WorkerToHostMessage } from "@god-sim/protocol";

import { ProcessWorkerSupervisor } from "../../apps/local-server/src/sessions/worker-supervisor";
import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { pluginDescriptors, startTestWorker } from "./worker-test-harness";
import { buildPluginLock } from "../../apps/simulation-worker/src/runtime/plugin-lock";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("worker decision validation and retry", () => {
  it("publishes an explicit technical failure when IPC disconnects", async () => {
    const worker = new ProcessWorkerSupervisor({
      entryPath: resolve(root, "tests", "integration", "fixtures", "disconnecting-worker.ts"),
      pluginDescriptors,
      cwd: root,
      execArgv: ["--import", "tsx"],
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const messages: WorkerToHostMessage[] = [];
    worker.onMessage((message) => messages.push(message));
    const pluginLock = await buildPluginLock(pluginDescriptors);

    try {
      await worker.start({
        type: "initialize",
        protocolVersion: 1,
        worldDefinition: JsonValueSchema.parse(starterHome),
        pluginLock,
        reviewRequired: true,
        deterministicSeed: 1,
      });
      await vi.waitFor(() =>
        expect(messages).toContainEqual(
          expect.objectContaining({
            type: "technical_failure",
            failure: expect.objectContaining({ category: "worker", retryable: false }),
          }),
        ),
      );
    } finally {
      await worker.stop();
    }
  }, 20_000);

  it("publishes an explicit technical failure when a ready worker exits", async () => {
    const worker = new ProcessWorkerSupervisor({
      entryPath: resolve(root, "tests", "integration", "fixtures", "exiting-worker.ts"),
      pluginDescriptors,
      cwd: root,
      execArgv: ["--import", "tsx"],
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const messages: WorkerToHostMessage[] = [];
    worker.onMessage((message) => messages.push(message));
    const pluginLock = await buildPluginLock(pluginDescriptors);

    await worker.start({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition: JsonValueSchema.parse(starterHome),
      pluginLock,
      reviewRequired: true,
      deterministicSeed: 1,
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "technical_failure",
          failure: expect.objectContaining({ category: "worker", retryable: false }),
        }),
      ),
    );
    await worker.stop();
  }, 20_000);

  it("rejects a stale response without changing the frozen tick", async () => {
    const { worker, messages } = await startTestWorker();
    try {
      await vi.waitFor(() =>
        expect(messages.filter((message) => message.type === "decision_requested")).toHaveLength(2),
      );
      const request = messages.find((message) => message.type === "decision_requested")!.request;
      const option = request.goalOptions[0]!;
      await worker.send({
        type: "decision_result",
        result: {
          requestId: request.requestId,
          agentId: request.agentId,
          worldId: request.worldId,
          worldVersion: request.worldVersion + 1,
          decisionCycleId: request.decisionCycleId,
          schemaVersion: request.schemaVersion,
          pluginLockHash: request.pluginLockHash,
          proposal: { schemaVersion: 1, goalOptionId: option.id, reason: "Stale" },
        },
      });

      await vi.waitFor(() =>
        expect(messages.some((message) => message.type === "decision_rejected")).toBe(true),
      );
      const view = messages.filter((message) => message.type === "world_view").at(-1)?.view;
      expect(view).toMatchObject({ mode: "THINKING", worldTick: 0 });
    } finally {
      await worker.stop();
    }
  }, 20_000);

  it("publishes a new linked request after player retry", async () => {
    const { worker, messages } = await startTestWorker();
    try {
      await vi.waitFor(() =>
        expect(messages.filter((message) => message.type === "decision_requested")).toHaveLength(2),
      );
      const original = messages.find((message) => message.type === "decision_requested")!.request;
      await worker.send({
        type: "decision_failure",
        failure: {
          id: `failure:model:${original.requestId}`,
          category: "model",
          message: "Provider unavailable",
          requestId: original.requestId,
          retryable: true,
          occurredAtRealTime: "2026-08-31T00:00:00.000Z",
        },
      });
      await vi.waitFor(() => {
        const view = messages.filter((message) => message.type === "world_view").at(-1)?.view;
        expect(view?.mode).toBe("TECHNICALLY_BLOCKED");
      });
      const blockedView = messages.filter((message) => message.type === "world_view").at(-1)!.view;
      await worker.send({
        type: "world_command",
        command: {
          schemaVersion: 1,
          commandId: "command:retry:1" as never,
          worldId: blockedView.worldId,
          expectedWorldVersion: blockedView.worldVersion,
          issuedAtRealTime: "2026-08-31T00:00:01.000Z",
          type: "retry_decision",
          requestId: original.requestId,
        },
      });

      await vi.waitFor(() => {
        const retried = messages
          .filter((message): message is Extract<WorkerToHostMessage, { type: "decision_requested" }> =>
            message.type === "decision_requested",
          )
          .find((message) => message.request.retryOfRequestId === original.requestId);
        expect(retried?.request.requestId).not.toBe(original.requestId);
      });
    } finally {
      await worker.stop();
    }
  }, 20_000);
});
