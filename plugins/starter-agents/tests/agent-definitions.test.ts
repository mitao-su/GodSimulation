import { describe, expect, it } from "vitest";

import { aliceDefinition } from "../src/agents/alice";
import { bobDefinition } from "../src/agents/bob";

describe("starter agent definitions", () => {
  const expectedOperationIds = [
    "core.move",
    "core.observe",
    "core.read",
    "core.recall",
    "core.speak",
    "core.wait",
  ];

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

  it.each([aliceDefinition, bobDefinition])(
    "$displayName explicitly mounts the complete starter operation set",
    (definition) => {
      expect(
        definition.operations.map((operation) => operation.operationId).sort(),
      ).toEqual(expectedOperationIds);
      expect(
        definition.operations.every(
          (operation) => operation.manual.operationId === operation.operationId,
        ),
      ).toBe(true);
    },
  );
});
