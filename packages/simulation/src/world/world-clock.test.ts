import { describe, expect, it } from "vitest";

import type { PluginLockHash, WorldMode } from "@god-sim/protocol";

import { advanceWorldClock } from "./world-clock";
import type { WorldState } from "./world-state";

function world(mode: WorldMode, tick = 12): WorldState {
  return {
    id: "starter-world" as WorldState["id"],
    name: "Starter Home",
    version: 0,
    tick,
    mode,
    suspendedMode: mode === "TECHNICALLY_BLOCKED" ? "THINKING" : null,
    reviewRequired: true,
    randomState: 123,
    lastEventSequence: 0,
    pluginLockHash: "0".repeat(64) as PluginLockHash,
    map: {
      schemaVersion: 1,
      id: "starter-world" as WorldState["id"],
      name: "Starter Home",
      tileSize: 16,
      width: 1,
      height: 1,
      plugins: [],
      floorRegions: [],
      decorations: [],
      zones: [],
      objects: [],
      spawns: [],
    },
    agents: new Map(),
    objects: new Map(),
    decisionCycle: null,
    technicalFailure: null,
  };
}

describe("advanceWorldClock", () => {
  it.each(["THINKING", "READY_FOR_RELEASE", "TECHNICALLY_BLOCKED"] as const)(
    "does not advance while %s",
    (mode) => expect(advanceWorldClock(world(mode)).tick).toBe(12),
  );

  it("advances exactly one integer tick while running", () => {
    const before = world("RUNNING");
    const after = advanceWorldClock(before);

    expect(after.tick).toBe(13);
    expect(after).not.toBe(before);
    expect(before.tick).toBe(12);
  });
});
