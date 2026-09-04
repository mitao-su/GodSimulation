import type { ObjectDefinition } from "@god-sim/plugin-sdk";

import { doorInteractions } from "./interactions";
import { observeDoor } from "./observable-state";
import { DoorStateSchema, type DoorState } from "./state";

export const doorDefinition: ObjectDefinition<DoorState> = {
  id: "spatial.door",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Door",
  tags: ["structure", "door", "lockable"],
  capabilities: ["approachable", "observable"],
  stateSchema: DoorStateSchema,
  initialState: () => ({ open: false, locked: false }),
  resourceId: "pixel-16-interiors.door",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ],
  },
  movement: {
    blocksMovement: (state) => !state.open,
  },
  vision: {
    blocksVision: (state) => !state.open,
  },
  traversal: { interactionId: "open" },
  interactions: doorInteractions,
  observe: observeDoor,
};
