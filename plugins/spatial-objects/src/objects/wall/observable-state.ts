import type { ObservableObjectState } from "@god-sim/plugin-sdk";

export function observeWall(): ObservableObjectState {
  return { status: "solid", summary: "Wall", details: {} };
}
