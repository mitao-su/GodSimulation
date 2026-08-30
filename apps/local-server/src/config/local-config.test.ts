import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadLocalConfig } from "./local-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function projectDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "god-sim-config-"));
  temporaryDirectories.push(path);
  return path;
}

describe("local configuration", () => {
  it("loads the local model file without placing its secret in diagnostics", async () => {
    const projectRoot = await projectDirectory();
    await writeFile(
      join(projectRoot, "free_model.local"),
      [
        "BASE_URL=https://models.example/v1",
        "API_KEY=test-secret-value",
        "MODEL=free/example",
      ].join("\n"),
      "utf8",
    );

    const config = await loadLocalConfig({ projectRoot, environment: {} });

    expect(config.decisionProvider).toEqual({
      kind: "openrouter",
      model: {
        endpoint: "https://models.example/v1/chat/completions",
        apiKey: "test-secret-value",
        model: "free/example",
        timeoutMs: 120_000,
        appTitle: "God Simulation",
      },
    });
    expect(JSON.stringify(config.diagnostics)).not.toContain("test-secret-value");
  });

  it("supports deterministic fixed mode without a model key file", async () => {
    const projectRoot = await projectDirectory();
    const config = await loadLocalConfig({
      projectRoot,
      environment: { GOD_SIM_DECISION_PROVIDER: "fixed" },
    });

    expect(config.decisionProvider).toEqual({ kind: "fixed" });
  });
});
