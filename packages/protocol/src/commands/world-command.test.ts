import { describe, expect, it } from "vitest";

import { WorldCommandSchema } from "./world-command";

const envelope = {
  schemaVersion: 1,
  commandId: "command-1",
  worldId: "starter-world",
  expectedWorldVersion: 4,
  issuedAtRealTime: "2026-08-31T00:00:00.000Z",
} as const;

describe("world commands", () => {
  it("parses only the four host control commands", () => {
    expect(WorldCommandSchema.parse({ ...envelope, type: "release_execution" }).type).toBe(
      "release_execution",
    );
    expect(
      WorldCommandSchema.parse({ ...envelope, type: "set_review_mode", enabled: false }).type,
    ).toBe("set_review_mode");
    expect(
      WorldCommandSchema.parse({
        ...envelope,
        type: "retry_decision",
        requestId: "request-1",
      }).type,
    ).toBe("retry_decision");
    expect(WorldCommandSchema.parse({ ...envelope, type: "stop_session" }).type).toBe(
      "stop_session",
    );
  });

  it("rejects commands without optimistic world version", () => {
    expect(
      WorldCommandSchema.safeParse({
        schemaVersion: 1,
        commandId: "command-1",
        worldId: "starter-world",
        issuedAtRealTime: "2026-08-31T00:00:00.000Z",
        type: "release_execution",
      }).success,
    ).toBe(false);
  });
});
