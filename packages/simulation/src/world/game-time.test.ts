import { describe, expect, it } from "vitest";

import {
  createCharacterTimeAnchors,
  projectCharacterElapsedTicks,
  projectCharacterTime,
  projectGameTime,
  ticksPerGameDay,
  ticksPerGameMinute,
} from "./game-time";

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

  it("projects character-visible time without exposing the source Tick", () => {
    const projection = projectCharacterTime(10, timeRules);

    expect(projection).toEqual({ day: 1, hour: 8, minute: 1 });
    expect(projection).not.toHaveProperty("worldTick");
    expect(projection).not.toHaveProperty("tick");
  });

  it("derives awake time from the last-wake anchor", () => {
    const anchors = createCharacterTimeAnchors(20);

    expect(projectCharacterElapsedTicks(35, anchors)).toEqual({
      awakeTicks: 15,
      sleepTicks: null,
      consolidationTicks: null,
    });
    expect(anchors).toEqual({
      lastWakeTick: 20,
      sleepStartedAtTick: null,
      consolidationStartedAtTick: null,
    });
  });

  it("derives sleep and consolidation durations without storing another clock", () => {
    const anchors = {
      lastWakeTick: 20,
      sleepStartedAtTick: 50,
      consolidationStartedAtTick: 55,
    } as const;

    expect(projectCharacterElapsedTicks(80, anchors)).toEqual({
      awakeTicks: 30,
      sleepTicks: 30,
      consolidationTicks: 25,
    });
    expect(projectCharacterElapsedTicks(90, anchors)).toEqual({
      awakeTicks: 30,
      sleepTicks: 40,
      consolidationTicks: 35,
    });
  });

  it.each([
    {
      worldTick: 10,
      anchors: {
        lastWakeTick: 11,
        sleepStartedAtTick: null,
        consolidationStartedAtTick: null,
      },
    },
    {
      worldTick: 20,
      anchors: {
        lastWakeTick: 10,
        sleepStartedAtTick: null,
        consolidationStartedAtTick: 15,
      },
    },
    {
      worldTick: 20,
      anchors: {
        lastWakeTick: 10,
        sleepStartedAtTick: 15,
        consolidationStartedAtTick: 14,
      },
    },
  ])("rejects inconsistent character Tick anchors %#", ({ worldTick, anchors }) => {
    expect(() => projectCharacterElapsedTicks(worldTick, anchors)).toThrow(/Tick|anchor/u);
  });

  it("rejects invalid Tick input instead of projecting an impossible time", () => {
    expect(() => projectGameTime(-1, timeRules)).toThrow(/worldTick/u);
    expect(() => projectGameTime(1.5, timeRules)).toThrow(/worldTick/u);
  });
});
