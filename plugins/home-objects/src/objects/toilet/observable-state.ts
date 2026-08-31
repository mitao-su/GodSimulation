import type {
  ObservableObjectState,
  ObservationContext,
} from "@god-sim/plugin-sdk";

import type { ToiletState } from "./state";

export function observeToilet(
  state: Readonly<ToiletState>,
  context: ObservationContext,
): ObservableObjectState {
  const summary =
    state.occupiedBy === null ? "Available toilet" : `Toilet used by ${state.occupiedBy}`;
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
