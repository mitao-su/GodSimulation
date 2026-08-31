import { describe, expect, it } from "vitest";

import { simulationTestWorld, testPlugin } from "../testing/simulation-test-fixtures";
import { assertSnapshotCausality } from "./snapshot-causality";
import { createSimulation } from "./simulation-engine";

function strictSnapshot() {
  const snapshot = createSimulation({
    worldDefinition: simulationTestWorld().map,
    plugins: [testPlugin],
    reviewRequired: true,
    seed: 1,
    pluginLockHash: "a".repeat(64),
  }).createSnapshot();
  if (snapshot.schemaVersion !== 2) {
    throw new Error("Expected a version-two snapshot fixture");
  }
  return snapshot;
}

describe("snapshot causality", () => {
  it("accepts a complete strict snapshot", () => {
    expect(() => assertSnapshotCausality(strictSnapshot())).not.toThrow();
  });

  it("rejects a strict snapshot that omits a subjective source", () => {
    const snapshot = strictSnapshot();
    const missing = snapshot.causalEventIds[0];
    if (!missing) throw new Error("Fixture has no causal source");

    expect(() =>
      assertSnapshotCausality({
        ...snapshot,
        causalEventIds: snapshot.causalEventIds.slice(1),
      }),
    ).toThrow(new RegExp(`alice.*${missing}`, "i"));
  });

  it.each([
    {
      name: "duplicate",
      mutate: (snapshot: ReturnType<typeof strictSnapshot>) => ({
        ...snapshot,
        causalEventIds: [
          snapshot.causalEventIds[0]!,
          ...snapshot.causalEventIds,
        ],
      }),
      message: /duplicate/i,
    },
    {
      name: "another world",
      mutate: (snapshot: ReturnType<typeof strictSnapshot>) => ({
        ...snapshot,
        causalEventIds: ["event:another-world:1" as never],
      }),
      message: /world/i,
    },
    {
      name: "past the event tail",
      mutate: (snapshot: ReturnType<typeof strictSnapshot>) => ({
        ...snapshot,
        causalEventIds: [
          `event:${snapshot.worldId}:${snapshot.lastEventSequence + 1}` as never,
        ],
      }),
      message: /sequence|tail/i,
    },
  ])("rejects a $name causal reference", ({ mutate, message }) => {
    expect(() => assertSnapshotCausality(mutate(strictSnapshot()))).toThrow(message);
  });
});
