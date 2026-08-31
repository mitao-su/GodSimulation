import { describe, expect, it } from "vitest";

import {
  InteractionContextSchema,
  ObservationContextSchema,
} from "@god-sim/plugin-sdk";

import { toiletDefinition } from "../src/objects/toilet/definition";

const context = InteractionContextSchema.parse({
  worldTick: 20,
  trigger: "active_command",
  object: { entityId: "toilet-1", version: 2 },
  actor: {
    agentId: "alice",
    position: { x: 9, y: 6 },
    needs: { bladder: 82 },
  },
  distance: 1,
});

const useToilet = toiletDefinition.interactions[0];
const visionContext = ObservationContextSchema.parse({
  kind: "vision",
  observerAgentId: "alice",
});

describe("toilet definition", () => {
  it("proposes a bladder change and occupancy release on completion", () => {
    const state = Object.freeze({ occupiedBy: "alice" as const });
    const result = useToilet?.complete(state, context);

    expect(result?.effects).toEqual([
      {
        type: "set_agent_need",
        agentId: "alice",
        need: "bladder",
        value: 5,
      },
      {
        type: "release_occupancy",
        entityId: "toilet-1",
        agentId: "alice",
        expectedObjectVersion: 2,
      },
    ]);
    expect(state).toEqual({ occupiedBy: "alice" });
  });

  it("reports use as unavailable when another agent is observed using it", () => {
    expect(toiletDefinition.observe({ occupiedBy: "bob" }, visionContext)).toMatchObject({
      interactionAvailability: [
        {
          interactionId: "use",
          available: false,
          reasonCode: "occupied",
        },
      ],
    });
  });
});
