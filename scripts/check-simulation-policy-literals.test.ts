import { describe, expect, it } from "vitest";

import { findPolicyLiteralViolations } from "./check-simulation-policy-literals.mjs";

describe("simulation policy literal gate", () => {
  it.each([
    ["const DEFAULT_MOVE_TICKS_PER_CELL = 2;", "tickspercell"],
    ["const rules = { attenuationPerWall: 0.5 };", "attenuationperwall"],
    [
      "const schema = { durationTicks: z.number().int().max(600) };",
      "durationticks",
    ],
    ["if (capacityUnits > 9) throw new Error();", "capacityunits"],
    [
      "const rules = { rankingWeights: { semanticSimilarity: 0.55 } };",
      "rankingweights.semanticsimilarity",
    ],
  ])("rejects centralized policy literal: %s", (source, policyName) => {
    expect(
      findPolicyLiteralViolations(source, "packages/simulation/src/example.ts"),
    ).toEqual([expect.objectContaining({ policyName })]);
  });

  it("allows protocol versions, indexes, and pure conversion constants", () => {
    const source = [
      "const schema = { schemaVersion: z.literal(1) };",
      "const first = values[0];",
      "const SECONDS_PER_MINUTE = 60;",
      "const HOURS_PER_DAY = 24;",
      "const next = index + 1;",
      "const action = { durationTicks: (path.length - 1) * ticksPerCell };",
    ].join("\n");

    expect(
      findPolicyLiteralViolations(source, "packages/simulation/src/example.ts"),
    ).toEqual([]);
  });

  it("allows fixed durations owned by a versioned plugin definition", () => {
    expect(
      findPolicyLiteralViolations(
        'const duration = { kind: "fixed", totalTicks: 3 };',
        "plugins/spatial-objects/src/objects/door/interactions.ts",
      ),
    ).toEqual([]);
  });

  it("allows fixed values used only by legacy snapshot migration", () => {
    expect(
      findPolicyLiteralViolations(
        "const Legacy = { durationTicks: z.number().max(600) };",
        "packages/simulation/src/engine/snapshot-migrations/legacy-snapshot.ts",
      ),
    ).toEqual([]);
  });

  it("does not scan tests as production policy owners", () => {
    expect(
      findPolicyLiteralViolations(
        "const rules = { secondsPerGameTick: 6 };",
        "packages/simulation/src/example.test.ts",
      ),
    ).toEqual([]);
  });
});
