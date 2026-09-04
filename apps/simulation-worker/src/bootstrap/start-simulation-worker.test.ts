import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerToHostMessage } from "@god-sim/protocol";

const bootstrapState = vi.hoisted(() => ({
  emit: null as ((message: WorkerToHostMessage) => void) | null,
  onShutdown: null as (() => void) | null,
  ticks: 0,
}));

vi.mock("../runtime/plugin-loader", () => ({
  loadPluginSet: vi.fn(async () => ({
    plugins: [],
    pluginLock: {
      schemaVersion: 1,
      hash: "a".repeat(64),
      plugins: [],
    },
  })),
}));

vi.mock("../ipc/worker-message-handler", () => ({
  WorkerMessageHandler: class {
    constructor(options: {
      readonly emit: (message: WorkerToHostMessage) => void;
      readonly onShutdown: () => void;
    }) {
      bootstrapState.emit = options.emit;
      bootstrapState.onShutdown = options.onShutdown;
    }

    handle(): void {}

    tick(): void {
      bootstrapState.ticks += 1;
    }
  },
}));

import { startSimulationWorker } from "./start-simulation-worker";

describe("startSimulationWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    bootstrapState.emit = null;
    bootstrapState.onShutdown = null;
    bootstrapState.ticks = 0;
  });

  it("waits for the final IPC send before disconnecting during shutdown", async () => {
    vi.stubEnv(
      "GOD_SIM_PLUGIN_DESCRIPTORS",
      JSON.stringify([{ manifestPath: "plugin.json", entryPath: "dist/index.js" }]),
    );
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
    const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, "disconnect");
    const sendCallbacks: Array<(error: Error | null) => void> = [];
    const send = vi.fn(
      (_message: unknown, callback?: (error: Error | null) => void): boolean => {
        if (callback) sendCallbacks.push(callback);
        return true;
      },
    );
    const disconnect = vi.fn();
    Object.defineProperty(process, "send", { configurable: true, value: send });
    Object.defineProperty(process, "disconnect", { configurable: true, value: disconnect });
    vi.spyOn(process, "on").mockImplementation(() => process);

    try {
      await startSimulationWorker();
      bootstrapState.emit?.({ type: "worker_ready", protocolVersion: 1 });
      bootstrapState.onShutdown?.();

      expect(disconnect).not.toHaveBeenCalled();
      expect(sendCallbacks).toHaveLength(1);
      sendCallbacks[0]!(null);
      await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    } finally {
      if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
      else Reflect.deleteProperty(process, "send");
      if (disconnectDescriptor) {
        Object.defineProperty(process, "disconnect", disconnectDescriptor);
      } else {
        Reflect.deleteProperty(process, "disconnect");
      }
    }
  });

  it("advances the simulation once per 100ms fixed world step", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "GOD_SIM_PLUGIN_DESCRIPTORS",
      JSON.stringify([{ manifestPath: "plugin.json", entryPath: "dist/index.js" }]),
    );
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
    const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, "disconnect");
    Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
    Object.defineProperty(process, "disconnect", { configurable: true, value: vi.fn() });
    vi.spyOn(process, "on").mockImplementation(() => process);

    try {
      await startSimulationWorker();

      await vi.advanceTimersByTimeAsync(99);
      expect(bootstrapState.ticks).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(bootstrapState.ticks).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(bootstrapState.ticks).toBe(2);
    } finally {
      bootstrapState.onShutdown?.();
      if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
      else Reflect.deleteProperty(process, "send");
      if (disconnectDescriptor) {
        Object.defineProperty(process, "disconnect", disconnectDescriptor);
      } else {
        Reflect.deleteProperty(process, "disconnect");
      }
    }
  });

  it("changes only real-time scheduling when a deployment interval is configured", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "GOD_SIM_PLUGIN_DESCRIPTORS",
      JSON.stringify([{ manifestPath: "plugin.json", entryPath: "dist/index.js" }]),
    );
    vi.stubEnv("GOD_SIM_TICK_INTERVAL_MS", "25");
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
    const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, "disconnect");
    Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
    Object.defineProperty(process, "disconnect", { configurable: true, value: vi.fn() });
    vi.spyOn(process, "on").mockImplementation(() => process);

    try {
      await startSimulationWorker();

      await vi.advanceTimersByTimeAsync(24);
      expect(bootstrapState.ticks).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(bootstrapState.ticks).toBe(1);
      await vi.advanceTimersByTimeAsync(75);
      expect(bootstrapState.ticks).toBe(4);
    } finally {
      bootstrapState.onShutdown?.();
      if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
      else Reflect.deleteProperty(process, "send");
      if (disconnectDescriptor) {
        Object.defineProperty(process, "disconnect", disconnectDescriptor);
      } else {
        Reflect.deleteProperty(process, "disconnect");
      }
    }
  });
});
