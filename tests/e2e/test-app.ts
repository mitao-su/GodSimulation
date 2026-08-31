import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TestScenario =
  | "basic-loop"
  | "bladder-toilet"
  | "review-mode"
  | "technical-retry";

export interface RunningTestApp {
  readonly url: string;
  stop(): Promise<void>;
}

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function outputTail(child: ChildProcessWithoutNullStreams): () => string {
  let output = "";
  const append = (chunk: Buffer): void => {
    output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return () => output;
}

async function waitForReady(
  child: ChildProcessWithoutNullStreams,
  url: string,
  readOutput: () => string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test app exited with code ${child.exitCode}:\n${readOutput()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The local listener is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${url}:\n${readOutput()}`);
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

export async function launchTestApp(
  scenario: TestScenario,
  port: number,
): Promise<RunningTestApp> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/start-test-app.mjs",
      "--scenario",
      scenario,
      "--port",
      String(port),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, GOD_SIM_DECISION_PROVIDER: "fixed" },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  const readOutput = outputTail(child);
  const url = `http://127.0.0.1:${port}`;
  await waitForReady(child, url, readOutput);
  let stopped = false;
  return {
    url,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      child.stdin.end("shutdown\n");
      await waitForExit(child);
      if (child.exitCode !== 0 && child.exitCode !== null) {
        throw new Error(`Test app stopped with code ${child.exitCode}:\n${readOutput()}`);
      }
    },
  };
}
