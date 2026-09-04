import { describe, expect, it } from "vitest";
import { z } from "zod";

import { definePlugin, PluginManifestSchema, type ObjectDefinition } from "@god-sim/plugin-sdk";

import { SimulationRulesLockSchema } from "@god-sim/protocol";

import { loadWorldDefinition } from "./map-loader";
import { createPluginRegistry } from "../world/plugin-registry";

const testDoor: ObjectDefinition<{ open: boolean; locked: boolean }> = {
  id: "test.door",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Door",
  tags: ["door"],
  capabilities: ["approachable", "observable"],
  stateSchema: z.object({ open: z.boolean(), locked: z.boolean() }).strict(),
  initialState: () => ({ open: false, locked: false }),
  resourceId: "test.door",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [{ x: 0, y: 1 }],
  },
  interactions: [],
  observe: (state) => ({
    status: state.open ? "open" : "closed",
    summary: state.open ? "Open door" : "Closed door",
    details: { open: state.open },
  }),
};

const registry = createPluginRegistry([
  definePlugin(
    PluginManifestSchema.parse({
      schemaVersion: 1,
      id: "test.plugin",
      version: "0.1.0",
      stateVersion: 1,
      engineApiVersion: 1,
      entry: "./dist/index.js",
      objectDefinitionIds: ["test.door"],
      agentDefinitionIds: ["test.alice"],
    }),
    {
      objects: [testDoor],
      agents: [
        {
          id: "test.alice",
          version: "0.1.0",
          displayName: "Alice",
          persona: {
            background: "Test",
            personality: "Test",
            values: [],
            language: "Chinese",
            thinkingStyle: "Test",
          },
          initialMemories: [{ id: "start", summary: "Test memory" }],
          resourceId: "test.alice",
          animationSetId: "test.humanoid",
          operations: [],
        },
      ],
    },
  ),
]);

const simulationRulesLock = SimulationRulesLockSchema.parse({
  hash: "c".repeat(64),
  rules: {
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
  },
});

function validMap() {
  return {
    schemaVersion: 1,
    id: "test-world",
    name: "Test World",
    rules: { id: "default", version: 1 },
    tileSize: 16,
    width: 4,
    height: 4,
    plugins: [
      { id: "test.plugin", version: "0.1.0" },
    ],
    floorRegions: [
      {
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        resourceId: "pixel-16-interiors.floor",
        frameId: "wood",
      },
    ],
    zones: [{ id: "room", name: "Room", x: 0, y: 0, width: 4, height: 4 }],
    objects: [
      {
        id: "door-1",
        definitionId: "test.door",
        position: { x: 2, y: 1 },
        facing: "south",
        state: { open: false, locked: false },
      },
    ],
    spawns: [
      {
        agentId: "alice",
        definitionId: "test.alice",
        position: { x: 1, y: 1 },
        facing: "east",
        needs: { bladder: 20 },
      },
    ],
  };
}

function loadTestWorld(input: unknown) {
  return loadWorldDefinition(input, registry, { simulationRulesLock });
}

describe("loadWorldDefinition", () => {
  it("rejects a world without an explicit simulation rule reference", () => {
    const withoutRules: Partial<ReturnType<typeof validMap>> = { ...validMap() };
    delete withoutRules.rules;

    expect(() => loadTestWorld(withoutRules)).toThrow(/rules/iu);
  });

  it("creates instance state owned by the world", () => {
    const world = loadTestWorld(validMap()).world;

    expect(world.objects.get("door-1" as never)).toMatchObject({
      definitionId: "test.door",
      version: 0,
      state: { open: false, locked: false },
    });
    expect(world.agents.get("alice" as never)).toMatchObject({
      definitionId: "test.alice",
      bladder: 20,
    });
    expect(world.mode).toBe("THINKING");
    expect(world.simulationRulesLock).toEqual(simulationRulesLock);
  });

  it("rejects a rule lock that does not match the world's rule reference", () => {
    const mismatchedLock = SimulationRulesLockSchema.parse({
      ...simulationRulesLock,
      rules: { ...simulationRulesLock.rules, version: 2 },
    });

    expect(() =>
      loadWorldDefinition(validMap(), registry, {
        simulationRulesLock: mismatchedLock,
      }),
    ).toThrow(/simulation rules.*reference/i);
  });

  it("returns empty subjective state and deterministic initial perception seeds", () => {
    const base = validMap();
    const input = {
      ...base,
      spawns: base.spawns.map((spawn) => ({
        ...spawn,
        knownObjectIds: ["door-1"],
      })),
    };

    const loaded = loadTestWorld(input);
    const alice = loaded.world.agents.get("alice" as never)!;

    expect(alice.knowledge.objects.size).toBe(0);
    expect(alice.memories).toEqual([]);
    expect(loaded.initialPerceptions).toEqual([
      {
        kind: "known_object",
        agentId: "alice",
        entityId: "door-1",
        displayName: "Door",
        position: { x: 2, y: 1 },
        summary: "Remembers where Door is",
      },
      {
        kind: "memory",
        agentId: "alice",
        memoryId: "start",
        summary: "Test memory",
      },
    ]);
  });

  it("rejects an object whose definition is not registered", () => {
    const base = validMap();
    const input = {
      ...base,
      objects: [{ ...base.objects[0]!, definitionId: "missing.object" }],
    };

    expect(() => loadTestWorld(input)).toThrow(/missing\.object/);
  });

  it("rejects plugin state that violates the definition schema", () => {
    const base = validMap();
    const input = {
      ...base,
      objects: [{ ...base.objects[0]!, state: { open: "yes", locked: false } }],
    };

    expect(() => loadTestWorld(input)).toThrow(/door-1/);
  });

  it("rejects footprints that leave map bounds", () => {
    const base = validMap();
    const input = {
      ...base,
      objects: [{ ...base.objects[0]!, position: { x: 4, y: 1 } }],
    };

    expect(() => loadTestWorld(input)).toThrow(/bounds/i);
  });

  it("rejects a render-only decoration outside the map", () => {
    const input = {
      ...validMap(),
      decorations: [
        {
          id: "rug-1",
          position: { x: 4, y: 1 },
          resourceId: "pixel-16-interiors.carpet",
          frameId: "blue",
          renderLayer: 5,
        },
      ],
    };

    expect(() => loadTestWorld(input)).toThrow(/decoration.*bounds/i);
  });
});
