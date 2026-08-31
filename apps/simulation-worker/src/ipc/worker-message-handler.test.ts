import { describe, expect, it } from "vitest";

import type { PluginLock, WorkerToHostMessage } from "@god-sim/protocol";

import { WorkerMessageHandler } from "./worker-message-handler";

const pluginLock: PluginLock = {
  hash: "a".repeat(64),
  entries: [
    {
      pluginId: "test.plugin",
      version: "0.1.0",
      stateVersion: 1,
      buildHash: "b".repeat(64),
    },
  ],
};

describe("WorkerMessageHandler", () => {
  it("accepts shutdown even when world initialization failed", () => {
    const messages: WorkerToHostMessage[] = [];
    let stopped = false;
    const handler = new WorkerMessageHandler({
      plugins: [],
      pluginLock,
      emit: (message) => messages.push(message),
      onShutdown: () => {
        stopped = true;
      },
    });

    handler.handle({ type: "shutdown" });

    expect(stopped).toBe(true);
    expect(messages).toEqual([]);
  });
});
