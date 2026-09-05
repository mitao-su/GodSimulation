import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import {
  definePlugin,
  EmptyOperationArgumentsSchema,
  EmptyOperationResultSchema,
  operationParametersJsonSchema,
  PluginManifestSchema,
  type ObjectDefinition,
} from "@god-sim/plugin-sdk";
import {
  acceptDecisionResult,
  buildTaskOptions,
  createSimulationRegistry,
  loadWorldDefinition,
  prepareOperationCall,
  projectWorldSnapshot,
  recoverBlockedOperation,
  releaseDecisionCycle,
  requestDecisions,
  restoreWorldSnapshot,
  runTickPipeline,
} from "@god-sim/simulation";
import { wallDefinition } from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";

interface PassageState {
  readonly raised: boolean;
  readonly sealed: boolean;
}

const PassageStateSchema = {
  parse(input: unknown): PassageState {
    if (
      typeof input !== "object" ||
      input === null ||
      !("raised" in input) ||
      typeof input.raised !== "boolean" ||
      !("sealed" in input) ||
      typeof input.sealed !== "boolean"
    ) {
      throw new Error("Passage state requires raised and sealed booleans");
    }
    return { raised: input.raised, sealed: input.sealed };
  },
} as unknown as ObjectDefinition<PassageState>["stateSchema"];

const passageDefinition: ObjectDefinition<PassageState> = {
  id: "test.passage",
  version: "0.1.0",
  stateVersion: 1,
  displayName: "Passage",
  tags: [],
  capabilities: ["approachable", "observable"],
  stateSchema: PassageStateSchema,
  initialState: () => ({ raised: false, sealed: false }),
  resourceId: "test.passage",
  placement: {
    kind: "cell",
    footprint: [{ x: 0, y: 0 }],
    interactionOffsets: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ],
  },
  movement: { blocksMovement: (state) => !state.raised },
  vision: { blocksVision: (state) => !state.raised },
  traversal: { interactionId: "raise" },
  interactions: [
    {
      id: "raise",
      displayName: "Raise passage",
      trigger: "active_command",
      manual: {
        operationId: "object.test.passage.raise" as never,
        displayName: "Raise passage",
        summary: "Raise this passage so it can be traversed.",
        taskSlots: ["BODY"],
        parametersSchema: operationParametersJsonSchema(
          EmptyOperationArgumentsSchema,
        ),
        target: { kind: "none" },
        duration: { kind: "fixed" },
        worldPreconditions: [
          {
            failureCode: "already_raised",
            description: "The passage may already be raised.",
          },
          {
            failureCode: "sealed",
            description: "A sealed passage cannot be raised.",
          },
        ],
      },
      target: { kind: "none" },
      duration: { kind: "fixed" },
      taskSlots: ["BODY"],
      parametersSchema: EmptyOperationArgumentsSchema,
      resolveDuration: () => ({ kind: "fixed", totalTicks: 3 }),
      eventIgnore: [],
      publicBehavior: { kind: "visible", label: "raising the passage" },
      arbitrationFailureMappings: {},
      domainFailures: [
        {
          code: "already_raised",
          summary: "Passage is already raised",
          detailsSchema: EmptyOperationArgumentsSchema,
          resultSchema: EmptyOperationResultSchema,
        },
        {
          code: "sealed",
          summary: "Passage is sealed",
          detailsSchema: EmptyOperationArgumentsSchema,
          resultSchema: EmptyOperationResultSchema,
        },
      ],
      resultSchema: EmptyOperationResultSchema,
      canStart: (state) =>
        state.raised
          ? {
              available: false,
              reasonCode: "already_raised",
              summary: "Passage is already raised",
            }
          : state.sealed
          ? { available: false, reasonCode: "sealed", summary: "Passage is sealed" }
          : { available: true },
      complete: (state, context) => ({
        effects: [
          {
            type: "replace_object_state",
            entityId: context.object.entityId,
            expectedObjectVersion: context.object.version,
            state: { ...state, raised: true },
          },
        ],
      }),
      fail: (_state, context, _argumentsValue, failureCode) => ({
        effects: [
          {
            type: "emit_perceptible_result",
            sourceEntityId: context.object.entityId,
            audienceAgentIds: [context.actor.agentId],
            senses: ["vision"],
            summary: `Raise passage failed: ${failureCode}`,
          },
        ],
      }),
      cancel: () => ({ effects: [] }),
      fuse: () => null,
    },
  ],
  observe: (state) => ({
    status: state.raised ? "raised" : "lowered",
    summary: state.raised ? "Raised passage" : "Lowered passage",
    details: { raised: state.raised },
  }),
};

const passagePlugin = definePlugin(
  PluginManifestSchema.parse({
    schemaVersion: 1,
    id: "test.navigation",
    version: "0.1.0",
    stateVersion: 1,
    engineApiVersion: 1,
    entry: "./dist/index.js",
    objectDefinitionIds: ["spatial.wall", "test.passage"],
    agentDefinitionIds: [],
  }),
  { objects: [wallDefinition, passageDefinition], agents: [] },
);

const inertPassageDefinition: ObjectDefinition<PassageState> = {
  ...passageDefinition,
  id: "test.inert-passage",
  displayName: "Inert passage",
  resourceId: "test.inert-passage",
  interactions: [
    {
      ...passageDefinition.interactions[0]!,
      manual: {
        ...passageDefinition.interactions[0]!.manual,
        operationId: "object.test.inert-passage.raise" as never,
      },
      complete: () => ({ effects: [] }),
    },
  ],
};

const inertPassagePlugin = definePlugin(
  PluginManifestSchema.parse({
    schemaVersion: 1,
    id: "test.inert-navigation",
    version: "0.1.0",
    stateVersion: 1,
    engineApiVersion: 1,
    entry: "./dist/index.js",
    objectDefinitionIds: ["spatial.wall", "test.inert-passage"],
    agentDefinitionIds: [],
  }),
  { objects: [wallDefinition, inertPassageDefinition], agents: [] },
);

/**
 * A traversal whose lifecycle speaks a non-empty result protocol. Its
 * result shape is valid for the interaction itself but incompatible with
 * the enclosing move operation's result schema, which is exactly the
 * protocol confusion the engine must prevent.
 */
const PassageResultSchema = EmptyOperationResultSchema.passthrough() as unknown as ObjectDefinition<PassageState>["interactions"][number]["resultSchema"];

const resultingPassageDefinition: ObjectDefinition<PassageState> = {
  ...passageDefinition,
  id: "test.resulting-passage",
  displayName: "Resulting passage",
  resourceId: "test.resulting-passage",
  interactions: [
    {
      ...passageDefinition.interactions[0]!,
      manual: {
        ...passageDefinition.interactions[0]!.manual,
        operationId: "object.test.resulting-passage.raise" as never,
      },
      resultSchema: PassageResultSchema,
      domainFailures: passageDefinition.interactions[0]!.domainFailures.map(
        (failure) => ({ ...failure, resultSchema: PassageResultSchema }),
      ),
      fail: () => ({ effects: [], result: { status: "failed" } }),
      cancel: () => ({ effects: [], result: { status: "cancelled" } }),
    },
  ],
};

const resultingPassagePlugin = definePlugin(
  PluginManifestSchema.parse({
    schemaVersion: 1,
    id: "test.resulting-navigation",
    version: "0.1.0",
    stateVersion: 1,
    engineApiVersion: 1,
    entry: "./dist/index.js",
    objectDefinitionIds: ["spatial.wall", "test.resulting-passage"],
    agentDefinitionIds: [],
  }),
  { objects: [wallDefinition, resultingPassageDefinition], agents: [] },
);

const anonymousPassageWorld = {
  ...starterHome,
  plugins: starterHome.plugins.map((plugin) =>
    plugin.id === "god-sim.spatial-objects"
      ? { id: "test.navigation", version: "0.1.0" }
      : plugin,
  ),
  objects: starterHome.objects.map((object) => {
    if (object.definitionId !== "spatial.door") return object;
    const state = object.state as { open: boolean; locked: boolean };
    return {
      ...object,
      definitionId: "test.passage",
      state: { raised: state.open, sealed: state.locked },
    };
  }),
};

const inertPassageWorld = {
  ...anonymousPassageWorld,
  plugins: anonymousPassageWorld.plugins.map((plugin) =>
    plugin.id === "test.navigation"
      ? { id: "test.inert-navigation", version: "0.1.0" }
      : plugin,
  ),
  objects: anonymousPassageWorld.objects.map((object) =>
    object.definitionId === "test.passage"
      ? { ...object, definitionId: "test.inert-passage" }
      : object,
  ),
};

const resultingPassageWorld = {
  ...anonymousPassageWorld,
  plugins: anonymousPassageWorld.plugins.map((plugin) =>
    plugin.id === "test.navigation"
      ? { id: "test.resulting-navigation", version: "0.1.0" }
      : plugin,
  ),
  objects: anonymousPassageWorld.objects.map((object) =>
    object.definitionId === "test.passage"
      ? { ...object, definitionId: "test.resulting-passage" }
      : object,
  ),
};

const registry = createSimulationRegistry([passagePlugin, homePlugin, agentsPlugin]);
const inertRegistry = createSimulationRegistry([
  inertPassagePlugin,
  homePlugin,
  agentsPlugin,
]);
const resultingRegistry = createSimulationRegistry([
  resultingPassagePlugin,
  homePlugin,
  agentsPlugin,
]);
const moveToFridge = {
  kind: "operation" as const,
  id: "task-option:alice:move-fridge" as never,
  operationId: "core.move" as never,
  label: "Move to refrigerator",
  taskSlots: ["BODY" as const],
  argumentSchema: {},
  fixedArguments: { targetEntityId: "fridge-1" },
};

function world() {
  return loadWorldDefinition(anonymousPassageWorld, registry, {
    simulationRulesLock: testSimulationRulesLock,
  }).world;
}

function inertWorld() {
  return loadWorldDefinition(inertPassageWorld, inertRegistry, {
    simulationRulesLock: testSimulationRulesLock,
  }).world;
}

function resultingWorld() {
  return loadWorldDefinition(resultingPassageWorld, resultingRegistry, {
    simulationRulesLock: testSimulationRulesLock,
  }).world;
}

function activateTraversal(
  baseWorld: ReturnType<typeof world>,
  activeRegistry: typeof registry,
  started: boolean,
) {
  const prepared = prepareOperationCall(
    baseWorld,
    activeRegistry,
    "alice" as never,
    moveToFridge,
    {},
    "operation-call:alice:move-fridge" as never,
  );
  if (prepared.kind !== "prepared") throw new Error(prepared.summary);
  const actionIndex = prepared.operation.plan.actions.findIndex(
    (action) =>
      action.kind === "interact_object" &&
      action.purpose === "automatic_traversal" &&
      action.targetEntityId === "door-living-kitchen",
  );
  const action = prepared.operation.plan.actions[actionIndex];
  const approach = prepared.operation.plan.actions[actionIndex - 1];
  if (action?.kind !== "interact_object" || approach?.kind !== "move") {
    throw new Error("Fixture route has no automatic traversal approach");
  }
  const agent = baseWorld.agents.get("alice" as never);
  if (!agent) throw new Error("Fixture has no Alice");
  const actions = [...prepared.operation.plan.actions];
  actions[actionIndex] = {
    ...action,
    started,
    progressTicks: started ? action.durationTicks - 1 : 0,
  };
  const operation = {
    ...prepared.operation,
    progressTicks: 7,
    plan: {
      ...prepared.operation.plan,
      actions,
      currentActionIndex: actionIndex,
    },
  };
  return {
    ...baseWorld,
    mode: "RUNNING" as const,
    agents: new Map(baseWorld.agents).set(agent.id, {
      ...agent,
      position: approach.path.at(-1)!,
      taskTracks: {
        HEAD: { kind: "empty" as const },
        BODY: {
          kind: "operation" as const,
          callId: operation.callId,
        },
      },
      activeOperations: new Map([[operation.callId, operation]]),
    }),
  };
}

function blocker(entityId: string) {
  return {
    entityId: entityId as never,
    observedObjectVersion: 0,
    reasonCode: "sealed",
    sourceEventId: `event:starter-world:${entityId}` as never,
  };
}

describe("capability-based traversal recovery", () => {
  it("plans automatic traversal without furniture tags or conventional state fields", () => {
    const result = prepareOperationCall(
      world(),
      registry,
      "alice" as never,
      moveToFridge,
      {},
      "operation-call:alice:move-fridge" as never,
    );

    expect(result.kind).toBe("prepared");
    if (result.kind !== "prepared") return;
    expect(
      result.operation.plan.actions.map((action) =>
        action.kind === "interact_object"
          ? `${action.kind}:${action.purpose}:${action.interactionId}`
          : action.kind,
      ),
    ).toEqual([
      "move",
      "interact_object:automatic_traversal:raise",
      "move",
    ]);
  });

  it("reroutes the same call without thought when another known route exists", () => {
    const active = activateTraversal(world(), registry, false);
    const before = active.agents
      .get("alice" as never)!
      .activeOperations.get("operation-call:alice:move-fridge" as never)!;
    const result = recoverBlockedOperation(
      active,
      registry,
      "alice" as never,
      {
        callId: before.callId,
        entityId: "door-living-kitchen" as never,
        observedObjectVersion: 0,
        reasonCode: "sealed",
        sourceEventId: "event:starter-world:failure-1" as never,
      },
      { knownTraversalBlockers: new Map() },
    );

    expect(result.kind).toBe("replanned");
    if (result.kind !== "replanned") return;
    expect(result.knowledge.knownTraversalBlockers.get("door-living-kitchen" as never))
      .toMatchObject({ reasonCode: "sealed", sourceEventId: "event:starter-world:failure-1" });
    expect(result.operation).toMatchObject({
      callId: before.callId,
      startedAtTick: before.startedAtTick,
      progressTicks: before.progressTicks,
    });
    expect(
      result.operation.plan.actions.filter(
        (action) =>
          action.kind === "interact_object" &&
          action.purpose === "automatic_traversal",
      ).length,
    ).toBeGreaterThan(1);
  });

  it("asks for a decision only after all known routes fail", () => {
    const active = activateTraversal(world(), registry, false);
    const operation = active.agents
      .get("alice" as never)!
      .activeOperations.get("operation-call:alice:move-fridge" as never)!;
    const result = recoverBlockedOperation(
      active,
      registry,
      "alice" as never,
      {
        callId: operation.callId,
        entityId: "door-living-kitchen" as never,
        observedObjectVersion: 0,
        reasonCode: "sealed",
        sourceEventId: "event:starter-world:failure-2" as never,
      },
      {
        knownTraversalBlockers: new Map([
          ["door-bedroom-bathroom" as never, blocker("door-bedroom-bathroom")],
        ]),
      },
    );

    expect(result).toMatchObject({ kind: "needs_decision", reasonCode: "no_known_route" });
  });

  it("records a rejected traversal as an event-backed blocker before rerouting", () => {
    const baseWorld = activateTraversal(world(), registry, false);
    const passage = baseWorld.objects.get("door-living-kitchen" as never);
    if (!passage) throw new Error("Fixture has no living-room passage");
    const result = runTickPipeline(
      {
        ...baseWorld,
        objects: new Map(baseWorld.objects).set(passage.id, {
          ...passage,
          state: { raised: false, sealed: true },
        }),
      },
      registry,
    );
    const failure = result.events.find((event) => event.type === "action_failed");
    if (!failure || failure.type !== "action_failed") {
      throw new Error("Traversal rejection did not produce action_failed");
    }

    expect(failure).toMatchObject({
      reasonCode: "sealed",
      summary: "Passage is sealed",
      entityId: "door-living-kitchen",
    });
    expect(
      result.world.agents
        .get("alice" as never)
        ?.knowledge.knownTraversalBlockers.get("door-living-kitchen" as never),
    ).toEqual({
      entityId: "door-living-kitchen",
      observedObjectVersion: passage.version,
      reasonCode: "sealed",
      sourceEventId: failure.eventId,
    });
    expect(result.decisionNeeds).toEqual([]);
    expect(
      result.events.find(
        (event) => event.type === "perceptible_result_emitted",
      ),
    ).toMatchObject({
      type: "perceptible_result_emitted",
      sourceEntityId: "door-living-kitchen",
      audienceAgentIds: ["alice"],
      summary: "Raise passage failed: sealed",
    });
    expect(
      result.events.some((event) => event.type === "operation_terminated"),
    ).toBe(false);
  });

  it("terminates the move only when blocker knowledge leaves no route", () => {
    const active = activateTraversal(world(), registry, false);
    const alice = active.agents.get("alice" as never)!;
    const passage = active.objects.get("door-living-kitchen" as never)!;
    const exhausted = {
      ...active,
      agents: new Map(active.agents).set(alice.id, {
        ...alice,
        knowledge: {
          ...alice.knowledge,
          knownTraversalBlockers: new Map([
            [
              "door-bedroom-bathroom" as never,
              blocker("door-bedroom-bathroom"),
            ],
          ]),
        },
      }),
      objects: new Map(active.objects).set(passage.id, {
        ...passage,
        state: { raised: false, sealed: true },
      }),
    };

    const result = runTickPipeline(exhausted, registry);

    expect(result.decisionNeeds).toEqual([
      {
        agentId: "alice",
        reason: { code: "no_known_route", summary: "Passage is sealed" },
      },
    ]);
    expect(
      result.events.filter((event) => event.type === "operation_terminated"),
    ).toEqual([
      expect.objectContaining({
        type: "operation_terminated",
        agentId: "alice",
        operationId: "core.move",
        outcome: "failed",
        reasonCode: "no_known_route",
      }),
    ]);
  });

  it("rejects a completed traversal when the object still blocks movement", () => {
    const result = runTickPipeline(
      activateTraversal(inertWorld(), inertRegistry, true),
      inertRegistry,
    );
    const failure = result.events.find((event) => event.type === "action_failed");

    expect(failure).toMatchObject({
      type: "action_failed",
      reasonCode: "automatic_traversal_still_blocked",
      entityId: "door-living-kitchen",
    });
  });

  it("skips a stale traversal action when the object no longer blocks movement", () => {
    const baseWorld = activateTraversal(world(), registry, false);
    const passage = baseWorld.objects.get("door-living-kitchen" as never);
    if (!passage) throw new Error("Fixture has no living-room passage");
    const result = runTickPipeline(
      {
        ...baseWorld,
        objects: new Map(baseWorld.objects).set(passage.id, {
          ...passage,
          version: passage.version + 1,
          state: { raised: true, sealed: false },
        }),
      },
      registry,
    );
    const alice = result.world.agents.get("alice" as never);
    const callId =
      alice?.taskTracks.BODY.kind === "operation"
        ? alice.taskTracks.BODY.callId
        : null;
    const operation = callId ? alice?.activeOperations.get(callId) : null;
    const currentAction = operation?.plan.actions[operation.plan.currentActionIndex];

    expect(result.events.some((event) => event.type === "action_failed")).toBe(false);
    expect(currentAction?.kind).toBe("move");
  });

  it("restores a snapshot containing a stale traversal skipped without progress", () => {
    const baseWorld = world();
    const prepared = prepareOperationCall(
      baseWorld,
      registry,
      "alice" as never,
      moveToFridge,
      {},
      "operation-call:alice:move-fridge" as never,
    );
    if (prepared.kind !== "prepared") throw new Error(prepared.summary);
    const traversalIndex = prepared.operation.plan.actions.findIndex(
      (action) =>
        action.kind === "interact_object" &&
        action.purpose === "automatic_traversal" &&
        action.targetEntityId === "door-living-kitchen",
    );
    const currentAction = prepared.operation.plan.actions[traversalIndex + 1];
    if (traversalIndex < 1 || currentAction?.kind !== "move") {
      throw new Error("Fixture route has no movement around the traversal");
    }
    // The exact state a real stale-traversal skip leaves behind: every
    // preceding movement finished, the traversal itself was never started
    // and spent no ticks, and the plan cursor has already advanced past
    // it. The cumulative call progress therefore covers only the finished
    // prefix, not the skipped traversal's nominal duration.
    const actions = prepared.operation.plan.actions.map((action, index) => {
      if (index < traversalIndex) {
        return { ...action, progressTicks: action.durationTicks };
      }
      if (index === traversalIndex) {
        if (action.kind !== "interact_object") {
          throw new Error("Fixture route has no traversal at the cursor");
        }
        return { ...action, progressTicks: 0, started: false };
      }
      return action;
    });
    const elapsedTicks = prepared.operation.plan.actions
      .slice(0, traversalIndex)
      .reduce((total, action) => total + action.durationTicks, 0);
    const operation = {
      ...prepared.operation,
      progressTicks: elapsedTicks,
      plan: {
        ...prepared.operation.plan,
        actions,
        currentActionIndex: traversalIndex + 1,
      },
    };
    const agent = baseWorld.agents.get("alice" as never)!;
    const snapshot = projectWorldSnapshot({
      ...baseWorld,
      mode: "RUNNING" as const,
      tick: elapsedTicks,
      agents: new Map(baseWorld.agents).set(agent.id, {
        ...agent,
        position: currentAction.path[0]!,
        taskTracks: {
          HEAD: { kind: "empty" as const },
          BODY: { kind: "operation" as const, callId: operation.callId },
        },
        activeOperations: new Map([[operation.callId, operation]]),
      }),
    });

    const restored = restoreWorldSnapshot(
      snapshot,
      registry,
      baseWorld.map,
      testSimulationRulesLock,
    );
    const restoredOperation = restored.agents
      .get("alice" as never)!
      .activeOperations.get(operation.callId);

    expect(restoredOperation?.plan.currentActionIndex).toBe(traversalIndex + 1);
    expect(restoredOperation?.progressTicks).toBe(elapsedTicks);
  });

  it("keeps the traversal failure result out of the exhausted move terminal result", () => {
    const active = activateTraversal(resultingWorld(), resultingRegistry, false);
    const alice = active.agents.get("alice" as never)!;
    const passage = active.objects.get("door-living-kitchen" as never)!;
    const exhausted = {
      ...active,
      agents: new Map(active.agents).set(alice.id, {
        ...alice,
        knowledge: {
          ...alice.knowledge,
          knownTraversalBlockers: new Map([
            [
              "door-bedroom-bathroom" as never,
              blocker("door-bedroom-bathroom"),
            ],
          ]),
        },
      }),
      objects: new Map(active.objects).set(passage.id, {
        ...passage,
        state: { raised: false, sealed: true },
      }),
    };

    const result = runTickPipeline(exhausted, resultingRegistry);

    // The traversal interaction's `{ status: "failed" }` result must not be
    // validated against the move operation's `{ nearby: [...] }` schema; the
    // move produces its own terminal result after consuming the failure.
    expect(
      result.events.filter((event) => event.type === "operation_result"),
    ).toEqual([
      expect.objectContaining({
        type: "operation_result",
        agentId: "alice",
        operationId: "core.move",
        terminal: true,
        outcome: "failed",
        reasonCode: "no_known_route",
        result: { nearby: expect.any(Array) },
      }),
    ]);
    expect(result.decisionNeeds).toEqual([
      {
        agentId: "alice",
        reason: { code: "no_known_route", summary: "Passage is sealed" },
      },
    ]);
  });

  it("keeps the traversal cancel result out of a cancelled move terminal result", () => {
    const active = activateTraversal(resultingWorld(), resultingRegistry, true);
    const taskOptions = buildTaskOptions(active, resultingRegistry, "alice" as never);
    const emptyBody = taskOptions.find(
      (option) => option.kind === "empty" && option.taskSlots[0] === "BODY",
    )!;
    const thinking = requestDecisions(active, [
      {
        agentId: "alice" as never,
        reason: { code: "test_cancel", summary: "Stop movement" },
        taskOptions,
      },
    ]).world;
    const request = thinking.decisionCycle!.requests.get("alice" as never)!;
    const accepted = acceptDecisionResult(thinking, {
      ...request.identity,
      proposal: {
        schemaVersion: 2,
        head: { kind: "continue" },
        body: {
          kind: "replace",
          taskOptionId: emptyBody.id,
          arguments: {},
        },
        reason: "Stop moving",
      },
    });
    expect(accepted.accepted).toBe(true);

    const released = releaseDecisionCycle(accepted.world, resultingRegistry);

    expect(
      released.events.filter((event) => event.type === "operation_result"),
    ).toEqual([
      expect.objectContaining({
        type: "operation_result",
        agentId: "alice",
        operationId: "core.move",
        terminal: true,
        outcome: "cancelled",
        reasonCode: "task_replaced",
        result: { nearby: expect.any(Array) },
      }),
    ]);
  });
});
