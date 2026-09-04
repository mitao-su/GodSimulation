import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  definePlugin,
  operationParametersJsonSchema,
  PluginManifestSchema,
  type ObjectDefinition,
} from "@god-sim/plugin-sdk";

import { proposeInteraction, queryObject } from "./interaction-router";
import { createSimulationRegistry } from "../engine/simulation-registry";
import { loadWorldDefinition } from "../map/map-loader";
import {
  simulationTestWorld,
  testPluginRegistry,
  testSimulationRulesLock,
} from "../testing/simulation-test-fixtures";

const guardedStateSchema = z.object({ holder: z.string().nullable() }).strict();

/**
 * A minimal world whose only interaction counts how often its duration
 * resolver runs, so tests can prove the execution lifecycle never
 * evaluates it.
 */
function countingResolverWorld() {
  let resolveCalls = 0;
  const guardedDefinition: ObjectDefinition<z.infer<typeof guardedStateSchema>> = {
    id: "test.guarded",
    version: "0.1.0",
    stateVersion: 1,
    displayName: "Guarded",
    tags: [],
    capabilities: ["approachable", "observable"],
    stateSchema: guardedStateSchema,
    initialState: () => ({ holder: null }),
    resourceId: "test.guarded",
    placement: {
      kind: "cell",
      footprint: [{ x: 0, y: 0 }],
      interactionOffsets: [{ x: 0, y: 1 }],
    },
    movement: { blocksMovement: () => true },
    interactions: [
      {
        id: "use",
        displayName: "Use guarded",
        trigger: "active_command",
        manual: {
          operationId: "object.test.guarded.use" as never,
          displayName: "Use guarded",
          summary: "Use this guarded object.",
          taskSlots: ["BODY"],
          parametersSchema: operationParametersJsonSchema(
            z.object({}).strict(),
          ),
          target: { kind: "none" },
          duration: { kind: "fixed" },
          worldPreconditions: [],
        },
        target: { kind: "none" },
        duration: { kind: "fixed" },
        taskSlots: ["BODY"],
        parametersSchema: z.object({}).strict(),
        resolveDuration: () => {
          resolveCalls += 1;
          return { kind: "fixed", totalTicks: 5 };
        },
        eventIgnore: [],
        publicBehavior: { kind: "visible", label: "using the guarded object" },
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
    observe: () => ({ status: "ok", summary: "Guarded", details: {} }),
  };
  const plugin = definePlugin(
    PluginManifestSchema.parse({
      schemaVersion: 1,
      id: "test.counting",
      version: "0.1.0",
      stateVersion: 1,
      engineApiVersion: 1,
      entry: "./dist/index.js",
      objectDefinitionIds: ["test.guarded"],
      agentDefinitionIds: ["test.carl"],
    }),
    {
      objects: [guardedDefinition],
      agents: [
        {
          id: "test.carl",
          version: "0.1.0",
          displayName: "Carl",
          persona: {
            background: "Test",
            personality: "Test",
            values: [],
            language: "Chinese",
            thinkingStyle: "Test",
          },
          initialMemories: [{ id: "test.carl.memory", summary: "Test memory" }],
          resourceId: "test.carl",
          animationSetId: "test.humanoid",
          operations: [],
        },
      ],
    },
  );
  const registry = createSimulationRegistry([plugin]);
  const world = loadWorldDefinition(
    {
      schemaVersion: 1,
      id: "test-counting-world",
      name: "Test Counting World",
      rules: { id: "default", version: 1 },
      tileSize: 16,
      width: 5,
      height: 5,
      plugins: [{ id: "test.counting", version: "0.1.0" }],
      floorRegions: [
        {
          x: 0,
          y: 0,
          width: 5,
          height: 5,
          resourceId: "test.floor",
          frameId: "plain",
        },
      ],
      zones: [{ id: "room", name: "Room", x: 0, y: 0, width: 5, height: 5 }],
      objects: [
        {
          id: "guarded-1",
          definitionId: "test.guarded",
          position: { x: 2, y: 2 },
          facing: "south",
          state: { holder: null },
        },
      ],
      spawns: [
        {
          agentId: "carl",
          definitionId: "test.carl",
          position: { x: 2, y: 3 },
          facing: "north",
          needs: { bladder: 10 },
        },
      ],
    },
    registry,
    { seed: 1, simulationRulesLock: testSimulationRulesLock },
  ).world;
  return { world, registry, resolveCalls: () => resolveCalls };
}

describe("queryObject", () => {
  it("does not change the world during a visibility query", () => {
    const world = simulationTestWorld();
    const beforeState = world.objects.get("wall-1" as never)?.state;

    const result = queryObject(world, testPluginRegistry, {
      type: "visibility",
      position: { x: 2, y: 2 },
      agentId: "alice" as never,
    });

    expect(result).toEqual({ type: "visibility", blocked: true, objectIds: ["wall-1"] });
    expect(world.objects.get("wall-1" as never)?.state).toBe(beforeState);
    expect(world.version).toBe(0);
  });

  it("returns plugin-owned interaction availability", () => {
    const world = simulationTestWorld();
    const result = queryObject(world, testPluginRegistry, {
      type: "available_interactions",
      entityId: "fridge-1" as never,
      agentId: "alice" as never,
    });

    expect(result).toMatchObject({
      type: "available_interactions",
      interactions: [
        {
          id: "use",
          taskSlots: ["BODY"],
          requiresParameters: false,
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
        {
          id: "stock",
          taskSlots: ["BODY"],
          requiresParameters: false,
          duration: { kind: "fixed", totalTicks: 10 },
          availability: { available: true },
        },
        {
          id: "configure",
          taskSlots: ["BODY"],
          requiresParameters: true,
          duration: null,
          availability: null,
        },
      ],
    });
  });

  it("marks required-parameter interactions instead of throwing", () => {
    const world = simulationTestWorld();

    const query = () =>
      queryObject(world, testPluginRegistry, {
        type: "available_interactions",
        entityId: "fridge-1" as never,
        agentId: "alice" as never,
      });

    expect(query).not.toThrow();
    const result = query();
    if (result.type !== "available_interactions") {
      throw new Error("Expected an available_interactions result");
    }
    const configure = result.interactions.find(
      (interaction) => interaction.id === "configure",
    );
    // A required-parameter interaction cannot be previewed with empty
    // arguments; the query must surface it explicitly rather than failing
    // or silently dropping it.
    expect(configure).toEqual({
      id: "configure",
      displayName: "Configure fridge",
      taskSlots: ["BODY"],
      requiresParameters: true,
      duration: null,
      availability: null,
    });
    // Interactions whose schema accepts empty arguments still preview.
    const use = result.interactions.find(
      (interaction) => interaction.id === "use",
    );
    expect(use?.requiresParameters).toBe(false);
    expect(use?.duration).toEqual({ kind: "fixed", totalTicks: 10 });
  });

  it("never invokes resolveDuration from the execution lifecycle", () => {
    // The duration of a call is locked exactly once by the operation
    // planner. By the time the router executes any lifecycle phase —
    // including `start` of an already-prepared call — the world may have
    // moved on, so the resolver must not run again here at all.
    const { world, registry, resolveCalls } = countingResolverWorld();

    for (const phase of ["start", "complete", "cancel", "fail"] as const) {
      const result = proposeInteraction(world, registry, {
        agentId: "carl" as never,
        entityId: "guarded-1" as never,
        interactionId: "use",
        parameters: {},
        phase,
        ...(phase === "fail" ? { failureCode: "broken" } : {}),
      });
      expect(result).toMatchObject({ accepted: true });
      expect(result).not.toHaveProperty("duration");
    }
    expect(resolveCalls()).toBe(0);
  });

  it("turns a valid interaction start into a proposal without applying it", () => {
    const world = simulationTestWorld();
    const result = proposeInteraction(world, testPluginRegistry, {
      agentId: "bob" as never,
      entityId: "fridge-1" as never,
      interactionId: "use",
      parameters: {},
      phase: "start",
    });

    expect(result).toMatchObject({
      accepted: true,
      proposal: {
        effects: [
          {
            type: "reserve_occupancy",
            entityId: "fridge-1",
            agentId: "bob",
            expectedObjectVersion: 0,
          },
        ],
      },
      taskSlots: ["BODY"],
    });
    expect(result).not.toHaveProperty("duration");
    expect(world.objects.get("fridge-1" as never)?.state).toEqual({ holder: null });
  });

  it("allows cancellation cleanup after the actor leaves interaction range", () => {
    const base = simulationTestWorld();
    const fridge = base.objects.get("fridge-1" as never)!;
    const world = {
      ...base,
      objects: new Map(base.objects).set(fridge.id, {
        ...fridge,
        version: 1,
        state: { holder: "alice" },
      }),
    };

    const result = proposeInteraction(world, testPluginRegistry, {
      agentId: "alice" as never,
      entityId: "fridge-1" as never,
      interactionId: "use",
      parameters: {},
      phase: "cancel",
    });

    expect(result).toMatchObject({
      accepted: true,
      proposal: {
        effects: [
          {
            type: "release_occupancy",
            entityId: "fridge-1",
            agentId: "alice",
            expectedObjectVersion: 1,
          },
        ],
      },
    });
  });
});
