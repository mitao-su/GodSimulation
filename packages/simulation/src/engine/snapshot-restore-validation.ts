import {
  verifySimulationRulesLock,
  type SimulationRulesLock,
  type WorldSnapshot,
} from "@god-sim/protocol";

import type { MapDefinition } from "../map/map-definition";
import { createOperationRuntimeContext } from "../execution/operation-runtime";
import type { SimulationRegistry } from "./simulation-registry";
import type { DecisionCycleState, WorldState } from "../world/world-state";
import type { SerializedWorldState } from "./snapshot-state-codec";

export function validateSnapshotRulesLock(
  snapshot: WorldSnapshot,
  configuredValue: SimulationRulesLock,
): SimulationRulesLock {
  const configured = verifySimulationRulesLock(configuredValue);
  if (snapshot.schemaVersion !== 3) return configured;

  let snapshotLock: SimulationRulesLock;
  try {
    snapshotLock = verifySimulationRulesLock(snapshot.simulationRulesLock);
  } catch (error) {
    throw new Error(
      "Snapshot simulation rules do not match the configured rule lock",
      { cause: error },
    );
  }
  if (
    snapshotLock.hash !== configured.hash ||
    JSON.stringify(snapshotLock.rules) !== JSON.stringify(configured.rules)
  ) {
    throw new Error(
      "Snapshot simulation rules do not match the configured rule lock",
    );
  }
  return configured;
}

export function validateSnapshotWorldIdentity(
  snapshot: WorldSnapshot,
  state: SerializedWorldState,
  expectedMap: MapDefinition,
): void {
  if (state.map.id !== snapshot.worldId || expectedMap.id !== snapshot.worldId) {
    throw new Error("Snapshot world ID does not match its map");
  }
  if (JSON.stringify(state.map) !== JSON.stringify(expectedMap)) {
    throw new Error("Snapshot map does not match the configured world definition");
  }
  if (state.name !== state.map.name) {
    throw new Error("Snapshot world name does not match its map");
  }
}

export function validateAndResolveSnapshotMode(
  state: SerializedWorldState,
  decisionCycle: DecisionCycleState | null,
): WorldState["suspendedMode"] {
  const hasPendingDecision = decisionCycle
    ? [...decisionCycle.requests.values()].some(
        (request) => request.acceptedProposal === null,
      )
    : false;
  const suspendedMode =
    state.suspendedMode === undefined
      ? state.mode === "TECHNICALLY_BLOCKED"
        ? decisionCycle === null
          ? "RUNNING"
          : hasPendingDecision
            ? "THINKING"
            : "READY_FOR_RELEASE"
        : null
      : state.suspendedMode;
  if (
    (state.mode === "TECHNICALLY_BLOCKED") !==
    (state.technicalFailure !== null)
  ) {
    throw new Error("Snapshot technical failure does not match its world mode");
  }
  if (
    (state.mode === "TECHNICALLY_BLOCKED") !== (suspendedMode !== null)
  ) {
    throw new Error("Snapshot suspended mode does not match its world mode");
  }
  const resumableMode =
    state.mode === "TECHNICALLY_BLOCKED" ? suspendedMode : state.mode;
  if (!resumableMode) throw new Error("Snapshot has no resumable world mode");
  if (resumableMode === "RUNNING" && decisionCycle !== null) {
    throw new Error("Running snapshot cannot retain a decision cycle");
  }
  if (resumableMode !== "RUNNING" && decisionCycle === null) {
    throw new Error("Frozen snapshot requires a decision cycle");
  }
  if (resumableMode === "READY_FOR_RELEASE" && hasPendingDecision) {
    throw new Error("Ready snapshot still has pending decisions");
  }
  if (resumableMode === "THINKING" && !hasPendingDecision) {
    throw new Error("Thinking snapshot has no pending decision");
  }
  return suspendedMode;
}

export function validateRestoredOperations(
  world: WorldState,
  registry: SimulationRegistry,
): void {
  for (const [agentId, agent] of [...world.agents].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const operation of [...agent.activeOperations.values()].sort(
      (left, right) => left.callId.localeCompare(right.callId),
    )) {
      const runtime = registry.getOperation(operation.operationId);
      if (!runtime) {
        throw new Error(
          `Snapshot operation ${operation.callId} uses unregistered operation ${operation.operationId}`,
        );
      }
      if (
        operation.taskSlots.length !== runtime.taskSlots.length ||
        operation.taskSlots.some(
          (track, index) => track !== runtime.taskSlots[index],
        )
      ) {
        throw new Error(
          `Snapshot operation ${operation.callId} task slots do not match ${operation.operationId}`,
        );
      }
      const context = createOperationRuntimeContext(world, registry, agentId);
      const parsedArguments = runtime
        .argumentsSchema(context)
        .safeParse(operation.arguments);
      if (!parsedArguments.success) {
        throw new Error(
          `Snapshot operation ${operation.callId} has incompatible arguments`,
          { cause: parsedArguments.error },
        );
      }
      try {
        runtime.validateRestored(context, operation);
      } catch (error) {
        throw new Error(
          `Snapshot operation ${operation.callId} has an incompatible plan`,
          { cause: error },
        );
      }
    }
  }
}
