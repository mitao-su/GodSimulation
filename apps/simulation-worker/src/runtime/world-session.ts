import {
  CheckpointIdSchema,
  DecisionIdentitySchema,
  verifySimulationRulesLock,
  type CheckpointId,
  type HostToWorkerMessage,
  type PluginLock,
  type SimulationRulesLock,
  type TechnicalFailure,
  type WorkerToHostMessage,
  type WorldSnapshot,
} from "@god-sim/protocol";
import type { GamePlugin } from "@god-sim/plugin-sdk";
import { assembleDecisionRequest } from "@god-sim/cognition";
import {
  createPluginRegistry,
  createSimulation,
  MapDefinitionSchema,
  restoreSimulation,
  type SimulationEngine,
} from "@god-sim/simulation";

export interface WorldSessionOptions {
  readonly worldDefinition: unknown;
  readonly plugins: readonly GamePlugin[];
  readonly pluginLock: PluginLock;
  readonly simulationRulesLock: SimulationRulesLock;
  readonly reviewRequired: boolean;
  readonly deterministicSeed: number;
  readonly restoredSnapshot?: WorldSnapshot;
  readonly emit: (message: WorkerToHostMessage) => void;
}

function checkpointIdFor(snapshot: WorldSnapshot): CheckpointId {
  return CheckpointIdSchema.parse(
    `checkpoint:${snapshot.worldId}:${snapshot.worldVersion}:${snapshot.lastEventSequence}`,
  );
}

export class WorldSession {
  readonly #engine: SimulationEngine;
  readonly #emit: (message: WorkerToHostMessage) => void;
  readonly #agentDefinitions = new Map<string, GamePlugin["agents"][number]>();
  readonly #publishedRequestIds = new Set<string>();
  readonly #restoredUnresolvedRequestIds = new Set<string>();
  readonly #restored: boolean;
  #pendingCheckpointId: CheckpointId | null = null;
  #lastCommittedCheckpointId: CheckpointId | null = null;
  #shutdownRequested = false;

  constructor(options: WorldSessionOptions) {
    const simulationRulesLock = verifySimulationRulesLock(
      options.simulationRulesLock,
    );
    const map = MapDefinitionSchema.parse(options.worldDefinition);
    const registry = createPluginRegistry(options.plugins);
    for (const spawn of map.spawns) {
      const definition = registry.getAgent(spawn.definitionId)?.definition;
      if (!definition) throw new Error(`Missing agent definition ${spawn.definitionId}`);
      this.#agentDefinitions.set(spawn.agentId, definition);
    }
    if (
      options.restoredSnapshot &&
      options.restoredSnapshot.pluginLockHash !== options.pluginLock.hash
    ) {
      throw new Error("Restored snapshot does not match the loaded plugin lock");
    }
    this.#restored = options.restoredSnapshot !== undefined;
    this.#engine = options.restoredSnapshot
      ? restoreSimulation({
          snapshot: options.restoredSnapshot,
          worldDefinition: map,
          plugins: options.plugins,
          simulationRulesLock,
        })
      : createSimulation({
          worldDefinition: map,
          plugins: options.plugins,
          simulationRulesLock,
          reviewRequired: options.reviewRequired,
          seed: options.deterministicSeed,
          pluginLockHash: options.pluginLock.hash,
        });
    this.#emit = options.emit;
    if (options.restoredSnapshot) {
      this.#lastCommittedCheckpointId = checkpointIdFor(options.restoredSnapshot);
    }
    if (options.restoredSnapshot && this.#engine.getView().mode === "TECHNICALLY_BLOCKED") {
      for (const input of this.#engine.getPendingDecisionInputs()) {
        this.#publishedRequestIds.add(input.requestId);
        this.#restoredUnresolvedRequestIds.add(input.requestId);
      }
    }
  }

  start(): void {
    if (this.#restored) {
      this.#publishDecisionRequests();
    } else {
      this.#beginCheckpoint();
    }
    this.#publishView();
  }

  isRunning(): boolean {
    return this.#engine.getView().mode === "RUNNING";
  }

  tick(): void {
    if (this.#pendingCheckpointId || !this.isRunning()) return;
    const previousMode = this.#engine.getView().mode;
    this.#engine.tick();
    this.#publishAfterStep(previousMode);
  }

  block(failure: TechnicalFailure): void {
    const recorded = this.#engine.reportTechnicalFailure(failure);
    if (!recorded.accepted) throw new Error(recorded.reason);
    if (!(failure.category === "persistence" && this.#pendingCheckpointId)) {
      if (!this.#pendingCheckpointId) this.#beginCheckpoint();
    }
    this.#publishView();
  }

  handle(
    message: Exclude<HostToWorkerMessage, { type: "initialize" }>,
  ): { readonly shutdownReady: boolean } {
    switch (message.type) {
      case "world_command": {
        const previousMode = this.#engine.getView().mode;
        const resumesRestoredRequests =
          message.command.type === "retry_decision" ||
          message.command.type === "retry_technical_failure";
        const queued = this.#engine.dispatch(message.command);
        if (!queued.accepted) throw new Error(queued.reason);
        this.#engine.tick();
        if (resumesRestoredRequests) {
          for (const requestId of this.#restoredUnresolvedRequestIds) {
            this.#publishedRequestIds.delete(requestId);
          }
          this.#restoredUnresolvedRequestIds.clear();
        }
        this.#publishAfterStep(previousMode);
        return { shutdownReady: false };
      }
      case "decision_result": {
        const previousMode = this.#engine.getView().mode;
        const identity = DecisionIdentitySchema.parse({
          requestId: message.result.requestId,
          agentId: message.result.agentId,
          worldId: message.result.worldId,
          worldVersion: message.result.worldVersion,
          decisionCycleId: message.result.decisionCycleId,
          schemaVersion: message.result.schemaVersion,
          pluginLockHash: message.result.pluginLockHash,
          ...(message.result.retryOfRequestId === undefined
            ? {}
            : { retryOfRequestId: message.result.retryOfRequestId }),
        });
        const buffered = this.#engine.acceptDecision({
          identity,
          proposal: message.result.proposal,
        });
        if (!buffered.accepted) {
          this.#emit({
            type: "decision_rejected",
            result: identity,
            reason: buffered.reason,
          });
          return { shutdownReady: false };
        }
        this.#engine.tick();
        this.#publishAfterStep(previousMode);
        return { shutdownReady: false };
      }
      case "decision_failure": {
        const previousMode = this.#engine.getView().mode;
        const recorded = this.#engine.reportDecisionFailure(message.failure);
        if (!recorded.accepted) throw new Error(recorded.reason);
        this.#publishAfterStep(previousMode);
        return { shutdownReady: false };
      }
      case "technical_failure":
        this.block(message.failure);
        return { shutdownReady: false };
      case "request_snapshot":
        this.#emit({ type: "snapshot_ready", snapshot: this.#engine.createSnapshot() });
        return { shutdownReady: false };
      case "checkpoint_committed":
        return { shutdownReady: this.#acknowledgeCheckpoint(message.checkpointId) };
      case "shutdown":
        return { shutdownReady: this.#requestShutdown() };
    }
  }

  #publishAfterStep(previousMode: ReturnType<SimulationEngine["getView"]>["mode"]): void {
    const view = this.#engine.getView();
    const enteredRunning = previousMode !== "RUNNING" && view.mode === "RUNNING";
    const needsNewDecisionCheckpoint =
      view.mode === "THINKING" && this.#hasUnpublishedDecisionRequest();
    const enteredTechnicalBlock = view.mode === "TECHNICALLY_BLOCKED";
    if (
      !this.#pendingCheckpointId &&
      (enteredRunning || needsNewDecisionCheckpoint || enteredTechnicalBlock)
    ) {
      this.#beginCheckpoint();
    }
    this.#publishDecisionRequests();
    this.#publishView();
  }

  #hasUnpublishedDecisionRequest(): boolean {
    return this.#engine
      .getPendingDecisionInputs()
      .some((input) => !this.#publishedRequestIds.has(input.requestId));
  }

  #publishDecisionRequests(): void {
    if (this.#pendingCheckpointId) return;
    const view = this.#engine.getView();
    if (
      view.mode !== "THINKING" &&
      !(view.mode === "TECHNICALLY_BLOCKED" && view.technicalFailure?.category === "model")
    ) {
      return;
    }
    for (const input of this.#engine.getPendingDecisionInputs()) {
      if (this.#publishedRequestIds.has(input.requestId)) continue;
      const definition = this.#agentDefinitions.get(input.agentId);
      if (!definition) throw new Error(`Missing definition for ${input.agentId}`);
      this.#publishedRequestIds.add(input.requestId);
      this.#emit({
        type: "decision_requested",
        request: assembleDecisionRequest(input, definition),
      });
    }
  }

  #publishView(): void {
    this.#emit({ type: "world_view", view: this.#engine.getView() });
  }

  #beginCheckpoint(): void {
    if (this.#pendingCheckpointId) return;
    const checkpoint = this.#engine.prepareCheckpoint();
    this.#pendingCheckpointId = checkpoint.checkpointId;
    this.#emit({
      type: "checkpoint_ready",
      checkpointId: checkpoint.checkpointId,
      events: [...checkpoint.events],
      snapshot: checkpoint.snapshot,
    });
  }

  #acknowledgeCheckpoint(checkpointId: CheckpointId): boolean {
    if (this.#pendingCheckpointId !== checkpointId) {
      throw new Error(`Checkpoint ${checkpointId} is not pending`);
    }
    const acknowledged = this.#engine.acknowledgeCheckpoint(checkpointId);
    if (!acknowledged.accepted) throw new Error(acknowledged.reason);
    this.#pendingCheckpointId = null;
    this.#lastCommittedCheckpointId = checkpointId;

    if (this.#shutdownRequested) return this.#prepareShutdownCheckpoint();

    const view = this.#engine.getView();
    const currentCheckpointId = checkpointIdFor(this.#engine.createSnapshot());
    const changedWhilePending = currentCheckpointId !== checkpointId;
    const needsFollowUpCheckpoint =
      changedWhilePending &&
      (view.mode === "RUNNING" ||
        (view.mode === "THINKING" && this.#hasUnpublishedDecisionRequest()) ||
        (view.mode === "TECHNICALLY_BLOCKED" &&
          view.technicalFailure?.category !== "persistence"));
    if (needsFollowUpCheckpoint) this.#beginCheckpoint();
    this.#publishDecisionRequests();
    return false;
  }

  #requestShutdown(): boolean {
    this.#shutdownRequested = true;
    if (this.#pendingCheckpointId) return false;
    return this.#prepareShutdownCheckpoint();
  }

  #prepareShutdownCheckpoint(): boolean {
    const checkpoint = this.#engine.prepareCheckpoint();
    if (
      checkpoint.checkpointId === this.#lastCommittedCheckpointId &&
      checkpoint.events.length === 0
    ) {
      const acknowledged = this.#engine.acknowledgeCheckpoint(checkpoint.checkpointId);
      if (!acknowledged.accepted) throw new Error(acknowledged.reason);
      return true;
    }
    this.#pendingCheckpointId = checkpoint.checkpointId;
    this.#emit({
      type: "checkpoint_ready",
      checkpointId: checkpoint.checkpointId,
      events: [...checkpoint.events],
      snapshot: checkpoint.snapshot,
    });
    return false;
  }
}
