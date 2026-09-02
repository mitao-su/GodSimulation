import {
  verifySimulationRulesLock,
  type SimulationRulesLock,
  type WorldSnapshot,
} from "@god-sim/protocol";

import type { MapDefinition } from "../map/map-definition";
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
