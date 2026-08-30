import { describe, expect, it } from "vitest";

import { HostToWorkerMessageSchema, WorkerToHostMessageSchema } from "./host-worker-message";

describe("host-worker messages", () => {
  it("rejects a decision result without request identity", () => {
    expect(
      HostToWorkerMessageSchema.safeParse({
        type: "decision_result",
        result: { requestId: "request-1" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown worker message types", () => {
    expect(
      WorkerToHostMessageSchema.safeParse({
        type: "world_mutated_directly",
        state: {},
      }).success,
    ).toBe(false);
  });

  it("accepts a redacted technical failure", () => {
    const message = WorkerToHostMessageSchema.parse({
      type: "technical_failure",
      failure: {
        id: "failure-1",
        category: "model",
        message: "Provider returned invalid JSON",
        requestId: "request-1",
        retryable: true,
        occurredAtRealTime: "2026-08-31T00:00:00.000Z",
      },
    });

    expect(message.type).toBe("technical_failure");
  });
});

