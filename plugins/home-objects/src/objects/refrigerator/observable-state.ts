import type { ObservableObjectState } from "@god-sim/plugin-sdk";

import type { RefrigeratorState } from "./state";

export function observeRefrigerator(
  state: Readonly<RefrigeratorState>,
): ObservableObjectState {
  return state.occupiedBy === null
    ? { status: "available", summary: "Available refrigerator", details: { occupiedBy: null } }
    : {
        status: "occupied",
        summary: `Refrigerator used by ${state.occupiedBy}`,
        details: { occupiedBy: state.occupiedBy },
      };
}
