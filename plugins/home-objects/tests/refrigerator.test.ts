import { describe, expect, it } from "vitest";

import { InteractionContextSchema, ObservationContextSchema } from "@god-sim/plugin-sdk";

import { refrigeratorDefinition } from "../src/objects/refrigerator/definition";

const context = InteractionContextSchema.parse({
  worldTick: 12,
  trigger: "active_command",
  object: { entityId: "fridge-1", version: 3 },
  actor: {
    agentId: "alice",
    position: { x: 7, y: 2 },
    needs: { bladder: 40 },
  },
  distance: 1,
});

const visionContext = ObservationContextSchema.parse({
  kind: "vision",
  observerAgentId: "alice",
});

const useRefrigerator = refrigeratorDefinition.interactions[0];

describe("refrigerator definition", () => {
  it("rejects use while occupied by another agent", () => {
    expect(useRefrigerator?.canStart({ occupiedBy: "bob" }, context)).toMatchObject({
      available: false,
      reasonCode: "occupied",
    });
  });

  it("proposes reserving occupancy at interaction start", () => {
    expect(useRefrigerator?.start?.({ occupiedBy: null }, context).effects).toEqual([
      {
        type: "reserve_occupancy",
        entityId: "fridge-1",
        agentId: "alice",
        expectedObjectVersion: 3,
      },
    ]);
  });

  it("reveals occupancy only through its observable projection", () => {
    expect(
      refrigeratorDefinition.observe(
        { occupiedBy: "bob" },
        visionContext,
      ),
    ).toMatchObject({ details: { occupiedBy: "bob" } });
  });
});
