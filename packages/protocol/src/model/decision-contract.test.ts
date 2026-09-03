import { describe, expect, it } from "vitest";

import {
  DecisionPromptInputSchema,
  ModelDecisionResultSchema,
} from "./decision-contract";

const identity = {
  requestId: "request-1",
  agentId: "alice",
  worldId: "starter-world",
  worldVersion: 3,
  decisionCycleId: "cycle-1",
  schemaVersion: 1,
  pluginLockHash: "a".repeat(64),
} as const;

const emptyActiveTasks = {
  tracks: { HEAD: null, BODY: null },
  operations: [],
} as const;

const waitOption = {
  kind: "operation",
  id: "task-option:alice:wait",
  operationId: "core.wait",
  label: "Wait",
  taskSlots: ["BODY"],
  argumentSchema: {
    type: "object",
    properties: { durationTicks: { type: "integer", minimum: 1, maximum: 600 } },
    required: ["durationTicks"],
    additionalProperties: false,
  },
  fixedArguments: {},
} as const;

describe("decision contract", () => {
  it("rejects a legacy single-goal proposal as a current model result", () => {
    expect(
      ModelDecisionResultSchema.safeParse({
        ...identity,
        proposal: {
          schemaVersion: 1,
          goalOptionId: "use-toilet-1",
          reason: "I need the toilet",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a complete decision for both task tracks", () => {
    expect(
      ModelDecisionResultSchema.parse({
        ...identity,
        proposal: {
          schemaVersion: 2,
          head: { kind: "continue" },
          body: {
            kind: "replace",
            taskOptionId: "task-option:alice:wait",
            arguments: { durationTicks: 10 },
          },
          reason: "Wait briefly",
        },
      }).proposal,
    ).toEqual({
      schemaVersion: 2,
      head: { kind: "continue" },
      body: {
        kind: "replace",
        taskOptionId: "task-option:alice:wait",
        arguments: { durationTicks: 10 },
      },
      reason: "Wait briefly",
    });
  });

  it("requires complete frozen-world identity on a model result", () => {
    expect(
      ModelDecisionResultSchema.safeParse({
        requestId: "request-1",
        proposal: {
          schemaVersion: 2,
          head: { kind: "continue" },
          body: { kind: "continue" },
          reason: "Continue",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts active tasks and task options in subjective prompt input", () => {
    const parsed = DecisionPromptInputSchema.parse({
      ...identity,
      decisionReason: { code: "initial_task", summary: "Choose initial tasks" },
      bodySensations: [],
      activeTasks: emptyActiveTasks,
      memories: [],
      perception: {
        zoneId: "living-room",
        visibleEntities: [],
        heardEvents: [],
      },
      taskOptions: [waitOption],
    });

    expect(parsed.activeTasks).toEqual(emptyActiveTasks);
    expect(parsed.taskOptions).toEqual([waitOption]);
  });

  it("rejects legacy goal fields and objective world state in current input", () => {
    const base = {
      ...identity,
      decisionReason: { code: "initial_task", summary: "Choose initial tasks" },
      bodySensations: [],
      activeTasks: emptyActiveTasks,
      memories: [],
      perception: {
        zoneId: "living-room",
        visibleEntities: [],
        heardEvents: [],
      },
      taskOptions: [waitOption],
    };

    expect(
      DecisionPromptInputSchema.safeParse({
        ...base,
        currentGoal: null,
      }).success,
    ).toBe(false);
    expect(
      DecisionPromptInputSchema.safeParse({
        ...base,
        worldState: { objects: { "fridge-1": { occupiedBy: "bob" } } },
      }).success,
    ).toBe(false);
  });
});
