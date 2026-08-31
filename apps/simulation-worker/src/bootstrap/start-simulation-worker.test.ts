import { afterEach, describe, expect, it, vi } from "vitest";

const bootstrapState = vi.hoisted(() => ({
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
    constructor(options: { readonly onShutdown: () => void }) {
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
    bootstrapState.onShutdown = null;
    bootstrapState.ticks = 0;
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
});
