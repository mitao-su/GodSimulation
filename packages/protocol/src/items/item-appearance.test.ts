import { describe, expect, it } from "vitest";

import {
  AppearanceDescriptionSchema,
  AgentBodyFactsSnapshotSchema,
  BodyFactsSchema,
  CharacterAppearanceStateSchema,
  ItemInstanceSchema,
  PublicAppearanceProjectionSchema,
} from "./item-appearance";

const description = {
  schemaVersion: 1,
  externallyVisible: {
    head: "short brown hair",
    upperBody: "blue shirt",
    lowerBody: "black trousers",
  },
  internallyHidden: {
    head: "nothing",
    upperBody: "undershirt",
    lowerBody: "nothing",
  },
} as const;

describe("L2 item and appearance contracts", () => {
  it("keeps item capacity on definitions rather than instances", () => {
    const instance = {
      id: "item:shirt:1",
      definition: { definitionId: "clothing.shirt", version: "1" },
      version: 0,
      quantity: 1,
      ownership: { kind: "carried", agentId: "alice" },
      state: {},
    } as const;

    expect(ItemInstanceSchema.parse(instance)).toEqual(instance);
    expect(
      ItemInstanceSchema.safeParse({ ...instance, capacityUnits: 1 }).success,
    ).toBe(false);
    expect(ItemInstanceSchema.safeParse({ ...instance, ownership: null }).success).toBe(false);
  });

  it("accepts unknown body facts without inventing fields", () => {
    expect(BodyFactsSchema.parse({ schemaVersion: 1, hairColor: "brown" })).toEqual({
      schemaVersion: 1,
      hairColor: "brown",
    });
    expect(BodyFactsSchema.safeParse({ schemaVersion: 1, eyeColor: "blue" }).success).toBe(
      false,
    );
  });

  it("requires all six appearance fields and isolates the public projection", () => {
    const appearance = CharacterAppearanceStateSchema.parse({
      wornItemIds: ["item:shirt:1"],
      description,
    });
    expect(AppearanceDescriptionSchema.parse(description)).toEqual(description);
    expect(
      PublicAppearanceProjectionSchema.parse({
        externallyVisible: appearance.description.externallyVisible,
      }),
    ).toEqual({ externallyVisible: description.externallyVisible });
    expect(
      PublicAppearanceProjectionSchema.safeParse({
        externallyVisible: description.externallyVisible,
        internallyHidden: description.internallyHidden,
      }).success,
    ).toBe(false);
  });

  it("stores authoritative appearance without duplicating active operation parameters", () => {
    const snapshot = AgentBodyFactsSnapshotSchema.parse({
      agentId: "alice",
      bodyFacts: { schemaVersion: 1 },
      appearance: { wornItemIds: [], description },
    });
    expect(snapshot).toEqual({
      agentId: "alice",
      bodyFacts: { schemaVersion: 1 },
      appearance: { wornItemIds: [], description },
    });
    expect(
      AgentBodyFactsSnapshotSchema.safeParse({
        ...snapshot,
        pendingAppearanceAfter: [],
      }).success,
    ).toBe(false);
  });
});

