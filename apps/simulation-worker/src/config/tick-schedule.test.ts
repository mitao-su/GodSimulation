import { describe, expect, it } from "vitest";

import { loadTickScheduleConfig } from "./tick-schedule";

describe("tick schedule deployment configuration", () => {
  it("keeps the default real-time interval outside simulation rules", () => {
    expect(loadTickScheduleConfig({})).toEqual({ intervalMs: 100 });
  });

  it("accepts a deployment-specific interval", () => {
    expect(
      loadTickScheduleConfig({ GOD_SIM_TICK_INTERVAL_MS: "25" }),
    ).toEqual({ intervalMs: 25 });
  });

  it("accepts Node's maximum supported timer interval", () => {
    expect(
      loadTickScheduleConfig({
        GOD_SIM_TICK_INTERVAL_MS: "2147483647",
      }),
    ).toEqual({ intervalMs: 2_147_483_647 });
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "fast",
    "2147483648",
    "9007199254740992",
  ])(
    "rejects invalid interval %s",
    (interval) => {
      expect(() =>
        loadTickScheduleConfig({ GOD_SIM_TICK_INTERVAL_MS: interval }),
      ).toThrow(/GOD_SIM_TICK_INTERVAL_MS/u);
    },
  );
});
