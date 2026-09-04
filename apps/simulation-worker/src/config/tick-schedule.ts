const DEFAULT_TICK_INTERVAL_MS = 100;

export interface TickScheduleConfig {
  readonly intervalMs: number;
}

export function loadTickScheduleConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TickScheduleConfig {
  const configured = environment.GOD_SIM_TICK_INTERVAL_MS;
  if (configured === undefined) return { intervalMs: DEFAULT_TICK_INTERVAL_MS };

  const intervalMs = Number(configured);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("GOD_SIM_TICK_INTERVAL_MS must be a positive safe integer");
  }
  return { intervalMs };
}
