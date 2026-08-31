import { describe, expect, it } from "vitest";

import homePlugin from "@god-sim/home-objects";
import {
  definePlugin,
  PluginManifestSchema,
  type ObjectDefinition,
} from "@god-sim/plugin-sdk";
import {
  createPluginRegistry,
  loadWorldDefinition,
  planGoal,
  recoverBlockedPlan,
  runTickPipeline,
} from "@god-sim/simulation";
import { wallDefinition } from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };

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
      durationTicks: 3,
      slots: ["HANDS"],
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

const registry = createPluginRegistry([passagePlugin, homePlugin, agentsPlugin]);
const inertRegistry = createPluginRegistry([
  inertPassagePlugin,
  homePlugin,
  agentsPlugin,
]);
const useFridge = {
  kind: "use_object" as const,
  targetEntityId: "fridge-1" as never,
  interactionId: "use",
};

function world() {
  return loadWorldDefinition(anonymousPassageWorld, registry).world;
}

function inertWorld() {
  return loadWorldDefinition(inertPassageWorld, inertRegistry).world;
}

function activateTraversal(
  baseWorld: ReturnType<typeof world>,
  activeRegistry: typeof registry,
  started: boolean,
) {
  const planned = planGoal(
    baseWorld,
    activeRegistry,
    "alice" as never,
    useFridge,
    { knownTraversalBlockers: new Map() },
  );
  if (planned.kind !== "planned") throw new Error(planned.summary);
  const actionIndex = planned.plan.actions.findIndex(
    (action) =>
      action.kind === "interact_object" &&
      action.purpose === "automatic_traversal" &&
      action.targetEntityId === "door-living-kitchen",
  );
  const action = planned.plan.actions[actionIndex];
  const approach = planned.plan.actions[actionIndex - 1];
  if (action?.kind !== "interact_object" || approach?.kind !== "move") {
    throw new Error("Fixture route has no automatic traversal approach");
  }
  const agent = baseWorld.agents.get("alice" as never);
  if (!agent) throw new Error("Fixture has no Alice");
  const actions = [...planned.plan.actions];
  actions[actionIndex] = {
    ...action,
    started,
    progressTicks: started ? action.durationTicks - 1 : 0,
  };
  return {
    ...baseWorld,
    mode: "RUNNING" as const,
    agents: new Map(baseWorld.agents).set(agent.id, {
      ...agent,
      position: approach.path.at(-1)!,
      currentGoal: {
        id: planned.plan.goalId,
        goal: useFridge,
        label: "Use refrigerator",
      },
      actionPlan: {
        ...planned.plan,
        actions,
        currentActionIndex: actionIndex,
      },
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
    const result = planGoal(
      world(),
      registry,
      "alice" as never,
      useFridge,
      { knownTraversalBlockers: new Map() },
    );

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(
      result.plan.actions.map((action) =>
        action.kind === "interact_object"
          ? `${action.kind}:${action.purpose}:${action.interactionId}`
          : action.kind,
      ),
    ).toEqual([
      "move",
      "interact_object:automatic_traversal:raise",
      "move",
      "interact_object:goal:use",
    ]);
  });

  it("reroutes the same goal without thought when another known route exists", () => {
    const result = recoverBlockedPlan(
      world(),
      registry,
      "alice" as never,
      {
        entityId: "door-living-kitchen" as never,
        goal: useFridge,
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
    expect(
      result.plan.actions.filter(
        (action) =>
          action.kind === "interact_object" &&
          action.purpose === "automatic_traversal",
      ).length,
    ).toBeGreaterThan(1);
  });

  it("asks for a decision only after all known routes fail", () => {
    const result = recoverBlockedPlan(
      world(),
      registry,
      "alice" as never,
      {
        entityId: "door-living-kitchen" as never,
        goal: useFridge,
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
    const currentAction = alice?.actionPlan?.actions[alice.actionPlan.currentActionIndex];

    expect(result.events.some((event) => event.type === "action_failed")).toBe(false);
    expect(currentAction?.kind).toBe("move");
  });
});
