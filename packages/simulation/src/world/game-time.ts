import type { GameTimeView, SimulationRules } from "@god-sim/protocol";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

type TimeRules = SimulationRules["time"];

export function ticksPerGameMinute(rules: TimeRules): number {
  return SECONDS_PER_MINUTE / rules.secondsPerGameTick;
}

export function ticksPerGameDay(rules: TimeRules): number {
  return SECONDS_PER_DAY / rules.secondsPerGameTick;
}

export function projectGameTime(worldTick: number, rules: TimeRules): GameTimeView {
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
