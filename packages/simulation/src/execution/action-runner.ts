import type { AgentId, EntityId } from "@god-sim/protocol";

import type { ActionFailure, ObjectAction, RunningAction } from "./action";
import { releaseBodySlots, reserveBodySlots } from "./body-slots";
import type { InteractionIntent } from "../interaction/effect-arbiter";
import type { PluginRegistry } from "../world/plugin-registry";
import { SpatialIndex } from "../world/spatial-index";
import type { AgentState, WorldState } from "../world/world-state";

const MOVE_TICKS_PER_CELL = 2;

export interface ActionInteractionIntent extends InteractionIntent {
  readonly actionId: string;
}

export interface InteractionCompletionRequest {
  readonly actionId: string;
  readonly agentId: AgentId;
  readonly entityId: EntityId;
  readonly interactionId: string;
}

export interface AgentActionFailure {
  readonly agentId: AgentId;
  readonly failure: ActionFailure;
}

export interface ActionAdvanceResult {
  readonly world: WorldState;
  readonly interactionIntents: readonly ActionInteractionIntent[];
  readonly completionRequests: readonly InteractionCompletionRequest[];
  readonly failures: readonly AgentActionFailure[];
  readonly completedGoalAgentIds: readonly AgentId[];
}

function replaceCurrentAction(agent: AgentState, action: RunningAction): AgentState {
  const plan = agent.actionPlan;
  if (!plan) return agent;
  const actions = [...plan.actions];
  actions[plan.currentActionIndex] = action;
  return { ...agent, actionPlan: { ...plan, actions } };
}

function finishCurrentAction(agent: AgentState): {
  readonly agent: AgentState;
  readonly goalCompleted: boolean;
} {
  const plan = agent.actionPlan;
  if (!plan) return { agent, goalCompleted: false };
  const action = plan.actions[plan.currentActionIndex];
  if (!action) return { agent, goalCompleted: false };
  const bodySlots = releaseBodySlots(agent.bodySlots, action.id);
  const nextIndex = plan.currentActionIndex + 1;
  if (nextIndex >= plan.actions.length) {
    return {
      agent: { ...agent, currentGoal: null, actionPlan: null, bodySlots },
      goalCompleted: true,
    };
  }
  return {
    agent: { ...agent, actionPlan: { ...plan, currentActionIndex: nextIndex }, bodySlots },
    goalCompleted: false,
  };
}

function movementFailure(
  world: WorldState,
  registry: PluginRegistry,
  actionId: string,
  blockerId: EntityId,
): ActionFailure {
  const object = world.objects.get(blockerId);
  const definition = object ? registry.getObject(object.definitionId)?.definition : undefined;
  if (object && definition?.tags.includes("door")) {
    const state = definition.stateSchema.parse(object.state);
    if (
      typeof state === "object" &&
      state !== null &&
      "locked" in state &&
      state.locked === true
    ) {
      return {
        code: "locked_door",
        actionId,
        entityId: blockerId,
        summary: `Door ${blockerId} is locked`,
      };
    }
  }
  return {
    code: "movement_blocked",
    actionId,
    entityId: blockerId,
    summary: `Movement blocked by ${blockerId}`,
  };
}

export function advanceActions(
  world: WorldState,
  registry: PluginRegistry,
): ActionAdvanceResult {
  if (world.mode !== "RUNNING") {
    return {
      world,
      interactionIntents: [],
      completionRequests: [],
      failures: [],
      completedGoalAgentIds: [],
    };
  }

  const agents = new Map(world.agents);
  const interactionIntents: ActionInteractionIntent[] = [];
  const completionRequests: InteractionCompletionRequest[] = [];
  const failures: AgentActionFailure[] = [];
  const completedGoalAgentIds: AgentId[] = [];

  for (const agentId of [...agents.keys()].sort((left, right) => left.localeCompare(right))) {
    let agent = agents.get(agentId)!;
    const plan = agent.actionPlan;
    const action = plan?.actions[plan.currentActionIndex];
    if (!plan || !action) continue;

    if (action.progressTicks === 0) {
      const reservation = reserveBodySlots(agent.bodySlots, action.id, action.slots);
      if (!reservation.accepted) {
        failures.push({
          agentId,
          failure: {
            code: "body_slot_conflict",
            actionId: action.id,
            summary: `Occupied body slots: ${reservation.occupiedSlots.join(", ")}`,
          },
        });
        continue;
      }
      agent = { ...agent, bodySlots: reservation.slots };
    }

    if (
      action.kind === "open_object" ||
      action.kind === "close_object" ||
      action.kind === "lock_object" ||
      action.kind === "unlock_object" ||
      action.kind === "use_object"
    ) {
      if (!action.started) {
        interactionIntents.push({
          intentId: `${action.id}:start`,
          actionId: action.id,
          agentId,
          entityId: action.targetEntityId,
          interactionId: action.interactionId,
          arrivalTick: world.tick,
        });
        agents.set(agentId, agent);
        continue;
      }
      const progressed = { ...action, progressTicks: action.progressTicks + 1 };
      agent = replaceCurrentAction(agent, progressed);
      if (progressed.progressTicks >= progressed.durationTicks) {
        completionRequests.push({
          actionId: action.id,
          agentId,
          entityId: action.targetEntityId,
          interactionId: action.interactionId,
        });
      }
      agents.set(agentId, agent);
      continue;
    }

    if (action.kind === "move") {
      const nextProgress = action.progressTicks + 1;
      let nextPosition = agent.position;
      if (nextProgress % MOVE_TICKS_PER_CELL === 0) {
        const pathIndex = nextProgress / MOVE_TICKS_PER_CELL;
        const candidate = action.path[pathIndex];
        if (!candidate) throw new Error(`Move action ${action.id} has invalid path progress`);
        const blockers = new SpatialIndex(world, registry).blockingObjectsAt(candidate, agentId);
        if (blockers.length > 0) {
          failures.push({
            agentId,
            failure: movementFailure(world, registry, action.id, blockers[0]!.id),
          });
          agents.set(agentId, agent);
          continue;
        }
        nextPosition = candidate;
      }
      const progressed = { ...action, progressTicks: nextProgress };
      agent = replaceCurrentAction({ ...agent, position: nextPosition }, progressed);
    } else {
      agent = replaceCurrentAction(agent, {
        ...action,
        progressTicks: action.progressTicks + 1,
      });
    }

    const updatedAction = agent.actionPlan?.actions[agent.actionPlan.currentActionIndex];
    if (updatedAction && updatedAction.progressTicks >= updatedAction.durationTicks) {
      const finished = finishCurrentAction(agent);
      agent = finished.agent;
      if (finished.goalCompleted) completedGoalAgentIds.push(agentId);
    }
    agents.set(agentId, agent);
  }

  return {
    world: { ...world, agents },
    interactionIntents,
    completionRequests,
    failures,
    completedGoalAgentIds,
  };
}

function updateObjectAction(
  world: WorldState,
  agentId: AgentId,
  actionId: string,
  update: (action: ObjectAction) => ObjectAction,
): WorldState {
  const agent = world.agents.get(agentId);
  const plan = agent?.actionPlan;
  const action = plan?.actions[plan.currentActionIndex];
  if (!agent || !plan || !action || action.id !== actionId || !("started" in action)) {
    throw new Error(`Action ${actionId} is not current for ${agentId}`);
  }
  const nextAgent = replaceCurrentAction(agent, update(action));
  return { ...world, agents: new Map(world.agents).set(agentId, nextAgent) };
}

export function markInteractionStarted(
  world: WorldState,
  agentId: AgentId,
  actionId: string,
): WorldState {
  return updateObjectAction(world, agentId, actionId, (action) => ({ ...action, started: true }));
}

export function markInteractionCompleted(
  world: WorldState,
  agentId: AgentId,
  actionId: string,
): { readonly world: WorldState; readonly goalCompleted: boolean } {
  const started = updateObjectAction(world, agentId, actionId, (action) => action);
  const agent = started.agents.get(agentId)!;
  const finished = finishCurrentAction(agent);
  return {
    world: { ...started, agents: new Map(started.agents).set(agentId, finished.agent) },
    goalCompleted: finished.goalCompleted,
  };
}
