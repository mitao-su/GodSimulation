import { describe, expect, it, vi } from "vitest";

import type { ModelDecisionRequest } from "@god-sim/protocol";

import { OpenRouterDecisionProvider } from "./openrouter-decision-provider";

const request: ModelDecisionRequest = {
  requestId: "request-1" as never,
  agentId: "alice" as never,
  worldId: "starter-world" as never,
  worldVersion: 3,
  decisionCycleId: "cycle-1" as never,
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64) as never,
  decisionReason: { code: "initial_task", summary: "Choose tasks" },
  messages: [{ role: "user", content: "Choose operations" }],
};

const config = {
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "secret-test-key",
  model: "openrouter/free",
  timeoutMs: 1_000,
};

describe("OpenRouterDecisionProvider", () => {
  it("requires and parses a complete direct HEAD/BODY task decision", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 3,
                  head: { kind: "continue" },
                  body: {
                    kind: "replace",
                    task: {
                      kind: "operation",
                      operationId: "core.wait",
                      arguments: { durationTicks: 10 },
                    },
                  },
                  reason: "Waiting is appropriate",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toEqual({
      schemaVersion: 3,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        task: {
          kind: "operation",
          operationId: "core.wait",
          arguments: { durationTicks: 10 },
        },
      },
      reason: "Waiting is appropriate",
    });
    const body = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    );
    expect(body).toMatchObject({
      model: "openrouter/free",
      messages: request.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "direct_task_decision",
          strict: true,
          schema: {
            required: ["schemaVersion", "head", "body", "reason"],
          },
        },
      },
    });
  });

  it("accepts the stable empty_task branch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 3,
                  head: {
                    kind: "replace",
                    task: { kind: "empty_task" },
                  },
                  body: { kind: "continue" },
                  reason: "Clear the idle track",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    await expect(
      provider.decide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      head: { kind: "replace", task: { kind: "empty_task" } },
      body: { kind: "continue" },
    });
  });

  it("rejects a legacy v2 assistant response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 2,
                  head: { kind: "continue" },
                  body: {
                    kind: "replace",
                    taskOptionId: "task-option:alice:wait",
                    arguments: {},
                  },
                  reason: "Legacy response",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    await expect(
      provider.decide(request, new AbortController().signal),
    ).rejects.toThrow();
  });

  it("never includes the API key in a provider error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`Authorization failed for Bearer ${config.apiKey}`, {
        status: 401,
      }),
    );
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    const error = await provider
      .decide(request, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(config.apiKey);
    expect(String(error)).toContain("401");
  });

  it("does not retain an unredacted network error as its cause", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(`Network failed with Bearer ${config.apiKey}`),
      );
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    const error = await provider
      .decide(request, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(config.apiKey);
    expect(String((error as Error).cause)).not.toContain(config.apiKey);
  });
});
