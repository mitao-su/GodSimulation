import { z } from "zod";

import {
  OperationDurationSchema,
  OperationDomainFailureSchema,
  type JsonObject,
} from "@god-sim/protocol";
import { type EffectProposal, type OperationTickResult } from "@god-sim/plugin-sdk";

import { MoveOperationResultSchema } from "./move-operation";
import { HostedMoveOperationStateSchema, type HostedMoveState as MoveState, type TraversalState } from "./hosted-move-state";
import { ENTITY_TARGET_ARGUMENTS_SCHEMA, isAtInteractionPosition } from "./core-operation-helpers";
import { findPath } from "../path-planner";
import { type OperationObservation } from "../operation";
import { type OperationRuntimeCall, type OperationRuntimeContext } from "../operation-runtime";
import { createInteractionContext, proposeInteraction } from "../../interaction/interaction-router";
import { SpatialIndex } from "../../world/spatial-index";

export const HostedMoveOperationResultSchema = z.union([
  MoveOperationResultSchema,
  MoveOperationResultSchema.extend({ failure: OperationDomainFailureSchema }).strict(),
]);

export function initialHostedMoveState(): JsonObject {
  return {
    accumulatedObservations: [],
    observationDeliveryCursor: 0,
    movement: { kind: "walking", progressTicks: 0 },
  };
}

export function accumulateHostedMoveObservations(
  operation: OperationRuntimeCall,
  observations: readonly OperationObservation[],
): JsonObject {
  const state = HostedMoveOperationStateSchema.parse(operation.state);
  const merged = [...state.accumulatedObservations];
  for (const entry of observations) {
    const previous = merged.findLast((candidate) => candidate.entityId === entry.entityId);
    if (!previous || previous.summary !== entry.summary) merged.push(entry);
  }
  return { ...state, accumulatedObservations: merged };
}

export function hostedMoveCleanupEffects(context: OperationRuntimeContext, operation: OperationRuntimeCall): EffectProposal {
  const state = HostedMoveOperationStateSchema.parse(operation.state);
  const traversal = state.movement;
  if (traversal.kind !== "traversal" || traversal.completed ||
      !context.world.objects.has(traversal.entityId)) return { effects: [] };
  const cancelled = proposeInteraction(context.world, context.registry, {
    agentId: context.agentId, entityId: traversal.entityId,
    interactionId: traversal.interactionId, parameters: {}, phase: "cancel",
  });
  if (!cancelled.accepted) throw new Error(`Traversal cancellation was rejected: ${cancelled.reasonCode}`);
  return cancelled.proposal;
}

function running(state: MoveState, proposal: EffectProposal = { effects: [] }): OperationTickResult {
  return { kind: "running", nextState: state, proposal };
}

function failedTraversal(
  context: OperationRuntimeContext,
  operation: OperationRuntimeCall,
  state: MoveState,
  traversal: TraversalState,
  failure: { readonly reasonCode: string; readonly summary: string; readonly details?: JsonObject },
): OperationTickResult {
  const object = context.world.objects.get(traversal.entityId)!;
  const interaction = context.registry.getObject(object.definitionId)!.definition.interactions
    .find((candidate) => candidate.id === traversal.interactionId)!;
  const declaration = interaction.domainFailures.find((entry) => entry.code === failure.reasonCode);
  if (failure.reasonCode !== "out_of_range" &&
      (!declaration || !declaration.detailsSchema.safeParse(failure.details).success)) {
    throw new Error(`Traversal returned an undeclared or malformed failure: ${failure.reasonCode}`);
  }
  const failed = declaration ? proposeInteraction(context.world, context.registry, {
    agentId: context.agentId, entityId: object.id, interactionId: traversal.interactionId,
    parameters: {}, phase: "fail", failureCode: failure.reasonCode,
  }) : null;
  if (failed && !failed.accepted) throw new Error(`Traversal failure cleanup was rejected: ${failed.reasonCode}`);
  // 不关闭顶层调用。先提交阻挡事实，下一步沿同一 callId 依据新知识重新寻路。
  return running({
    ...state,
    accumulatedObservations: [...state.accumulatedObservations, {
      entityId: object.id, kind: "object", summary: failure.summary,
    }],
    movement: { kind: "walking", progressTicks: 0 },
  }, {
    effects: [{
      type: "record_traversal_blocker",
      agentId: context.agentId,
      callId: operation.callId,
      expectedProgressTicks: operation.progressTicks,
      entityId: object.id,
      expectedObjectVersion: object.version,
      reasonCode: failure.reasonCode,
      summary: failure.summary,
    }, ...(failed?.accepted ? failed.proposal.effects : [])],
  });
}

function advanceTraversal(
  context: OperationRuntimeContext,
  operation: OperationRuntimeCall,
  state: MoveState,
  traversal: TraversalState,
): OperationTickResult {
  if (traversal.completed) {
    throw new Error(`Traversal ${traversal.entityId} completed but still blocks movement`);
  }
  const progressTicks = traversal.progressTicks + 1;
  const proposal = proposeInteraction(context.world, context.registry, {
    agentId: context.agentId,
    entityId: traversal.entityId,
    interactionId: traversal.interactionId,
    parameters: {},
    phase: traversal.progressTicks === 0 ? "start" : "complete",
  });
  if (!proposal.accepted) return failedTraversal(context, operation, state, traversal, proposal);
  if (traversal.progressTicks > 0 && progressTicks < traversal.durationTicks) {
    throw new Error("Traversal completion was invoked before its locked duration");
  }
  // 一 Tick 的微步骤在本步完成；自动通行的 start 没有额外推进世界时钟。
  if (traversal.progressTicks === 0 && progressTicks >= traversal.durationTicks) {
    if (proposal.proposal.effects.length > 0) {
      throw new Error("Single-tick traversal cannot stage separate start effects");
    }
    const complete = proposeInteraction(context.world, context.registry, {
      agentId: context.agentId,
      entityId: traversal.entityId,
      interactionId: traversal.interactionId,
      parameters: {},
      phase: "complete",
    });
    if (!complete.accepted) return failedTraversal(context, operation, state, traversal, complete);
    return running({ ...state, movement: { ...traversal, progressTicks, completed: true } }, complete.proposal);
  }
  return running({ ...state, movement: {
    ...traversal,
    progressTicks,
    completed: progressTicks === traversal.durationTicks,
  } }, proposal.proposal);
}

export function tickHostedMove(
  context: OperationRuntimeContext,
  operation: OperationRuntimeCall,
): OperationTickResult {
  const state = HostedMoveOperationStateSchema.parse(operation.state);
  const { targetEntityId } = ENTITY_TARGET_ARGUMENTS_SCHEMA.parse(operation.arguments);
  const target = context.world.objects.get(targetEntityId);
  if (!target) return { kind: "domain_failure", code: "unknown_target", details: {} };
  if (isAtInteractionPosition(context, targetEntityId)) {
    return { kind: "complete", nextState: state };
  }
  const spatial = new SpatialIndex(context.world, context.registry);
  if (state.movement.kind === "traversal" &&
      context.world.objects.has(state.movement.entityId) &&
      spatial.objectBlocksMovement(state.movement.entityId, context.agentId)) {
    if (state.movement.progressTicks > 0 && state.movement.progressTicks + 1 < state.movement.durationTicks) {
      return running({ ...state, movement: { ...state.movement, progressTicks: state.movement.progressTicks + 1 } });
    }
    return advanceTraversal(context, operation, state, state.movement);
  }
  const agent = context.world.agents.get(context.agentId)!;
  const route = findPath(context.world, context.registry, context.agentId,
    spatial.interactionPositions(targetEntityId), agent.knowledge);
  if (route.kind === "not_found") {
    return { kind: "domain_failure", code: "no_known_route", details: {} };
  }
  const destination = route.path[1];
  if (!destination) throw new Error("Move route has no next cell before arrival");
  const blocker = spatial.blockingObjectsAt(destination, context.agentId)
    .slice().sort((left, right) => left.id.localeCompare(right.id))[0];
  if (blocker) {
    const definition = context.registry.getObject(blocker.definitionId)!.definition;
    const interaction = definition.interactions.find((entry) => entry.id === definition.traversal?.interactionId);
    if (!interaction) return { kind: "domain_failure", code: "movement_blocked", details: {} };
    // 微步骤建立时锁定一次时长，后续 start/complete 都不再调用 resolver。
    const duration = OperationDurationSchema.parse(interaction.resolveDuration(
      definition.stateSchema.parse(blocker.state),
      createInteractionContext(context.world, context.registry, blocker.id, context.agentId),
      interaction.parametersSchema.parse({}),
    ));
    if (duration.kind !== "fixed") throw new Error("Automatic traversal requires a fixed duration");
    return advanceTraversal(context, operation, state, {
      kind: "traversal", entityId: blocker.id, interactionId: interaction.id,
      durationTicks: duration.totalTicks, progressTicks: 0, completed: false,
    });
  }
  const progressTicks = (state.movement.kind === "walking" ? state.movement.progressTicks : 0) + 1;
  const ticksPerCell = context.world.simulationRulesLock.rules.operations.move.ticksPerCell;
  if (progressTicks < ticksPerCell) {
    return running({ ...state, movement: { kind: "walking", progressTicks } });
  }
  return running({ ...state, movement: { kind: "walking", progressTicks: 0 } }, {
    effects: [{
      type: "move_agent", agentId: context.agentId, callId: operation.callId,
      expectedProgressTicks: operation.progressTicks, from: agent.position, to: destination,
    }],
  });
}
