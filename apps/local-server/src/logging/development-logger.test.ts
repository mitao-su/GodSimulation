import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDevelopmentLogger } from "./development-logger";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("development logger", () => {
  it("writes structured lines after redacting secret values and authorization headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-log-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "local-server.ndjson");
    const logger = await createDevelopmentLogger({
      filename,
      knownSecrets: ["test-secret-value"],
    });

    logger.info(
      {
        authorization: "Bearer test-secret-value",
        apiKey: "test-secret-value",
        nested: { authorization: "Bearer another-token" },
      },
      "Provider failed with test-secret-value and Bearer loose-token",
    );
    logger.flush();

    const line = await readFile(filename, "utf8");
    expect(() => JSON.parse(line.trim())).not.toThrow();
    expect(line).not.toContain("test-secret-value");
    expect(line).not.toContain("another-token");
    expect(line).not.toContain("loose-token");
    expect(line).toContain("[REDACTED]");
  });
});
