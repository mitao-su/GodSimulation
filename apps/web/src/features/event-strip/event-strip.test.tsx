// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorldViewSchema } from "@god-sim/protocol";

import { EventStrip } from "./event-strip";

afterEach(cleanup);

describe("event strip", () => {
  it("labels a recorded perception event", () => {
    const view = WorldViewSchema.parse({
      schemaVersion: 1,
      revision: 1,
      worldId: "test-world",
      worldName: "Test World",
      worldVersion: 0,
      worldTick: 0,
      mode: "THINKING",
      reviewRequired: true,
      pauseReason: null,
      map: { width: 1, height: 1, tileSize: 16, zones: [], tiles: [] },
      entities: [],
      agents: [],
      pendingDecisions: [],
      recentEvents: [
        {
          schemaVersion: 1,
          eventId: "event:test-world:1",
          worldId: "test-world",
          worldVersion: 0,
          worldTick: 0,
          sequence: 1,
          parentSequence: null,
          causationId: "initial-perception:alice:memory:start",
          correlationId: "initial-perception:alice:memory:start",
          type: "perception_recorded",
          agentId: "alice",
          observationKind: "memory",
          summary: "Test memory",
          relatedEntityId: null,
        },
      ],
      technicalFailure: null,
    });

    render(
      <EventStrip
        view={view}
        commandPending={false}
        onRelease={vi.fn()}
        onRetry={vi.fn()}
        onRetryTechnicalFailure={vi.fn()}
      />,
    );

    expect(screen.getByText("角色记录感知")).toBeVisible();
  });
});
