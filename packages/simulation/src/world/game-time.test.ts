import { describe, expect, it } from "vitest";

import { projectGameTime, ticksPerGameDay, ticksPerGameMinute } from "./game-time";

const timeRules = {
  secondsPerGameTick: 6,
  epoch: { day: 1, hour: 8, minute: 0 },
} as const;

describe("game time projection", () => {
  it("derives time units from seconds per Tick", () => {
    expect(ticksPerGameMinute(timeRules)).toBe(10);
    expect(ticksPerGameDay(timeRules)).toBe(14_400);
  });

  it.each([
    { worldTick: 0, expected: { day: 1, hour: 8, minute: 0 } },
    { worldTick: 9, expected: { day: 1, hour: 8, minute: 0 } },
    { worldTick: 10, expected: { day: 1, hour: 8, minute: 1 } },
    { worldTick: 9_600, expected: { day: 2, hour: 0, minute: 0 } },
  ])("projects Tick $worldTick from the configured epoch", ({ worldTick, expected }) => {
    expect(projectGameTime(worldTick, timeRules)).toEqual(expected);
  });
});
