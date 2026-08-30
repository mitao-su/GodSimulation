import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPluginLock } from "./plugin-lock";

describe("buildPluginLock", () => {
  it("is stable for identical builds and changes with the entry bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-plugin-lock-"));
    const manifestPath = join(directory, "plugin.json");
    const entryPath = join(directory, "index.js");
    try {
      await writeFile(
        manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          id: "test.plugin",
          version: "0.1.0",
          stateVersion: 1,
          engineApiVersion: 1,
          entry: "./index.js",
          objectDefinitionIds: [],
          agentDefinitionIds: [],
        }),
        "utf8",
      );
      await writeFile(entryPath, "export default {};\n", "utf8");
      const descriptors = [{ manifestPath, entryPath }];

      const first = await buildPluginLock(descriptors);
      const second = await buildPluginLock(descriptors);
      await writeFile(entryPath, "export default { changed: true };\n", "utf8");
      const changed = await buildPluginLock(descriptors);

      expect(second).toEqual(first);
      expect(first.entries[0]?.buildHash).toMatch(/^[a-f0-9]{64}$/);
      expect(changed.hash).not.toBe(first.hash);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
