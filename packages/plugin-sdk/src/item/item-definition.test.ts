import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ItemDefinitionIdSchema } from "@god-sim/protocol";

import { assertItemDefinition } from "./item-definition";

describe("item definition skeleton", () => {
  it("requires a style anchor for clothing and validates integer capacity", () => {
    expect(() =>
      assertItemDefinition({
        id: ItemDefinitionIdSchema.parse("clothing.shirt"),
        version: "1",
        displayName: "Shirt",
        kind: "clothing",
        tags: ["clothing"],
        capabilities: ["wearable"],
        capacityUnits: 1,
        stateSchema: z.object({}).strict(),
        initialState: () => ({}),
      }),
    ).toThrow(/style anchor/);
  });

  it("accepts generic definitions and rejects fractional capacity", () => {
    const definition = {
      id: ItemDefinitionIdSchema.parse("item.apple"),
      version: "1",
      displayName: "Apple",
      kind: "generic" as const,
      tags: ["food"],
      capabilities: ["edible"],
      capacityUnits: 1,
      stateSchema: z.object({}).strict(),
      initialState: () => ({}),
    };
    expect(() => assertItemDefinition(definition)).not.toThrow();
    expect(() => assertItemDefinition({ ...definition, capacityUnits: 0.5 })).toThrow();
    expect(() => assertItemDefinition({ ...definition, version: "" })).toThrow();
    expect(() => assertItemDefinition({ ...definition, capabilities: ["food", "food"] })).toThrow();
  });
});

