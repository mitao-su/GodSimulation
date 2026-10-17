import type { z } from "zod";

import {
  JsonValueSchema,
  WorldSnapshotSchema,
  DirectTaskDecisionSchema,
  TaskDecisionSchema,
  type AgentId,
  type EntityId,
  type OperationCallId,
  type SimulationRulesLock,
  type TechnicalFailure,
  type WorldSnapshot,
} from "@god-sim/protocol";
import type {
  SerializedAgentSchema,
  SerializedDecisionCycleSchema,
  SerializedKnowledgeSchema,
  SerializedObjectSchema,
} from "./snapshot-state-codec";
import type { SerializedPendingOperationTermination } from "./snapshot-state-codec";
import {
  parseSerializedState,
  uniqueMap,
} from "./snapshot-migrations/legacy-snapshot";
import {
  validateAndResolveSnapshotMode,
  validateRestoredOperations,
  validateSnapshotRulesLock,
  validateSnapshotWorldIdentity,
} from "./snapshot-restore-validation";

import { MapDefinitionSchema } from "../map/map-definition";
import { loadWorldDefinition } from "../map/map-loader";
import type { AgentKnowledge } from "../perception/agent-knowledge";
import type { SimulationRegistry } from "./simulation-registry";
import type { PluginRegistry } from "../world/plugin-registry";
import {
  bladderSensation,
  type AgentState,
  type DecisionCycleState,
  type ObjectInstance,
  type WorldState,
} from "../world/world-state";
import type {
  OperationRuntimeCall,
  OperationTerminationTransaction,
} from "../execution/operation-runtime";
import { isOperationRuntimeCall } from "../execution/operation-runtime";
import type { PendingOperationTermination } from "../world/world-state";


function assertCoordinateInMap(
  position: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  label: string,
): void {
  if (position.x >= width || position.y >= height) {
    throw new Error(`Snapshot ${label} is outside the map`);
  }
}

function restoreKnowledge(
  value: z.infer<typeof SerializedKnowledgeSchema>,
): AgentKnowledge {
  return {
    zoneId: value.zoneId,
    objects: uniqueMap(value.objects, (object) => object.entityId, "known object ID"),
    agents: uniqueMap(value.agents, (agent) => agent.agentId, "known agent ID"),
    visibleEntityIds: new Set(value.visibleEntityIds),
    knownTraversalBlockers: uniqueMap(
      value.knownTraversalBlockers,
      (blocker) => blocker.entityId,
      "known traversal blocker ID",
    ),
  };
}

function restoreObjects(
  values: readonly z.infer<typeof SerializedObjectSchema>[],
  baseline: WorldState,
  registry: PluginRegistry,
): ReadonlyMap<EntityId, ObjectInstance> {
  const parsed = uniqueMap(values, (object) => object.id, "object ID");
  if (parsed.size !== baseline.objects.size) {
    throw new Error("Snapshot object set does not match its map");
  }
  const restored = new Map<EntityId, ObjectInstance>();
  for (const [entityId, object] of parsed) {
    const expected = baseline.objects.get(entityId);
    if (!expected || expected.definitionId !== object.definitionId) {
      throw new Error(`Snapshot object ${entityId} does not match its map placement`);
    }
    const definition = registry.getObject(object.definitionId)?.definition;
    if (!definition) throw new Error(`Snapshot object ${entityId} has no plugin definition`);
    assertCoordinateInMap(
      object.position,
      baseline.map.width,
      baseline.map.height,
      `object ${entityId}`,
    );
    restored.set(entityId, {
      ...object,
      state: JsonValueSchema.parse(definition.stateSchema.parse(object.state)),
    });
  }
  return restored;
}

function restoreAgents(
  values: readonly z.infer<typeof SerializedAgentSchema>[],
  baseline: WorldState,
  registry: PluginRegistry,
): ReadonlyMap<AgentId, AgentState> {
  const parsed = uniqueMap(values, (agent) => agent.id, "agent ID");
  if (parsed.size !== baseline.agents.size) {
    throw new Error("Snapshot agent set does not match its map");
  }
  const restored = new Map<AgentId, AgentState>();
  for (const [agentId, agent] of parsed) {
    const expected = baseline.agents.get(agentId);
    if (!expected || expected.definitionId !== agent.definitionId) {
      throw new Error(`Snapshot agent ${agentId} does not match its map spawn`);
    }
    const definition = registry.getAgent(agent.definitionId)?.definition;
    if (
      !definition ||
      definition.displayName !== agent.displayName ||
      definition.resourceId !== agent.resourceId ||
      definition.animationSetId !== agent.animationSetId
    ) {
      throw new Error(`Snapshot agent ${agentId} does not match its plugin definition`);
    }
    if (bladderSensation(agent.bladder) !== agent.bladderSensation) {
      throw new Error(`Snapshot agent ${agentId} has an inconsistent bladder sensation`);
    }
    assertCoordinateInMap(
      agent.position,
      baseline.map.width,
      baseline.map.height,
      `agent ${agentId}`,
    );
    const activeOperations = uniqueMap(
      agent.activeOperations,
      (operation) => operation.callId,
      "active operation call ID",
    );
    const referencedCallIds = new Set<OperationCallId>();
    for (const track of ["HEAD", "BODY"] as const) {
      const task = agent.taskTracks[track];
      if (task.kind === "empty") continue;
      const operation = activeOperations.get(task.callId);
      if (!operation) {
        throw new Error(
          `Snapshot agent ${agentId} track ${track} references missing operation ${task.callId}`,
        );
      }
      if (!operation.taskSlots.includes(track)) {
        throw new Error(
          `Snapshot operation ${task.callId} does not occupy track ${track}`,
        );
      }
      referencedCallIds.add(task.callId);
    }
    for (const operation of activeOperations.values()) {
      if (
        operation.taskSlots.some((track) => {
          const task = agent.taskTracks[track];
          return task.kind !== "operation" || task.callId !== operation.callId;
        })
      ) {
        throw new Error(
          `Snapshot operation ${operation.callId} is not referenced by every declared track`,
        );
      }
      if (!referencedCallIds.has(operation.callId)) {
        throw new Error(
          `Snapshot operation ${operation.callId} is not referenced by a task track`,
        );
      }
    }
    restored.set(agentId, {
      ...agent,
      activeOperations: activeOperations as unknown as AgentState["activeOperations"],
      knowledge: restoreKnowledge(agent.knowledge),
    });
  }
  return restored;
}

function restoreDecisionCycle(
  value: z.infer<typeof SerializedDecisionCycleSchema> | null,
  snapshot: WorldSnapshot,
  agents: ReadonlyMap<AgentId, AgentState>,
  technicalFailure: TechnicalFailure | null,
): DecisionCycleState | null {
  if (value === null) return null;
  const requests = uniqueMap(value.requests, (request) => request.agentId, "decision agent ID");
  const requestFailures = new Map<AgentId, TechnicalFailure | null>();
  if (
    requests.size !== value.requestedAgentIds.length ||
    value.requestedAgentIds.some((agentId) => !requests.has(agentId))
  ) {
    throw new Error("Snapshot decision requests do not match the requested agents");
  }
  for (const [agentId, request] of requests) {
    if (!agents.has(agentId)) throw new Error(`Snapshot decision targets unknown agent ${agentId}`);
    const identity = request.identity;
    const prompt = request.promptInput;
    if (
      identity.agentId !== agentId ||
      identity.worldId !== snapshot.worldId ||
      identity.decisionCycleId !== value.id ||
      identity.pluginLockHash !== snapshot.pluginLockHash ||
      prompt.requestId !== identity.requestId ||
      prompt.agentId !== identity.agentId ||
      prompt.worldId !== identity.worldId ||
      prompt.worldVersion !== identity.worldVersion ||
      prompt.decisionCycleId !== identity.decisionCycleId ||
      prompt.pluginLockHash !== identity.pluginLockHash
    ) {
      throw new Error(`Snapshot decision identity is inconsistent for ${agentId}`);
    }
    if (
      request.acceptedProposal !== null &&
      TaskDecisionSchema.safeParse(request.acceptedProposal).success
    ) {
      const legacyProposal = TaskDecisionSchema.parse(request.acceptedProposal);
      const legacyTaskOptions = prompt.taskOptions;
      if (!legacyTaskOptions) {
        throw new Error(
          `Snapshot decision for ${agentId} has a legacy proposal without task options`,
        );
      }
      for (const selection of [
        legacyProposal.head,
        legacyProposal.body,
      ]) {
        if (
          selection.kind === "replace" &&
          !legacyTaskOptions.some(
            (option) => option.id === selection.taskOptionId,
          )
        ) {
          throw new Error(
            `Snapshot decision for ${agentId} accepted an unoffered task`,
          );
        }
      }
    } else if (request.acceptedProposal !== null) {
      DirectTaskDecisionSchema.parse(request.acceptedProposal);
    }
    const requestFailure =
      request.failure ??
      (technicalFailure?.category === "model" &&
      technicalFailure.requestId === request.identity.requestId
        ? technicalFailure
        : null);
    if (
      requestFailure !== null &&
      (requestFailure.category !== "model" ||
        requestFailure.requestId !== request.identity.requestId ||
        request.acceptedProposal !== null)
    ) {
      throw new Error(`Snapshot decision failure is inconsistent for ${agentId}`);
    }
    requestFailures.set(agentId, requestFailure);
  }
  return {
    id: value.id,
    baseWorldVersion: value.baseWorldVersion,
    requestedAgentIds: value.requestedAgentIds,
    requests: new Map(
      [...requests].map(([agentId, request]) => [
        agentId,
        {
          identity: request.identity,
          promptInput: request.promptInput,
          acceptedProposal: request.acceptedProposal,
          failure: requestFailures.get(agentId) ?? null,
        },
      ]),
    ),
  };
}

function restorePendingOperationTerminations(
  values: readonly SerializedPendingOperationTermination[],
  agents: ReadonlyMap<AgentId, AgentState>,
): ReadonlyMap<OperationCallId, PendingOperationTermination> {
  const pending = new Map<OperationCallId, PendingOperationTermination>();
  for (const value of values) {
    if (pending.has(value.callId)) {
      throw new Error(`Snapshot contains duplicate pending termination ${value.callId}`);
    }
    if (value.callId !== value.operation.callId) {
      throw new Error(`Pending termination ${value.callId} does not match its operation`);
    }
    const agent = agents.get(value.agentId);
    if (!agent) {
      throw new Error(`Pending termination ${value.callId} targets unknown agent ${value.agentId}`);
    }
    const active = agent.activeOperations.get(value.callId);
    if (!active || !isOperationRuntimeCall(active)) {
      throw new Error(`Pending termination ${value.callId} is not an active hosted call`);
    }
    if (!sameHostedOperationSnapshot(active, value.operation)) {
      throw new Error(`Pending termination ${value.callId} does not match its active call`);
    }
    if (value.kind === "transaction_ready") {
      if (
        value.transaction.callId !== value.callId ||
        value.transaction.agentId !== value.agentId ||
        value.transaction.operationId !== value.operation.operationId
      ) {
        throw new Error(`Pending transaction ${value.callId} has inconsistent identity`);
      }
      pending.set(value.callId, {
        kind: "transaction_ready",
        agentId: value.agentId,
        operation: value.operation as OperationRuntimeCall,
        transaction: value.transaction as OperationTerminationTransaction,
      });
    } else {
      pending.set(value.callId, {
        kind: "complete_pending",
        agentId: value.agentId,
        operation: value.operation as OperationRuntimeCall,
        source: value.source,
        ...(value.preTerminationProposal === undefined
          ? {}
          : { preTerminationProposal: value.preTerminationProposal }),
      });
    }
  }
  return pending;
}

function sameHostedOperationSnapshot(
  left: OperationRuntimeCall,
  right: OperationRuntimeCall,
): boolean {
  return (
    left.callId === right.callId &&
    left.operationId === right.operationId &&
    JSON.stringify(left.host) === JSON.stringify(right.host) &&
    JSON.stringify(left.hostDefinition) === JSON.stringify(right.hostDefinition) &&
    JSON.stringify(left.target) === JSON.stringify(right.target) &&
    JSON.stringify(left.taskSlots) === JSON.stringify(right.taskSlots) &&
    JSON.stringify(left.arguments) === JSON.stringify(right.arguments) &&
    JSON.stringify(left.duration) === JSON.stringify(right.duration) &&
    left.startedAtTick === right.startedAtTick &&
    left.progressTicks === right.progressTicks &&
    left.firstStepState === right.firstStepState &&
    JSON.stringify(left.state) === JSON.stringify(right.state)
  );
}

export function restoreWorldSnapshot(
  snapshotValue: WorldSnapshot,
  registry: SimulationRegistry,
  worldDefinition: unknown,
  simulationRulesLock: SimulationRulesLock,
): WorldState {
  const snapshot = WorldSnapshotSchema.parse(snapshotValue);
  const configuredRulesLock = validateSnapshotRulesLock(
    snapshot,
    simulationRulesLock,
  );
  const expectedMap = MapDefinitionSchema.parse(worldDefinition);
  const { state, history } = parseSerializedState(snapshot, expectedMap.rules);
  validateSnapshotWorldIdentity(snapshot, state, expectedMap);
  const baseline = loadWorldDefinition(expectedMap, registry, {
    simulationRulesLock: configuredRulesLock,
    reviewRequired: state.reviewRequired,
    seed: state.randomState,
    pluginLockHash: snapshot.pluginLockHash,
  }).world;
  const objects = restoreObjects(state.objects, baseline, registry);
  const agents = restoreAgents(state.agents, baseline, registry);
  const decisionCycle = restoreDecisionCycle(
    state.decisionCycle,
    snapshot,
    agents,
    state.technicalFailure,
  );
  const pendingOperationTerminations = restorePendingOperationTerminations(
    state.pendingOperationTerminations,
    agents,
  );
  if (
    new Set(state.terminalOperationCallIds).size !==
    state.terminalOperationCallIds.length
  ) {
    throw new Error("Snapshot contains duplicate terminal operation call IDs");
  }
  const terminalOperationCallIds = new Set(state.terminalOperationCallIds);
  for (const callId of terminalOperationCallIds) {
    if (pendingOperationTerminations.has(callId)) {
      throw new Error(`Terminal operation ${callId} is also pending`);
    }
    for (const agent of agents.values()) {
      if (agent.activeOperations.has(callId)) {
        throw new Error(`Terminal operation ${callId} is still active`);
      }
    }
  }
  const suspendedMode = validateAndResolveSnapshotMode(state, decisionCycle);
  const restored: WorldState = {
    id: snapshot.worldId,
    name: state.name,
    version: snapshot.worldVersion,
    tick: snapshot.worldTick,
    mode: state.mode,
    suspendedMode,
    reviewRequired: state.reviewRequired,
    randomState: state.randomState,
    lastEventSequence: snapshot.lastEventSequence,
    pluginLockHash: snapshot.pluginLockHash,
    simulationRulesLock: configuredRulesLock,
    history,
    map: expectedMap,
    agents,
    objects,
    decisionCycle,
    pendingOperationTerminations,
    terminalOperationCallIds,
    technicalFailure: state.technicalFailure,
  };
  validateRestoredOperations(restored, registry);
  return restored;
}
