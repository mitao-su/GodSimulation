import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorldCommandSchema, WorldViewSchema, type WorldView } from "@god-sim/protocol";
import { createSqliteTimelineStore } from "@god-sim/sqlite-store";

import {
  loadLocalConfig,
  startLocalServer,
  type RunningLocalServer,
} from "../../apps/local-server/src/index";

const projectRoot = resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => {
      const resolvedPath = resolve(path);
      if (
        dirname(resolvedPath) !== resolve(tmpdir()) ||
        !basename(resolvedPath).startsWith("god-simulation-restart-")
      ) {
        throw new Error(`Refusing to remove unexpected test directory: ${resolvedPath}`);
      }
      await rm(resolvedPath, { recursive: true, force: true });
    }),
  );
});

async function waitForReady(running: RunningLocalServer): Promise<WorldView> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await running.app.inject({ method: "GET", url: "/api/world" });
    if (response.statusCode === 200) {
      const view = WorldViewSchema.parse(response.json());
      if (view.mode === "READY_FOR_RELEASE" || view.mode === "TECHNICALLY_BLOCKED") {
        return view;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error("Timed out waiting for the local world to finish its initial decisions");
}

async function releaseAndWaitForRunningTick(
  running: RunningLocalServer,
  ready: WorldView,
): Promise<WorldView> {
  const command = WorldCommandSchema.parse({
    schemaVersion: 1,
    commandId: `command:restart-test:${ready.worldVersion}`,
    worldId: ready.worldId,
    expectedWorldVersion: ready.worldVersion,
    issuedAtRealTime: "2026-08-31T00:00:00.000Z",
    type: "release_execution",
  });
  const release = await running.app.inject({
    method: "POST",
    url: "/api/commands",
    payload: command,
  });
  expect(release.statusCode).toBe(202);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await running.app.inject({ method: "GET", url: "/api/world" });
    if (response.statusCode === 200) {
      const view = WorldViewSchema.parse(response.json());
      if (view.mode === "RUNNING" && view.worldTick > ready.worldTick) return view;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error("Timed out waiting for the released world to advance");
}

describe("local server restart", () => {
  it("commits the exact running state with no event tail on normal shutdown", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "god-simulation-restart-"));
    temporaryDirectories.push(runtimeRoot);
    const databaseFilename = join(runtimeRoot, "timeline.sqlite");
    const config = await loadLocalConfig({
      projectRoot,
      environment: {
        GOD_SIM_DECISION_PROVIDER: "fixed",
        GOD_SIM_DATABASE: databaseFilename,
        GOD_SIM_LOG: join(runtimeRoot, "local-server.ndjson"),
      },
    });

    const running = await startLocalServer({
      config,
      listen: false,
      serveStaticWeb: false,
    });
    let beforeShutdown: WorldView;
    try {
      const ready = await waitForReady(running);
      beforeShutdown = await releaseAndWaitForRunningTick(running, ready);
    } finally {
      await running.stop();
    }

    const store = await createSqliteTimelineStore({ filename: databaseFilename });
    try {
      const restored = await store.loadLatest(beforeShutdown.worldId);
      expect(restored.snapshot).toMatchObject({
        schemaVersion: 2,
        worldId: beforeShutdown.worldId,
        worldVersion: beforeShutdown.worldVersion,
        worldTick: beforeShutdown.worldTick,
      });
      expect(restored.events).toEqual([]);
    } finally {
      await store.close();
    }
  }, 30_000);

  it("restores the latest world from the same database without duplicating history", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "god-simulation-restart-"));
    temporaryDirectories.push(runtimeRoot);
    const config = await loadLocalConfig({
      projectRoot,
      environment: {
        GOD_SIM_DECISION_PROVIDER: "fixed",
        GOD_SIM_DATABASE: join(runtimeRoot, "timeline.sqlite"),
        GOD_SIM_LOG: join(runtimeRoot, "local-server.ndjson"),
      },
    });

    const first = await startLocalServer({
      config,
      listen: false,
      serveStaticWeb: false,
    });
    const beforeRestart = await waitForReady(first);
    expect(beforeRestart).toMatchObject({
      mode: "READY_FOR_RELEASE",
      worldTick: 0,
      technicalFailure: null,
    });
    await first.stop();

    const second = await startLocalServer({
      config,
      listen: false,
      serveStaticWeb: false,
    });
    try {
      const afterRestart = await waitForReady(second);
      expect(afterRestart).toMatchObject({
        mode: "READY_FOR_RELEASE",
        worldTick: beforeRestart.worldTick,
        worldVersion: beforeRestart.worldVersion,
        technicalFailure: null,
      });
    } finally {
      await second.stop();
    }
  }, 30_000);
});
