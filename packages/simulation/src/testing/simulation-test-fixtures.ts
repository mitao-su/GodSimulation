import { z } from "zod";

import {
  definePlugin,
  PluginManifestSchema,
  type AgentDefinition,
  type ObjectDefinition,
} from "@god-sim/plugin-sdk";

import { loadWorldDefinition } from "../map/map-loader";
import { createPluginRegistry } from "../world/plugin-registry";

const wallDefinition: ObjectDefinition<Record<string, never>> = {
  id: "test.wall",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Wall",
  tags: ["wall"],
  stateSchema: z.object({}).strict(),
  initialState: () => ({}),
  resourceId: "test.wall",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [{ x: 0, y: 1 }],
  },
  movement: { blocksMovement: () => true },
  vision: { blocksVision: () => true },
  interactions: [],
  observe: () => ({ status: "solid", summary: "Wall", details: {} }),
};

const fridgeState = z.object({ holder: z.string().nullable() }).strict();
type FridgeState = z.infer<typeof fridgeState>;

const fridgeDefinition: ObjectDefinition<FridgeState> = {
  id: "test.fridge",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Fridge",
  tags: ["occupiable"],
  stateSchema: fridgeState,
  initialState: () => ({ holder: null }),
  resourceId: "test.fridge",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [{ x: 0, y: 1 }],
  },
  movement: { blocksMovement: () => true },
  occupancy: {
    capacity: 1,
    occupant: (state) => state.holder,
    withOccupant: (state, occupant) => ({ ...state, holder: occupant }),
  },
  interactions: [
    {
      id: "use",
      displayName: "Use fridge",
      trigger: "active_command",
      durationTicks: 10,
      slots: ["HANDS", "BODY"],
      canStart: (state, context) =>
        state.holder === null || state.holder === context.actor.agentId
          ? { available: true }
          : { available: false, reasonCode: "occupied", summary: "Fridge occupied" },
      start: (_state, context) => ({
        effects: [
          {
            type: "reserve_occupancy",
            entityId: context.object.entityId,
            agentId: context.actor.agentId,
            expectedObjectVersion: context.object.version,
          },
        ],
      }),
      complete: (_state, context) => ({
        effects: [
          {
            type: "release_occupancy",
            entityId: context.object.entityId,
            agentId: context.actor.agentId,
            expectedObjectVersion: context.object.version,
          },
        ],
      }),
    },
  ],
  observe: (state, context) => ({
    status: state.holder === null ? "available" : "occupied",
    summary: state.holder === null ? "Available" : `Used by ${state.holder}`,
    details: { holder: state.holder },
    interactionAvailability:
      state.holder === null || state.holder === context.observerAgentId
        ? [{ interactionId: "use", available: true }]
        : [
            {
              interactionId: "use",
              available: false,
              reasonCode: "occupied",
              summary: "Fridge occupied",
            },
          ],
  }),
};

const agentDefinition = (id: string, displayName: string): AgentDefinition => ({
  id,
  version: "0.1.0",
  displayName,
  persona: {
    background: "Test",
    personality: "Test",
    values: [],
    language: "Chinese",
    thinkingStyle: "Test",
  },
  initialMemories: [{ id: `${id}.memory`, summary: "Test memory" }],
  resourceId: `test.${id}`,
  animationSetId: "test.humanoid",
});

export const testPlugin = definePlugin(
  PluginManifestSchema.parse({
    schemaVersion: 1,
    id: "test.simulation",
    version: "0.1.0",
    stateVersion: 1,
    engineApiVersion: 1,
    entry: "./dist/index.js",
    objectDefinitionIds: ["test.wall", "test.fridge"],
    agentDefinitionIds: ["test.alice", "test.bob"],
  }),
  {
    objects: [wallDefinition, fridgeDefinition],
    agents: [agentDefinition("test.alice", "Alice"), agentDefinition("test.bob", "Bob")],
  },
);

export const testPluginRegistry = createPluginRegistry([testPlugin]);

export function simulationTestWorld() {
  return loadWorldDefinition(
    {
      schemaVersion: 1,
      id: "test-world",
      name: "Test World",
      tileSize: 16,
      width: 6,
      height: 5,
      plugins: [{ id: "test.simulation", version: "0.1.0" }],
      floorRegions: [
        {
          x: 0,
          y: 0,
          width: 6,
          height: 5,
          resourceId: "test.floor",
          frameId: "plain",
        },
      ],
      zones: [{ id: "room", name: "Room", x: 0, y: 0, width: 6, height: 5 }],
      objects: [
        {
          id: "wall-1",
          definitionId: "test.wall",
          position: { x: 2, y: 2 },
          facing: "north",
          state: {},
        },
        {
          id: "fridge-1",
          definitionId: "test.fridge",
          position: { x: 4, y: 1 },
          facing: "south",
          state: { holder: null },
        },
      ],
      spawns: [
        {
          agentId: "alice",
          definitionId: "test.alice",
          position: { x: 3, y: 2 },
          facing: "north",
          needs: { bladder: 30 },
        },
        {
          agentId: "bob",
          definitionId: "test.bob",
          position: { x: 4, y: 2 },
          facing: "north",
          needs: { bladder: 20 },
        },
      ],
    },
    testPluginRegistry,
    { seed: 1 },
  ).world;
}
