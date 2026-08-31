import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildExpectedPluginLock } from "./expected-plugin-lock";

describe("buildExpectedPluginLock", () => {
  it("rejects an entry path that differs from the plugin manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-expected-lock-"));
    const manifestPath = join(directory, "plugin.json");
    const suppliedEntryPath = join(directory, "src", "index.ts");
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          id: "test.plugin",
          version: "0.1.0",
          stateVersion: 1,
          engineApiVersion: 1,
          entry: "./dist/index.js",
          objectDefinitionIds: [],
          agentDefinitionIds: [],
        }),
        "utf8",
      );
      await writeFile(suppliedEntryPath, "export default {};\n", "utf8");

      await expect(
        buildExpectedPluginLock([{ manifestPath, entryPath: suppliedEntryPath }]),
      ).rejects.toThrow(/manifest entry/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
