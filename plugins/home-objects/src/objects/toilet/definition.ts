import type { ObjectDefinition } from "@god-sim/plugin-sdk";

import { useToiletInteraction } from "./interactions";
import { observeToilet } from "./observable-state";
import { ToiletStateSchema, type ToiletState } from "./state";

export const toiletDefinition: ObjectDefinition<ToiletState> = {
  id: "home.toilet",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Toilet",
  tags: ["home", "bathroom", "occupiable", "need-effect-provider"],
  stateSchema: ToiletStateSchema,
  initialState: () => ({ occupiedBy: null }),
  resourceId: "pixel-16-interiors.toilet",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [{ x: 0, y: 1 }],
  },
  movement: {
    blocksMovement: () => true,
  },
  occupancy: {
    capacity: 1,
    occupant: (state) => state.occupiedBy,
    withOccupant: (state, occupant) => ({ ...state, occupiedBy: occupant }),
  },
  interactions: [useToiletInteraction],
  observe: observeToilet,
};
