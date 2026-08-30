import type { ObservableObjectState } from "@god-sim/plugin-sdk";

import type { ToiletState } from "./state";

export function observeToilet(state: Readonly<ToiletState>): ObservableObjectState {
  return state.occupiedBy === null
    ? { status: "available", summary: "Available toilet", details: { occupiedBy: null } }
    : {
        status: "occupied",
        summary: `Toilet used by ${state.occupiedBy}`,
        details: { occupiedBy: state.occupiedBy },
      };
}
