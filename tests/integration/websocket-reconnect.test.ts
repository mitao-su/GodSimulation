import { describe, expect, it, vi } from "vitest";

import {
  WorldViewSchema,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
  type WorldView,
} from "@god-sim/protocol";
import type { DecisionProvider } from "@god-sim/model-gateway";

import { createLocalServerApp } from "../../apps/local-server/src/bootstrap/start-local-server";
import { PersistenceWriter } from "../../apps/local-server/src/persistence/persistence-writer";
import { SessionCoordinator } from "../../apps/local-server/src/sessions/session-coordinator";
import type { WorkerTransport } from "../../apps/local-server/src/sessions/worker-supervisor";

function worldView(revision = 1): WorldView {
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision,
    worldId: "starter-world",
    worldName: "Starter Home",
    worldVersion: revision,
    worldTick: 0,
    mode: "THINKING",
    reviewRequired: true,
    pauseReason: {
      code: "initial_goal",
      message: "Choose a first goal",
      agentIds: ["alice", "bob"],
    },
    map: { width: 18, height: 12, tileSize: 16, zones: [], tiles: [] },
    entities: [],
    agents: [],
    pendingDecisions: [],
    recentEvents: [],
    technicalFailure: null,
  });
}

class FakeWorker implements WorkerTransport {
  readonly sent: HostToWorkerMessage[] = [];
  starts = 0;
  #listener: ((message: WorkerToHostMessage) => void) | null = null;

  onMessage(listener: (message: WorkerToHostMessage) => void): () => void {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async send(message: HostToWorkerMessage): Promise<void> {
    this.sent.push(message);
  }

  async stop(): Promise<void> {}

  emit(message: WorkerToHostMessage): void {
    this.#listener?.(message);
  }
}

async function connectAndReadInitial(app: Awaited<ReturnType<typeof createLocalServerApp>>) {
  let resolveMessage!: (value: string) => void;
  const initialMessage = new Promise<string>((resolve) => {
    resolveMessage = resolve;
  });
  const socket = await app.injectWS("/api/events", {}, {
    onInit(ws) {
      ws.once("message", (data) => resolveMessage(data.toString()));
    },
  });
  return { socket, initialMessage: await initialMessage };
}

describe("local browser transport", () => {
  it("reconnects to the same session and immediately restores the latest view", async () => {
    const worker = new FakeWorker();
    const provider: DecisionProvider = {
      async decide() {
        throw new Error("No decision expected in this test");
      },
    };
    const session = new SessionCoordinator({
      worker,
      decisionProvider: provider,
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
    });
    await session.start();
    worker.emit({ type: "world_view", view: worldView() });
    await vi.waitFor(() => expect(session.getView()?.revision).toBe(1));
    const app = await createLocalServerApp({ session, logger: false });

    try {
      const first = await connectAndReadInitial(app);
      expect(JSON.parse(first.initialMessage)).toMatchObject({
        worldId: "starter-world",
        revision: 1,
      });
      first.socket.close();

      const second = await connectAndReadInitial(app);
      expect(JSON.parse(second.initialMessage)).toMatchObject({
        worldId: "starter-world",
        revision: 1,
      });
      expect(worker.starts).toBe(1);
      second.socket.close();
    } finally {
      await app.close();
      await session.stop();
    }
  });

  it("serves the current view and forwards only parsed world commands", async () => {
    const worker = new FakeWorker();
    const session = new SessionCoordinator({
      worker,
      decisionProvider: { async decide() { throw new Error("unused"); } },
      persistence: PersistenceWriter.inMemory(),
      modelId: "fixed-test",
    });
    await session.start();
    worker.emit({ type: "world_view", view: worldView(3) });
    await vi.waitFor(() => expect(session.getView()?.revision).toBe(3));
    const app = await createLocalServerApp({ session, logger: false });

    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok", worldReady: true });

      const view = await app.inject({ method: "GET", url: "/api/world" });
      expect(view.statusCode).toBe(200);
      expect(view.json()).toMatchObject({ worldId: "starter-world", revision: 3 });

      const rejected = await app.inject({
        method: "POST",
        url: "/api/commands",
        payload: { type: "invent_goal", target: "fridge-1" },
      });
      expect(rejected.statusCode).toBe(400);
      expect(worker.sent.filter((message) => message.type === "world_command")).toEqual([]);

      const accepted = await app.inject({
        method: "POST",
        url: "/api/commands",
        payload: {
          schemaVersion: 1,
          commandId: "command:review:1",
          worldId: "starter-world",
          expectedWorldVersion: 3,
          issuedAtRealTime: "2026-08-31T00:00:00.000Z",
          type: "set_review_mode",
          enabled: false,
        },
      });
      expect(accepted.statusCode).toBe(202);
      expect(worker.sent).toContainEqual(
        expect.objectContaining({
          type: "world_command",
          command: expect.objectContaining({ type: "set_review_mode", enabled: false }),
        }),
      );
    } finally {
      await app.close();
      await session.stop();
    }
  });
});
