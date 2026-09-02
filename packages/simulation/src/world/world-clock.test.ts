import { describe, expect, it } from "vitest";

import type { PluginLockHash, WorldMode } from "@god-sim/protocol";

import { testSimulationRulesLock } from "../testing/simulation-test-fixtures";
import { advanceWorldClock } from "./world-clock";
import { projectGameTime } from "./game-time";
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
    simulationRulesLock: testSimulationRulesLock,
    history: { mode: "strict", causalFromSequence: 1 },
    map: {
      schemaVersion: 1,
      id: "starter-world" as WorldState["id"],
      name: "Starter Home",
      rules: { id: "default" as never, version: 1 },
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

  it.each(["THINKING", "READY_FOR_RELEASE", "TECHNICALLY_BLOCKED"] as const)(
    "keeps projected time unchanged while %s",
    (mode) => {
      const before = world(mode, 9);
      const after = advanceWorldClock(before);

      expect(projectGameTime(after.tick, after.simulationRulesLock.rules.time)).toEqual(
        projectGameTime(before.tick, before.simulationRulesLock.rules.time),
      );
    },
  );

  it("changes the projected minute only when a running Tick crosses its boundary", () => {
    const beforeBoundary = world("RUNNING", 8);
    const stillSameMinute = advanceWorldClock(beforeBoundary);
    const boundary = advanceWorldClock(stillSameMinute);

    expect(projectGameTime(beforeBoundary.tick, beforeBoundary.simulationRulesLock.rules.time))
      .toEqual({ day: 1, hour: 8, minute: 0 });
    expect(projectGameTime(stillSameMinute.tick, stillSameMinute.simulationRulesLock.rules.time))
      .toEqual({ day: 1, hour: 8, minute: 0 });
    expect(projectGameTime(boundary.tick, boundary.simulationRulesLock.rules.time))
      .toEqual({ day: 1, hour: 8, minute: 1 });
  });
});
