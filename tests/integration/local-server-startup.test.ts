import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLocalConfig } from "../../apps/local-server/src/config/local-config";
import { startLocalServer } from "../../apps/local-server/src/bootstrap/start-local-server";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local server startup", () => {
  it("starts one real worker with SQLite persistence and exposes its world", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "god-sim-server-"));
    temporaryDirectories.push(dataDirectory);
    const config = await loadLocalConfig({
      projectRoot: root,
      environment: {
        GOD_SIM_DECISION_PROVIDER: "fixed",
        GOD_SIM_DATABASE: join(dataDirectory, "timeline.sqlite"),
        GOD_SIM_LOG: join(dataDirectory, "local-server.ndjson"),
      },
    });
    const running = await startLocalServer({ config, listen: false, serveStaticWeb: false });

    try {
      await vi.waitFor(async () => {
        const response = await running.app.inject({ method: "GET", url: "/api/world" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          worldId: "starter-world",
          worldTick: 0,
          mode: "READY_FOR_RELEASE",
        });
      });
    } finally {
      await running.stop();
    }
  }, 20_000);
});
