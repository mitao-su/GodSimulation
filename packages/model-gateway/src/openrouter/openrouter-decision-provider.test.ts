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
  decisionReason: { code: "initial_goal", summary: "Choose a goal" },
  messages: [{ role: "user", content: "Choose one offered goal" }],
  goalOptions: [
    {
      id: "wait-10" as never,
      label: "Wait",
      goal: { kind: "wait", durationTicks: 10 },
    },
  ],
};

const config = {
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "secret-test-key",
  model: "openrouter/free",
  timeoutMs: 1_000,
};

describe("OpenRouterDecisionProvider", () => {
  it("parses only the returned assistant content as a goal proposal", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "response-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  schemaVersion: 1,
                  goalOptionId: "wait-10",
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

    await expect(provider.decide(request, new AbortController().signal)).resolves.toEqual({
      schemaVersion: 1,
      goalOptionId: "wait-10",
      reason: "Waiting is appropriate",
    });
    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "openrouter/free",
      messages: request.messages,
    });
  });

  it("never includes the API key in a provider error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`Authorization failed for Bearer ${config.apiKey}`, { status: 401 }),
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
      .mockRejectedValue(new Error(`Network failed with Bearer ${config.apiKey}`));
    const provider = new OpenRouterDecisionProvider(config, fetchImplementation);

    const error = await provider
      .decide(request, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(config.apiKey);
    expect(String((error as Error).cause)).not.toContain(config.apiKey);
  });
});
