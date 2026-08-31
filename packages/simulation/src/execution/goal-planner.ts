import type { AgentId, Coordinate, EntityId, Goal } from "@god-sim/protocol";

import type { ActionPlan, RunningAction } from "./action";
import { findPath, type AgentNavigationKnowledge } from "./path-planner";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { ObjectInstance, WorldState } from "../world/world-state";

const MOVE_TICKS_PER_CELL = 2;

export type ActionPlanResult =
  | { readonly kind: "planned"; readonly plan: ActionPlan }
  | { readonly kind: "blocked"; readonly reasonCode: string; readonly summary: string };

function automaticTraversalObjectsAt(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  position: Coordinate,
): readonly ObjectInstance[] {
  const spatial = new SpatialIndex(world, registry);
  return spatial
    .blockingObjectsAt(position, agentId)
    .filter((object) => {
      const registered = registry.getObject(object.definitionId);
      return registered?.definition.traversal !== undefined;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function interactionDuration(
  registry: PluginRegistry,
  object: ObjectInstance,
  interactionId: string,
): { readonly durationTicks: number; readonly slots: RunningAction["slots"] } | null {
  const definition = registry.getObject(object.definitionId)?.definition;
  const interaction = definition?.interactions.find((candidate) => candidate.id === interactionId);
  return interaction
    ? { durationTicks: interaction.durationTicks, slots: interaction.slots }
    : null;
}

function createPathActions(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  goalId: string,
  path: readonly Coordinate[],
): RunningAction[] {
  const actions: RunningAction[] = [];
  let segment: Coordinate[] = [path[0]!];

  const pushMove = (): void => {
    if (segment.length < 2) return;
    actions.push({
      id: `${goalId}:action:${actions.length}`,
      goalId,
      kind: "move",
      path: segment,
      durationTicks: (segment.length - 1) * MOVE_TICKS_PER_CELL,
      progressTicks: 0,
      slots: ["BODY"],
    });
  };

  for (let index = 1; index < path.length; index += 1) {
    const position = path[index]!;
    const traversalObjects = automaticTraversalObjectsAt(
      world,
      registry,
      agentId,
      position,
    );
    if (traversalObjects.length === 0) {
      segment.push(position);
      continue;
    }

    pushMove();
    for (const object of traversalObjects) {
      const definition = registry.getObject(object.definitionId)?.definition;
      const interactionId = definition?.traversal?.interactionId;
      if (!interactionId) throw new Error(`Object ${object.id} has no traversal capability`);
      const interaction = interactionDuration(registry, object, interactionId);
      if (!interaction) {
        throw new Error(`Object ${object.id} has no traversal interaction ${interactionId}`);
      }
      actions.push({
        id: `${goalId}:action:${actions.length}`,
        goalId,
        kind: "interact_object",
        purpose: "automatic_traversal",
        targetEntityId: object.id,
        interactionId,
        durationTicks: interaction.durationTicks,
        progressTicks: 0,
        slots: interaction.slots,
        started: false,
      });
    }
    segment = [path[index - 1]!, position];
  }
  pushMove();
  return actions;
}

function targetObject(world: WorldState, entityId: EntityId): ObjectInstance | null {
  return world.objects.get(entityId) ?? null;
}

export function planGoal(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
  goal: Goal,
  knowledge: AgentNavigationKnowledge,
  goalId = `goal:${agentId}:${world.version}`,
): ActionPlanResult {
  if (!world.agents.has(agentId)) throw new Error(`Unknown agent instance: ${agentId}`);

  if (goal.kind === "wait") {
    return {
      kind: "planned",
      plan: {
        goalId,
        goal,
        currentActionIndex: 0,
        actions: [
          {
            id: `${goalId}:action:0`,
            goalId,
            kind: "wait",
            durationTicks: goal.durationTicks,
            progressTicks: 0,
            slots: ["BODY"],
          },
        ],
      },
    };
  }

  const object = targetObject(world, goal.targetEntityId);
  if (!object) {
    return {
      kind: "blocked",
      reasonCode: "unknown_target",
      summary: `Unknown target ${goal.targetEntityId}`,
    };
  }
  const spatial = new SpatialIndex(world, registry);
  const pathResult = findPath(
    world,
    registry,
    agentId,
    spatial.interactionPositions(object.id),
    knowledge,
  );
  if (pathResult.kind === "not_found") {
    return { kind: "blocked", reasonCode: "no_known_route", summary: "No known route to target" };
  }

  const actions = createPathActions(world, registry, agentId, goalId, pathResult.path);
  if (goal.kind === "observe") {
    actions.push({
      id: `${goalId}:action:${actions.length}`,
      goalId,
      kind: "observe",
      targetEntityId: object.id,
      durationTicks: 1,
      progressTicks: 0,
      slots: ["HEAD"],
    });
  } else {
    const interaction = interactionDuration(registry, object, goal.interactionId);
    if (!interaction) {
      return {
        kind: "blocked",
        reasonCode: "unknown_interaction",
        summary: `${object.id} has no ${goal.interactionId} interaction`,
      };
    }
    actions.push({
      id: `${goalId}:action:${actions.length}`,
      goalId,
      kind: "interact_object",
      purpose: "goal",
      targetEntityId: object.id,
      interactionId: goal.interactionId,
      durationTicks: interaction.durationTicks,
      progressTicks: 0,
      slots: interaction.slots,
      started: false,
    });
  }

  return { kind: "planned", plan: { goalId, goal, actions, currentActionIndex: 0 } };
}
