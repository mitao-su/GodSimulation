import {
  DecisionIdentitySchema,
  type HostToWorkerMessage,
  type PluginLock,
  type WorldSnapshot,
  type WorkerToHostMessage,
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
  readonly reviewRequired: boolean;
  readonly deterministicSeed: number;
  readonly restoredSnapshot?: WorldSnapshot;
  readonly emit: (message: WorkerToHostMessage) => void;
}
export class WorldSession {
  readonly #engine: SimulationEngine;
  readonly #emit: (message: WorkerToHostMessage) => void;
  readonly #agentDefinitions = new Map<string, GamePlugin["agents"][number]>();
  readonly #publishedRequestIds = new Set<string>();

  constructor(options: WorldSessionOptions) {
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
    this.#engine = options.restoredSnapshot
      ? restoreSimulation({
          snapshot: options.restoredSnapshot,
          worldDefinition: map,
          plugins: options.plugins,
        })
      : createSimulation({
          worldDefinition: map,
          plugins: options.plugins,
          reviewRequired: options.reviewRequired,
          seed: options.deterministicSeed,
          pluginLockHash: options.pluginLock.hash,
        });
    this.#emit = options.emit;
  }

  start(): void {
    this.#publishState();
  }

  isRunning(): boolean {
    return this.#engine.getView().mode === "RUNNING";
  }

  tick(): void {
    if (!this.isRunning()) return;
    this.#engine.tick();
    this.#publishState();
  }

  handle(message: Exclude<HostToWorkerMessage, { type: "initialize" }>): void {
    switch (message.type) {
      case "world_command": {
        const queued = this.#engine.dispatch(message.command);
        if (!queued.accepted) throw new Error(queued.reason);
        this.#engine.tick();
        this.#publishState();
        return;
      }
      case "decision_result": {
        const input = this.#findStoredInput(message.result.requestId);
        const option = input?.goalOptions.find(
          (candidate) => candidate.id === message.result.proposal.goalOptionId,
        );
        const buffered =
          input && option
            ? this.#engine.acceptDecision({
                identity: DecisionIdentitySchema.parse({
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
                }),
                goalOptionId: message.result.proposal.goalOptionId,
                goal: option.goal,
                modelReason: message.result.proposal.reason,
              })
            : { accepted: false, reason: "Decision result does not match a pending option" };
        if (!buffered.accepted) {
          this.#emit({
            type: "decision_rejected",
            result: DecisionIdentitySchema.parse({
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
            }),
            reason: buffered.reason,
          });
          return;
        }
        this.#engine.tick();
        this.#publishState();
        return;
      }
      case "decision_failure": {
        const recorded = this.#engine.reportDecisionFailure(message.failure);
        if (!recorded.accepted) throw new Error(recorded.reason);
        this.#publishState();
        return;
      }
      case "request_snapshot":
        this.#emit({ type: "snapshot_ready", snapshot: this.#engine.createSnapshot() });
        return;
      case "shutdown":
        this.#emit({ type: "snapshot_ready", snapshot: this.#engine.createSnapshot() });
        return;
    }
  }

  #findStoredInput(requestId: string) {
    return this.#engine
      .getPendingDecisionInputs()
      .find((input) => input.requestId === requestId);
  }

  #publishState(): void {
    const events = this.#engine.drainEvents();
    if (events.length > 0) this.#emit({ type: "event_batch", events: [...events] });
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
    this.#emit({ type: "world_view", view: this.#engine.getView() });
  }
}
