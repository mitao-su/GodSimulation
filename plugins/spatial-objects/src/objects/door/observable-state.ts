import type { ObservableObjectState } from "@god-sim/plugin-sdk";

import type { DoorState } from "./state";

export function observeDoor(state: Readonly<DoorState>): ObservableObjectState {
  return state.open
    ? { status: "open", summary: "Open door", details: { open: true } }
    : { status: "closed", summary: "Closed door", details: { open: false } };
}
