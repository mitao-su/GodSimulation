import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function captureOutput(child: ChildProcessWithoutNullStreams): () => string {
  let output = "";
  const append = (chunk: Buffer): void => {
    output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return () => output;
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolveExit();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

test("starts the production server and worker bundles without a TypeScript loader", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "god-sim-production-"));
  const port = 4_415;
  const child = spawn(
    process.execPath,
    ["--enable-source-maps", "apps/local-server/dist/index.js"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        GOD_SIM_DATABASE: join(dataDirectory, "timeline.sqlite"),
        GOD_SIM_DECISION_PROVIDER: "fixed",
        GOD_SIM_LOG: join(dataDirectory, "local-server.ndjson"),
        GOD_SIM_PORT: String(port),
        GOD_SIM_WORKER_ENTRY: "apps/simulation-worker/dist/index.js",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  const readOutput = captureOutput(child);

  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) {
            throw new Error(`Production app exited with code ${child.exitCode}:\n${readOutput()}`);
          }
          try {
            return (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(200);
    const response = await fetch(`http://127.0.0.1:${port}/api/world`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ worldId: "starter-world", worldTick: 0 });
  } finally {
    if (child.exitCode === null) child.kill();
    await waitForExit(child);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
