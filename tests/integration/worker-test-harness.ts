import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { JsonValueSchema, type WorkerToHostMessage } from "@god-sim/protocol";

import { ProcessWorkerSupervisor } from "../../apps/local-server/src/sessions/worker-supervisor";
import {
  buildPluginLock,
  type PluginDescriptor,
} from "../../apps/simulation-worker/src/runtime/plugin-lock";
import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const pluginDescriptors: readonly PluginDescriptor[] = [
  "spatial-objects",
  "home-objects",
  "starter-agents",
].map((name) => ({
  manifestPath: resolve(root, "plugins", name, "plugin.json"),
  entryPath: resolve(root, "plugins", name, "dist", "index.js"),
}));

type CheckpointReady = Extract<WorkerToHostMessage, { type: "checkpoint_ready" }>;

export interface TestWorkerHandle {
  readonly worker: ProcessWorkerSupervisor;
  readonly messages: WorkerToHostMessage[];
  acknowledgeNextCheckpoint(): Promise<CheckpointReady>;
  stop(): Promise<void>;
}

export async function startTestWorker(): Promise<TestWorkerHandle> {
  const messages: WorkerToHostMessage[] = [];
  const acknowledgedCheckpointIds = new Set<string>();
  const worker = new ProcessWorkerSupervisor({
    entryPath: resolve(root, "apps", "simulation-worker", "src", "index.ts"),
    pluginDescriptors,
    cwd: root,
    execArgv: ["--import", "tsx"],
  });
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

  const nextCheckpoint = async (): Promise<CheckpointReady> => {
    const available = messages.find(
      (message): message is CheckpointReady =>
        message.type === "checkpoint_ready" &&
        !acknowledgedCheckpointIds.has(message.checkpointId),
    );
    if (available) return available;

    return new Promise<CheckpointReady>((resolveCheckpoint, rejectCheckpoint) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        rejectCheckpoint(new Error("Timed out waiting for an unacknowledged checkpoint"));
      }, 5_000);
      const unsubscribe = worker.onMessage((message) => {
        if (
          message.type !== "checkpoint_ready" ||
          acknowledgedCheckpointIds.has(message.checkpointId)
        ) {
          return;
        }
        clearTimeout(timeout);
        unsubscribe();
        resolveCheckpoint(message);
      });
    });
  };

  const acknowledge = async (checkpoint: CheckpointReady): Promise<void> => {
    acknowledgedCheckpointIds.add(checkpoint.checkpointId);
    try {
      await worker.send({
        type: "checkpoint_committed",
        checkpointId: checkpoint.checkpointId,
      });
    } catch (error) {
      acknowledgedCheckpointIds.delete(checkpoint.checkpointId);
      throw error;
    }
  };

  return {
    worker,
    messages,
    async acknowledgeNextCheckpoint() {
      const checkpoint = await nextCheckpoint();
      await acknowledge(checkpoint);
      return checkpoint;
    },
    async stop() {
      let acknowledgementError: unknown;
      let acknowledgementTail = Promise.resolve();
      const queueAcknowledgement = (message: WorkerToHostMessage): void => {
        if (
          message.type !== "checkpoint_ready" ||
          acknowledgedCheckpointIds.has(message.checkpointId)
        ) {
          return;
        }
        acknowledgedCheckpointIds.add(message.checkpointId);
        acknowledgementTail = acknowledgementTail
          .then(() =>
            worker.send({
              type: "checkpoint_committed",
              checkpointId: message.checkpointId,
            }),
          )
          .catch((error: unknown) => {
            acknowledgementError ??= error;
          });
      };
      const unsubscribe = worker.onMessage(queueAcknowledgement);
      for (const message of messages) queueAcknowledgement(message);
      try {
        await worker.stop();
        await acknowledgementTail;
        if (acknowledgementError) throw acknowledgementError;
      } finally {
        unsubscribe();
      }
    },
  };
}
