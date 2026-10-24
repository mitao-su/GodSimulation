import { describe, expect, it } from "vitest";

import {
  assertAppearanceState,
  projectExternallyVisibleAppearance,
} from "./appearance";
import { BodyFactsSchema, CharacterAppearanceStateSchema } from "@god-sim/protocol";

const value = {
  bodyFacts: BodyFactsSchema.parse({ schemaVersion: 1, hairColor: "brown" }),
  appearance: CharacterAppearanceStateSchema.parse({
    wornItemIds: [],
    description: {
      schemaVersion: 1,
      externallyVisible: { head: "hair", upperBody: "shirt", lowerBody: "trousers" },
      internallyHidden: { head: "nothing", upperBody: "undershirt", lowerBody: "nothing" },
    },
  }),
};

describe("appearance SDK skeleton", () => {
  it("validates body facts and projects only the external section", () => {
    expect(() => assertAppearanceState(value)).not.toThrow();
    expect(projectExternallyVisibleAppearance(value)).toEqual(
      value.appearance.description.externallyVisible,
    );
  });
});
