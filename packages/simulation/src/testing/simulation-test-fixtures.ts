import { z } from "zod";

import {
  definePlugin,
  PluginManifestSchema,
  type AgentDefinition,
  type ObjectDefinition,
} from "@god-sim/plugin-sdk";
import { createSimulationRulesLock } from "@god-sim/protocol";

import { loadWorldDefinition } from "../map/map-loader";
import type { RegisteredOperation } from "../execution/operation-runtime";
import { createSimulationRegistry } from "../engine/simulation-registry";

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
      taskSlots: ["BODY"],
      parametersSchema: z.object({}).strict(),
      resolveDuration: () => ({ kind: "fixed", totalTicks: 10 }),
      eventIgnore: [],
      publicBehavior: { kind: "visible", label: "using the fridge" },
      domainFailures: [{ code: "occupied", summary: "Fridge occupied" }],
      resultSchema: z
        .object({ status: z.enum(["completed", "cancelled", "failed"]) })
        .strict(),
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
        result: { status: "completed" },
      }),
      fail: (state, context) => ({
        effects:
          state.holder === context.actor.agentId
            ? [
                {
                  type: "release_occupancy" as const,
                  entityId: context.object.entityId,
                  agentId: context.actor.agentId,
                  expectedObjectVersion: context.object.version,
                },
              ]
            : [],
        result: { status: "failed" },
      }),
      cancel: (state, context) => ({
        effects:
          state.holder === context.actor.agentId
            ? [
                {
                  type: "release_occupancy" as const,
                  entityId: context.object.entityId,
                  agentId: context.actor.agentId,
                  expectedObjectVersion: context.object.version,
                },
              ]
            : [],
        result: { status: "cancelled" },
      }),
      fuse: () => null,
    },
    {
      id: "stock",
      displayName: "Stock fridge",
      trigger: "active_command",
      taskSlots: ["BODY"],
      parametersSchema: z.object({}).strict(),
      // Deliberately state-dependent: starting the interaction reserves
      // occupancy, which changes `state.holder` and therefore what this
      // resolver returns. Restoration must trust the duration locked at
      // call creation instead of re-evaluating this resolver.
      resolveDuration: (state) => ({
        kind: "fixed",
        totalTicks: state.holder === null ? 10 : 20,
      }),
      eventIgnore: [],
      publicBehavior: { kind: "visible", label: "stocking the fridge" },
      domainFailures: [{ code: "occupied", summary: "Fridge occupied" }],
      resultSchema: z.object({}).strict(),
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
      fail: () => ({ effects: [] }),
      cancel: () => ({ effects: [] }),
      fuse: () => null,
    },
    {
      id: "configure",
      displayName: "Configure fridge",
      trigger: "active_command",
      taskSlots: ["BODY"],
      // Deliberately parameter-requiring: `available_interactions` queries
      // cannot preview this interaction with empty arguments and must
      // surface it as parameter-requiring instead of throwing.
      parametersSchema: z.object({ mode: z.enum(["eco", "turbo"]) }).strict(),
      resolveDuration: (_state, _context, parameters) => ({
        kind: "fixed",
        totalTicks: parameters.mode === "turbo" ? 4 : 8,
      }),
      eventIgnore: [],
      publicBehavior: { kind: "visible", label: "configuring the fridge" },
      domainFailures: [],
      resultSchema: z.object({}).strict(),
      canStart: () => ({ available: true }),
      start: () => ({ effects: [] }),
      complete: () => ({ effects: [] }),
      fail: () => ({ effects: [] }),
      cancel: () => ({ effects: [] }),
      fuse: () => null,
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

export const testPluginRegistry = createSimulationRegistry([testPlugin]);

const synchronizedWaitOperation: RegisteredOperation = {
  id: "test.synchronized_wait" as never,
  ownerPluginId: null,
  taskSlots: ["HEAD", "BODY"],
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "waiting" },
  domainFailures: [],
  resultSchema: z.object({}).strict(),
  stateSchema: z.object({}).strict(),
  argumentsSchema: () =>
    z.object({ durationTicks: z.number().int().positive() }).strict(),
  initialState: () => ({}),
  offers: () => [],
  canStart: () => ({ available: true }),
  resolveDuration: (_context, value) => ({
    kind: "fixed",
    totalTicks: z.number().int().positive().parse(value["durationTicks"]),
  }),
  createPlan: (_context, value, callId) => {
    const durationTicks = z.number().int().positive().parse(value["durationTicks"]);
    return {
      kind: "prepared",
      plan: {
        currentActionIndex: 0,
        actions: [
          {
            id: `${callId}:action:0`,
            kind: "wait",
            durationTicks,
            progressTicks: 0,
          },
        ],
      },
    };
  },
  fuse: () => null,
  acknowledgeFuseResult: (_context, operation) => operation,
  terminalResult: () => ({}),
  validateRestored: () => undefined,
};
(testPluginRegistry.operations as Map<unknown, RegisteredOperation>).set(
  synchronizedWaitOperation.id,
  synchronizedWaitOperation,
);

export const testSimulationRulesLock = createSimulationRulesLock({
    schemaVersion: 1,
    id: "default",
    version: 1,
    time: { secondsPerGameTick: 6, epoch: { day: 1, hour: 8, minute: 0 } },
    context: { attentionBudgetTokens: 200_000, technicalHardLimitTokens: 200_000 },
    fatigue: {
      timeWeight: 0.6,
      tokenWeight: 0.4,
      forcedSleepThreshold: 0.6,
      timePressureFullAtTicks: 43_200,
    },
    inventory: { capacityUnits: 9 },
    operations: {
      move: { ticksPerCell: 2 },
      wait: { defaultDurationTicks: 600, maxDurationTicks: 600 },
      observe: { durationTicks: 1 },
    },
    memory: {
      importance: {
        critical: { initialStrength: 1, halfLifeDays: 90 },
        high: { initialStrength: 1, halfLifeDays: 30 },
        normal: { initialStrength: 1, halfLifeDays: 7 },
        low: { initialStrength: 1, halfLifeDays: 2 },
      },
      deletionThreshold: 0.1,
      recall: {
        maxReturnTokensPerOperation: 8_000,
        rankingWeights: {
          semanticSimilarity: 0.55,
          keywordMatch: 0.25,
          currentStrength: 0.2,
        },
      },
    },
    sound: {
      speakSourceStrength: { quiet: 1, normal: 2, loud: 4 },
      attenuationPerTile: 0.25,
      attenuationPerWall: 1,
      attenuationPerOpenDoor: 0.1,
      attenuationPerClosedDoor: 0.75,
      fullContentThreshold: 1,
      unclearContentThreshold: 0.25,
    },
});

export function simulationTestWorld() {
  return loadWorldDefinition(
    {
      schemaVersion: 1,
      id: "test-world",
      name: "Test World",
      rules: { id: "default", version: 1 },
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
    { seed: 1, simulationRulesLock: testSimulationRulesLock },
  ).world;
}
