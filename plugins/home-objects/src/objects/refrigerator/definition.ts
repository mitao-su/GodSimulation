import type { ObjectDefinition } from "@god-sim/plugin-sdk";

import { useRefrigeratorInteraction } from "./interactions";
import { observeRefrigerator } from "./observable-state";
import { RefrigeratorStateSchema, type RefrigeratorState } from "./state";

export const refrigeratorDefinition: ObjectDefinition<RefrigeratorState> = {
  id: "home.refrigerator",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Refrigerator",
  tags: ["home", "food", "occupiable"],
  stateSchema: RefrigeratorStateSchema,
  initialState: () => ({ occupiedBy: null }),
  resourceId: "pixel-16-interiors.refrigerator",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [{ x: 0, y: 1 }],
  },
  movement: {
    blocksMovement: () => true,
  },
  vision: {
    blocksVision: () => true,
  },
  occupancy: {
    capacity: 1,
    occupant: (state) => state.occupiedBy,
    withOccupant: (state, occupant) => ({ ...state, occupiedBy: occupant }),
  },
  interactions: [useRefrigeratorInteraction],
  observe: observeRefrigerator,
};
