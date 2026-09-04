import type { GameTimeView, SimulationRules } from "@god-sim/protocol";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

type TimeRules = SimulationRules["time"];

export type CharacterTimeProjection = Readonly<GameTimeView>;

export interface CharacterTimeAnchors {
  readonly lastWakeTick: number;
  readonly sleepStartedAtTick: number | null;
  readonly consolidationStartedAtTick: number | null;
}

export interface CharacterElapsedTicks {
  readonly awakeTicks: number;
  readonly sleepTicks: number | null;
  readonly consolidationTicks: number | null;
}

function assertTick(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer Tick`);
  }
}

export function ticksPerGameMinute(rules: TimeRules): number {
  return SECONDS_PER_MINUTE / rules.secondsPerGameTick;
}

export function ticksPerGameDay(rules: TimeRules): number {
  return SECONDS_PER_DAY / rules.secondsPerGameTick;
}

export function projectGameTime(worldTick: number, rules: TimeRules): GameTimeView {
  assertTick(worldTick, "worldTick");
  const elapsedSeconds = worldTick * rules.secondsPerGameTick;
  const epochSeconds =
    rules.epoch.hour * SECONDS_PER_HOUR + rules.epoch.minute * SECONDS_PER_MINUTE;
  const absoluteSeconds = epochSeconds + elapsedSeconds;
  const elapsedDays = Math.floor(absoluteSeconds / SECONDS_PER_DAY);
  const secondsWithinDay = absoluteSeconds % SECONDS_PER_DAY;

  return {
    day: rules.epoch.day + elapsedDays,
    hour: Math.floor(secondsWithinDay / SECONDS_PER_HOUR),
    minute: Math.floor((secondsWithinDay % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  };
}

export function projectCharacterTime(
  worldTick: number,
  rules: TimeRules,
): CharacterTimeProjection {
  const { day, hour, minute } = projectGameTime(worldTick, rules);
  return { day, hour, minute };
}

export function createCharacterTimeAnchors(
  initialWakeTick: number,
): CharacterTimeAnchors {
  assertTick(initialWakeTick, "initialWakeTick");
  return {
    lastWakeTick: initialWakeTick,
    sleepStartedAtTick: null,
    consolidationStartedAtTick: null,
  };
}

export function projectCharacterElapsedTicks(
  worldTick: number,
  anchors: CharacterTimeAnchors,
): CharacterElapsedTicks {
  assertTick(worldTick, "worldTick");
  assertTick(anchors.lastWakeTick, "lastWakeTick");
  if (anchors.lastWakeTick > worldTick) {
    throw new Error("lastWakeTick cannot be later than worldTick");
  }

  const sleepStartedAtTick = anchors.sleepStartedAtTick;
  if (sleepStartedAtTick === null) {
    if (anchors.consolidationStartedAtTick !== null) {
      throw new Error("consolidationStartedAtTick requires an active sleep anchor");
    }
    return {
      awakeTicks: worldTick - anchors.lastWakeTick,
      sleepTicks: null,
      consolidationTicks: null,
    };
  }

  assertTick(sleepStartedAtTick, "sleepStartedAtTick");
  if (sleepStartedAtTick < anchors.lastWakeTick || sleepStartedAtTick > worldTick) {
    throw new Error(
      "sleepStartedAtTick must be between lastWakeTick and worldTick",
    );
  }

  const consolidationStartedAtTick = anchors.consolidationStartedAtTick;
  if (consolidationStartedAtTick !== null) {
    assertTick(consolidationStartedAtTick, "consolidationStartedAtTick");
    if (
      consolidationStartedAtTick < sleepStartedAtTick ||
      consolidationStartedAtTick > worldTick
    ) {
      throw new Error(
        "consolidationStartedAtTick must be between sleepStartedAtTick and worldTick",
      );
    }
  }

  return {
    awakeTicks: sleepStartedAtTick - anchors.lastWakeTick,
    sleepTicks: worldTick - sleepStartedAtTick,
    consolidationTicks:
      consolidationStartedAtTick === null
        ? null
        : worldTick - consolidationStartedAtTick,
  };
}
