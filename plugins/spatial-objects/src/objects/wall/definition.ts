import type { ObjectDefinition } from "@god-sim/plugin-sdk";

import { observeWall } from "./observable-state";
import { WallStateSchema, type WallState } from "./state";

export const wallDefinition: ObjectDefinition<WallState> = {
  id: "spatial.wall",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Wall",
  tags: ["structure", "movement-blocker", "vision-occluder"],
  stateSchema: WallStateSchema,
  initialState: () => ({}),
  resourceId: "pixel-16-interiors.wall",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ],
  },
  movement: {
    blocksMovement: () => true,
  },
  vision: {
    blocksVision: () => true,
  },
  interactions: [],
  observe: observeWall,
};
