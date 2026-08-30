import { startSimulationWorker } from "./bootstrap/start-simulation-worker";

export * from "./bootstrap/start-simulation-worker";
export * from "./ipc/worker-message-handler";
export * from "./runtime/plugin-loader";
export * from "./runtime/plugin-lock";
export * from "./runtime/world-session";

if (process.send) {
  void startSimulationWorker().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.send?.({
      type: "technical_failure",
      failure: {
        id: "failure:worker:startup",
        category: "worker",
        message: message.slice(0, 2_000),
        retryable: false,
        occurredAtRealTime: new Date().toISOString(),
      },
    });
  });
}
