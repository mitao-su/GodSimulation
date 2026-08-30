import { describe, expect, it } from "vitest";

import { aliceDefinition } from "../src/agents/alice";
import { bobDefinition } from "../src/agents/bob";

describe("starter agent definitions", () => {
  it.each([aliceDefinition, bobDefinition])(
    "$displayName contains persona and memory data but no runtime state",
    (definition) => {
      expect(definition.persona.background.length).toBeGreaterThan(0);
      expect(definition.initialMemories.length).toBeGreaterThan(0);
      expect(definition).not.toHaveProperty("position");
      expect(definition).not.toHaveProperty("bladder");
      expect(definition).not.toHaveProperty("currentGoal");
    },
  );
});
