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

function closedDoorAt(
  world: WorldState,
  registry: PluginRegistry,
  position: Coordinate,
): ObjectInstance | null {
  const spatial = new SpatialIndex(world, registry);
  for (const object of spatial.objectsAt(position)) {
    const registered = registry.getObject(object.definitionId);
    if (!registered?.definition.tags.includes("door")) continue;
    const state = registered.definition.stateSchema.parse(object.state);
    if (
      typeof state === "object" &&
      state !== null &&
      "open" in state &&
      state.open === false
    ) {
      return object;
    }
  }
  return null;
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
    const door = closedDoorAt(world, registry, position);
    if (!door) {
      segment.push(position);
      continue;
    }

    pushMove();
    const interaction = interactionDuration(registry, door, "open");
    if (!interaction) throw new Error(`Door ${door.id} has no open interaction`);
    actions.push({
      id: `${goalId}:action:${actions.length}`,
      goalId,
      kind: "open_object",
      targetEntityId: door.id,
      interactionId: "open",
      durationTicks: interaction.durationTicks,
      progressTicks: 0,
      slots: interaction.slots,
      started: false,
    });
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

  const actions = createPathActions(world, registry, goalId, pathResult.path);
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
      kind: "use_object",
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
