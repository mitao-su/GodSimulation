import type {
  ObservableObjectState,
  ObservationContext,
} from "@god-sim/plugin-sdk";

import type { RefrigeratorState } from "./state";

export function observeRefrigerator(
  state: Readonly<RefrigeratorState>,
  context: ObservationContext,
): ObservableObjectState {
  const summary =
    state.occupiedBy === null
      ? "Available refrigerator"
      : `Refrigerator used by ${state.occupiedBy}`;
  const available =
    state.occupiedBy === null || state.occupiedBy === context.observerAgentId;
  return {
    status: state.occupiedBy === null ? "available" : "occupied",
    summary,
    details: { occupiedBy: state.occupiedBy },
    interactionAvailability: available
      ? [{ interactionId: "use", available: true }]
      : [
          {
            interactionId: "use",
            available: false,
            reasonCode: "occupied",
            summary,
          },
        ],
  };
}
