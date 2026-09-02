import { describe, expect, it } from "vitest";

import { WorldViewSchema } from "./world-view";

const view = {
  schemaVersion: 1,
  revision: 1,
  worldId: "starter-world",
  worldName: "Starter Home",
  worldVersion: 2,
  worldTick: 0,
  gameTime: { day: 1, hour: 8, minute: 0 },
  mode: "THINKING",
  reviewRequired: true,
  pauseReason: {
    code: "initial_goal",
    message: "Alice and Bob need a first goal",
    agentIds: ["alice", "bob"],
  },
  map: {
    width: 12,
    height: 8,
    tileSize: 16,
    zones: [],
    tiles: [],
  },
  entities: [
    {
      entityId: "fridge-1",
      kind: "object",
      displayName: "Refrigerator",
      resourceId: "home-objects.refrigerator",
      position: { x: 8, y: 2 },
      facing: "south",
      renderLayer: 20,
      status: "available",
    },
  ],
  agents: [
    {
      agentId: "alice",
      displayName: "Alice",
      headTask: { kind: "empty", label: null },
      bodyTask: {
        kind: "operation",
        callId: "operation-call:alice:body",
        operationId: "core.wait",
        label: "Wait",
        duration: { kind: "fixed", totalTicks: 10 },
        progressTicks: 3,
      },
      bladderLevel: "comfortable",
      decisionStatus: "thinking",
      perceivedSummaries: [],
      memorySummaries: [],
    },
  ],
  pendingDecisions: [],
  recentEvents: [],
  technicalFailure: null,
} as const;

describe("world view", () => {
  it("accepts a read-only projection", () => {
    expect(WorldViewSchema.parse(view)).toMatchObject({
      worldTick: 0,
      gameTime: { day: 1, hour: 8, minute: 0 },
    });
  });

  it("requires a Tick-derived game time projection", () => {
    const withoutGameTime = { ...view };
    Reflect.deleteProperty(withoutGameTime, "gameTime");

    expect(WorldViewSchema.safeParse(withoutGameTime).success).toBe(false);
  });

  it("rejects hidden plugin state in render entities", () => {
    const unsafe = {
      ...view,
      entities: [{ ...view.entities[0], internalState: { occupiedBy: "bob" } }],
    };
    expect(WorldViewSchema.safeParse(unsafe).success).toBe(false);
  });
});
