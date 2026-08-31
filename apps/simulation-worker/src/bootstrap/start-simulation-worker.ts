import {
  WorkerToHostMessageSchema,
  type WorkerToHostMessage,
} from "@god-sim/protocol";

import { WorkerMessageHandler } from "../ipc/worker-message-handler";
import { loadPluginSet } from "../runtime/plugin-loader";
import type { PluginDescriptor } from "../runtime/plugin-lock";

const FIXED_TICK_INTERVAL_MS = 100;

function parsePluginDescriptors(value: string | undefined): readonly PluginDescriptor[] {
  if (!value) throw new Error("GOD_SIM_PLUGIN_DESCRIPTORS is required");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("GOD_SIM_PLUGIN_DESCRIPTORS must be a non-empty array");
  }
  return parsed.map((descriptor, index) => {
    if (
      typeof descriptor !== "object" ||
      descriptor === null ||
      !("manifestPath" in descriptor) ||
      !("entryPath" in descriptor) ||
      typeof descriptor.manifestPath !== "string" ||
      typeof descriptor.entryPath !== "string"
    ) {
      throw new Error(`Invalid plugin descriptor at index ${index}`);
    }
    return { manifestPath: descriptor.manifestPath, entryPath: descriptor.entryPath };
  });
}
export async function startSimulationWorker(): Promise<void> {
  if (!process.send) throw new Error("Simulation worker requires an IPC parent");
  const sendToParent = process.send.bind(process);
  const disconnectFromParent = process.disconnect.bind(process);
  const descriptors = parsePluginDescriptors(process.env.GOD_SIM_PLUGIN_DESCRIPTORS);
  const loaded = await loadPluginSet(descriptors);
  const pendingSends = new Set<Promise<void>>();
  let timer: NodeJS.Timeout | null = null;
  const emit = (message: WorkerToHostMessage): void => {
    const pending = new Promise<void>((resolve, reject) => {
      sendToParent(WorkerToHostMessageSchema.parse(message), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    pendingSends.add(pending);
    void pending
      .finally(() => pendingSends.delete(pending))
      .catch(() => undefined);
  };
  const shutdown = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    void Promise.allSettled([...pendingSends]).then(() => disconnectFromParent());
  };
  const handler = new WorkerMessageHandler({
    plugins: loaded.plugins,
    pluginLock: loaded.pluginLock,
    emit,
    onShutdown: shutdown,
  });
  process.on("message", (message) => handler.handle(message));
  timer = setInterval(() => handler.tick(), FIXED_TICK_INTERVAL_MS);
  timer.unref();
}
