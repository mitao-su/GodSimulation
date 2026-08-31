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

export async function startTestWorker(): Promise<{
  readonly worker: ProcessWorkerSupervisor;
  readonly messages: WorkerToHostMessage[];
}> {
  const messages: WorkerToHostMessage[] = [];
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
  return { worker, messages };
}
