import {
  CheckpointIdSchema,
  DecisionIdentitySchema,
  GoalOptionIdSchema,
  GoalProposalSchema,
  GoalSchema,
  TechnicalFailureSchema,
  WorldCommandSchema,
  type DecisionIdentity,
  type DecisionPromptInput,
  type DomainEvent,
  type CheckpointId,
  type Goal,
  type GoalOptionId,
  type ModelDecisionResult,
  type TechnicalFailure,
  type WorldCommand,
  type WorldSnapshot,
  type WorldSnapshotV2,
  type WorldView,
} from "@god-sim/protocol";
import type { GamePlugin } from "@god-sim/plugin-sdk";

import {
  acceptDecisionResult,
  recordDecisionFailure,
  requestDecisions,
  retryDecisionRequest,
  type DecisionRequestSpec,
} from "../decision/decision-gate";
import { buildGoalOptions } from "../decision/goal-option-provider";
import { applyReleasePolicy, releaseDecisionCycle } from "../decision/release-policy";
import {
  loadWorldDefinition,
  type InitialPerceptionSeed,
} from "../map/map-loader";
import {
  recordPerceptionCandidates,
  type PerceptionCandidate,
} from "../perception/perception-recorder";
import { createPluginRegistry, type PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";
import { appendDomainEvent } from "./event-writer";
import { assertSnapshotCausality } from "./snapshot-causality";
import { projectWorldSnapshot } from "./snapshot-projector";
import { restoreWorldSnapshot } from "./snapshot-restorer";
import {
  refreshAllPerceptions,
  runTickPipeline,
  type DecisionNeed,
} from "./tick-pipeline";
import { projectWorldView } from "./view-projector";

export interface SimulationOptions {
  readonly worldDefinition: unknown;
  readonly plugins: readonly GamePlugin[];
  readonly reviewRequired?: boolean;
  readonly seed?: number;
  readonly pluginLockHash?: string;
}

export interface SimulationRestoreOptions {
  readonly snapshot: WorldSnapshot;
  readonly worldDefinition: unknown;
  readonly plugins: readonly GamePlugin[];
}

export interface AdoptedDecision {
  readonly identity: DecisionIdentity;
  readonly goalOptionId: GoalOptionId;
  readonly goal: Goal;
  readonly modelReason: string;
}

export interface BufferResult {
  readonly accepted: boolean;
  readonly reason: string;
}

export interface SimulationCheckpoint {
  readonly checkpointId: CheckpointId;
  readonly events: readonly DomainEvent[];
  readonly snapshot: WorldSnapshotV2;
}

export interface SimulationEngine {
  dispatch(command: WorldCommand): BufferResult;
  acceptDecision(decision: AdoptedDecision): BufferResult;
  reportDecisionFailure(failure: TechnicalFailure): BufferResult;
  reportTechnicalFailure(failure: TechnicalFailure): BufferResult;
  tick(): WorldView;
  getView(): WorldView;
  getPendingDecisionInputs(): readonly DecisionPromptInput[];
  prepareCheckpoint(): SimulationCheckpoint;
  acknowledgeCheckpoint(checkpointId: CheckpointId): BufferResult;
  createSnapshot(): WorldSnapshotV2;
}

function identitiesMatch(expected: DecisionIdentity, actual: DecisionIdentity): boolean {
  return (
    expected.requestId === actual.requestId &&
    expected.agentId === actual.agentId &&
    expected.worldId === actual.worldId &&
    expected.worldVersion === actual.worldVersion &&
    expected.decisionCycleId === actual.decisionCycleId &&
    expected.schemaVersion === actual.schemaVersion &&
    expected.pluginLockHash === actual.pluginLockHash &&
    expected.retryOfRequestId === actual.retryOfRequestId
  );
}

function goalsMatch(expected: Goal, actual: Goal): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function initialPerceptionCandidate(seed: InitialPerceptionSeed): PerceptionCandidate {
  if (seed.kind === "memory") {
    return {
      agentId: seed.agentId,
      observationKind: "memory",
      summary: seed.summary,
      relatedEntityId: null,
      subject: { kind: "memory", memoryId: seed.memoryId },
    };
  }
  return {
    agentId: seed.agentId,
    observationKind: "memory",
    summary: seed.summary,
    relatedEntityId: seed.entityId,
    subject: {
      kind: "object",
      value: {
        entityId: seed.entityId,
        displayName: seed.displayName,
        status: "remembered",
        summary: seed.summary,
        observable: {},
        position: seed.position,
        observedAtTick: 0,
      },
    },
  };
}

function initialPerceptionMetadata(candidate: PerceptionCandidate) {
  const subjectId =
    candidate.subject.kind === "memory"
      ? candidate.subject.memoryId
      : candidate.subject.kind === "object"
        ? candidate.subject.value.entityId
        : candidate.subject.value.agentId;
  const causationId = `initial-perception:${candidate.agentId}:${candidate.subject.kind}:${subjectId}`;
  return { causationId, correlationId: causationId };
}

class DeterministicSimulationEngine implements SimulationEngine {
  #world: WorldState;
  readonly #registry: PluginRegistry;
  readonly #commandQueue: WorldCommand[] = [];
  readonly #decisionQueue = new Map<string, AdoptedDecision>();
  #eventOutbox: DomainEvent[] = [];
  #preparedCheckpoint: {
    readonly value: SimulationCheckpoint;
    readonly eventCount: number;
  } | null = null;
  #recentEvents: DomainEvent[] = [];
  #revision = 0;
  #stopped = false;

  constructor(
    world: WorldState,
    registry: PluginRegistry,
    initialPerceptions: readonly InitialPerceptionSeed[] | null,
  ) {
    this.#world = world;
    this.#registry = registry;

    if (initialPerceptions === null) {
      this.#revision = 1;
      return;
    }
    const initialized = recordPerceptionCandidates(
      this.#world,
      initialPerceptions.map(initialPerceptionCandidate),
      initialPerceptionMetadata,
    );
    this.#world = initialized.world;
    this.#recordEvents(initialized.events);
    const perception = refreshAllPerceptions(this.#world, this.#registry);
    this.#world = perception.world;
    this.#recordEvents(perception.events);
    this.#requestDecisionCycle(
      [...this.#world.agents.keys()].map((agentId) => ({
        agentId,
        reason: { code: "initial_goal", summary: "Choose a first goal" },
      })),
    );
    this.#revision = 1;
  }

  dispatch(commandInput: WorldCommand): BufferResult {
    const parsed = WorldCommandSchema.safeParse(commandInput);
    if (!parsed.success) return { accepted: false, reason: parsed.error.message };
    if (parsed.data.worldId !== this.#world.id) {
      return { accepted: false, reason: `Command targets ${parsed.data.worldId}, not ${this.#world.id}` };
    }
    this.#commandQueue.push(parsed.data);
    return { accepted: true, reason: "Command queued" };
  }

  acceptDecision(decisionInput: AdoptedDecision): BufferResult {
    const identity = DecisionIdentitySchema.safeParse(decisionInput.identity);
    const goalOptionId = GoalOptionIdSchema.safeParse(decisionInput.goalOptionId);
    const goal = GoalSchema.safeParse(decisionInput.goal);
    const proposal = GoalProposalSchema.safeParse({
      schemaVersion: 1,
      goalOptionId: decisionInput.goalOptionId,
      reason: decisionInput.modelReason,
    });
    if (!identity.success || !goalOptionId.success || !goal.success || !proposal.success) {
      return { accepted: false, reason: "Adopted decision failed schema validation" };
    }
    const cycle = this.#world.decisionCycle;
    const request = cycle?.requests.get(identity.data.agentId);
    if (!request || !identitiesMatch(request.identity, identity.data)) {
      return { accepted: false, reason: "Adopted decision does not match an active request" };
    }
    if (request.acceptedProposal !== null) {
      return { accepted: false, reason: `Request ${identity.data.requestId} is already ready` };
    }
    if (request.failure !== null) {
      return { accepted: false, reason: `Request ${identity.data.requestId} has failed` };
    }
    if (this.#decisionQueue.has(identity.data.requestId)) {
      return { accepted: false, reason: `Request ${identity.data.requestId} is already buffered` };
    }
    const option = request.promptInput.goalOptions.find(
      (candidate) => candidate.id === goalOptionId.data,
    );
    if (!option || !goalsMatch(option.goal, goal.data)) {
      return { accepted: false, reason: "Adopted goal is not the stored program-owned option" };
    }
    const decision: AdoptedDecision = {
      identity: identity.data,
      goalOptionId: goalOptionId.data,
      goal: goal.data,
      modelReason: proposal.data.reason,
    };
    this.#decisionQueue.set(identity.data.requestId, decision);
    return { accepted: true, reason: "Decision buffered" };
  }

  reportDecisionFailure(failure: TechnicalFailure): BufferResult {
    try {
      this.#world = recordDecisionFailure(this.#world, failure);
      this.#revision += 1;
      return { accepted: true, reason: "Decision failure recorded" };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  reportTechnicalFailure(failureInput: TechnicalFailure): BufferResult {
    const failure = TechnicalFailureSchema.safeParse(failureInput);
    if (!failure.success) {
      return { accepted: false, reason: `Technical failure is invalid: ${failure.error.message}` };
    }
    this.#world = {
      ...this.#world,
      version: this.#world.version + 1,
      mode: "TECHNICALLY_BLOCKED",
      suspendedMode:
        this.#world.mode === "TECHNICALLY_BLOCKED"
          ? this.#world.suspendedMode
          : this.#world.mode,
      technicalFailure: failure.data,
    };
    this.#revision += 1;
    return { accepted: true, reason: "Technical failure recorded" };
  }

  tick(): WorldView {
    if (this.#stopped) return this.getView();
    const before = this.#world;
    const wasRunning = before.mode === "RUNNING";
    const eventCount = this.#eventOutbox.length;

    this.#processCommands();
    this.#commitBufferedDecisions();

    if (wasRunning && this.#world.mode === "RUNNING" && !this.#stopped) {
      const result = runTickPipeline(this.#world, this.#registry);
      this.#world = result.world;
      this.#recordEvents(result.events);
      if (result.decisionNeeds.length > 0) this.#requestDecisionCycle(result.decisionNeeds);
    }

    if (this.#world !== before || this.#eventOutbox.length !== eventCount) this.#revision += 1;
    return this.getView();
  }

  getView(): WorldView {
    return projectWorldView(this.#world, this.#registry, this.#revision, this.#recentEvents);
  }

  getPendingDecisionInputs(): readonly DecisionPromptInput[] {
    const cycle = this.#world.decisionCycle;
    if (!cycle) return [];
    return cycle.requestedAgentIds.flatMap((agentId) => {
      const request = cycle.requests.get(agentId);
      if (
        !request ||
        request.acceptedProposal !== null ||
        request.failure !== null ||
        this.#decisionQueue.has(request.identity.requestId)
      ) {
        return [];
      }
      return [request.promptInput];
    });
  }

  prepareCheckpoint(): SimulationCheckpoint {
    if (this.#preparedCheckpoint) return this.#preparedCheckpoint.value;
    const snapshot = projectWorldSnapshot(this.#world);
    assertSnapshotCausality(snapshot);
    const value: SimulationCheckpoint = {
      checkpointId: CheckpointIdSchema.parse(
        `checkpoint:${snapshot.worldId}:${snapshot.worldVersion}:${snapshot.lastEventSequence}`,
      ),
      events: [...this.#eventOutbox],
      snapshot,
    };
    this.#preparedCheckpoint = {
      value,
      eventCount: value.events.length,
    };
    return value;
  }

  acknowledgeCheckpoint(checkpointId: CheckpointId): BufferResult {
    const prepared = this.#preparedCheckpoint;
    if (!prepared) {
      return { accepted: false, reason: "No checkpoint is pending acknowledgement" };
    }
    if (prepared.value.checkpointId !== checkpointId) {
      return {
        accepted: false,
        reason: `Checkpoint ${checkpointId} does not match the pending checkpoint`,
      };
    }
    const prefixMatches = prepared.value.events.every(
      (event, index) => this.#eventOutbox[index]?.eventId === event.eventId,
    );
    if (!prefixMatches) {
      return {
        accepted: false,
        reason: `Checkpoint ${checkpointId} Event prefix no longer matches the buffer`,
      };
    }
    this.#eventOutbox = this.#eventOutbox.slice(prepared.eventCount);
    this.#preparedCheckpoint = null;
    return { accepted: true, reason: `Checkpoint ${checkpointId} acknowledged` };
  }

  createSnapshot(): WorldSnapshotV2 {
    return projectWorldSnapshot(this.#world);
  }

  #recordEvents(events: readonly DomainEvent[]): void {
    if (events.length === 0) return;
    this.#eventOutbox.push(...events);
    this.#recentEvents = [...this.#recentEvents, ...events].slice(-50);
  }

  #requestDecisionCycle(needs: readonly DecisionNeed[]): void {
    if (needs.length === 0) return;
    const specs: DecisionRequestSpec[] = needs.map((need) => ({
      agentId: need.agentId,
      reason: need.reason,
      goalOptions: buildGoalOptions(this.#world, this.#registry, need.agentId),
    }));
    const transition = requestDecisions(this.#world, specs);
    this.#world = transition.world;
    const cycle = this.#world.decisionCycle!;
    const events: DomainEvent[] = [];
    for (const agentId of cycle.requestedAgentIds) {
      const request = cycle.requests.get(agentId);
      if (!request) throw new Error(`Missing decision request for ${agentId}`);
      const written = appendDomainEvent(
        this.#world,
        {
          type: "decision_requested",
          agentId,
          requestId: request.identity.requestId,
          decisionCycleId: cycle.id,
          reasonCode: request.promptInput.decisionReason.code,
        },
        {
          causationId: request.identity.requestId,
          correlationId: cycle.id,
        },
      );
      this.#world = written.world;
      events.push(written.event);
    }
    this.#recordEvents(events);
  }

  #processCommands(): void {
    const commands = this.#commandQueue.splice(0);
    for (const command of commands) {
      if (
        command.type !== "set_review_mode" &&
        command.type !== "retry_technical_failure" &&
        command.expectedWorldVersion !== this.#world.version
      ) {
        throw new Error(
          `Command ${command.commandId} expected world version ${command.expectedWorldVersion}, found ${this.#world.version}`,
        );
      }
      switch (command.type) {
        case "release_execution": {
          if (this.#world.mode !== "READY_FOR_RELEASE" || !this.#world.decisionCycle) {
            throw new Error("The world is not ready for release");
          }
          const cycleId = this.#world.decisionCycle.id;
          this.#world = releaseDecisionCycle(this.#world);
          this.#recordWorldReleased(cycleId, false, command.commandId);
          break;
        }
        case "set_review_mode": {
          this.#world = {
            ...this.#world,
            version: this.#world.version + 1,
            reviewRequired: command.enabled,
          };
          if (this.#world.mode === "TECHNICALLY_BLOCKED") break;
          const cycleId = this.#world.decisionCycle?.id;
          const released = applyReleasePolicy(this.#world);
          if (cycleId && released.mode === "RUNNING" && this.#world.mode !== "RUNNING") {
            this.#world = released;
            this.#recordWorldReleased(cycleId, true, command.commandId);
          } else {
            this.#world = released;
          }
          break;
        }
        case "retry_decision": {
          this.#world = retryDecisionRequest(this.#world, command.requestId);
          const request = [...this.#world.decisionCycle!.requests.values()].find(
            (candidate) => candidate.identity.retryOfRequestId === command.requestId,
          );
          if (!request) throw new Error(`Retry did not create a request for ${command.requestId}`);
          const written = appendDomainEvent(
            this.#world,
            {
              type: "decision_requested",
              agentId: request.identity.agentId,
              requestId: request.identity.requestId,
              decisionCycleId: request.identity.decisionCycleId,
              reasonCode: request.promptInput.decisionReason.code,
            },
            {
              causationId: command.commandId,
              correlationId: request.identity.decisionCycleId,
            },
          );
          this.#world = written.world;
          this.#recordEvents([written.event]);
          break;
        }
        case "retry_technical_failure": {
          const failure = this.#world.technicalFailure;
          if (
            this.#world.mode !== "TECHNICALLY_BLOCKED" ||
            !failure ||
            failure.id !== command.failureId
          ) {
            throw new Error(`Technical failure ${command.failureId} is not active`);
          }
          if (!failure.retryable) {
            throw new Error(`Technical failure ${command.failureId} is not retryable`);
          }
          if (!this.#world.suspendedMode) {
            throw new Error(`Technical failure ${command.failureId} has no suspended mode`);
          }
          const recovered = {
            ...this.#world,
            version: this.#world.version + 1,
            mode: this.#world.suspendedMode,
            suspendedMode: null,
            technicalFailure: null,
          };
          const cycleId = recovered.decisionCycle?.id;
          const released = applyReleasePolicy(recovered);
          if (cycleId && released.mode === "RUNNING" && recovered.mode !== "RUNNING") {
            this.#world = released;
            this.#recordWorldReleased(cycleId, true, command.commandId);
          } else {
            this.#world = released;
          }
          break;
        }
        case "stop_session":
          this.#stopped = true;
          break;
      }
    }
  }

  #commitBufferedDecisions(): void {
    if (this.#decisionQueue.size === 0) return;
    const cycle = this.#world.decisionCycle;
    if (!cycle) throw new Error("Buffered decisions have no active cycle");
    const events: DomainEvent[] = [];
    for (const agentId of cycle.requestedAgentIds) {
      const request = cycle.requests.get(agentId);
      const adopted = request ? this.#decisionQueue.get(request.identity.requestId) : undefined;
      if (!request || !adopted) continue;
      const result: ModelDecisionResult = {
        ...adopted.identity,
        proposal: {
          schemaVersion: 1,
          goalOptionId: adopted.goalOptionId,
          reason: adopted.modelReason,
        },
      };
      const accepted = acceptDecisionResult(this.#world, result);
      if (!accepted.accepted) throw new Error(accepted.reason ?? "Decision was rejected");
      this.#world = accepted.world;
      const written = appendDomainEvent(
        this.#world,
        {
          type: "decision_accepted",
          agentId,
          requestId: result.requestId,
          goalOptionId: result.proposal.goalOptionId,
        },
        {
          causationId: result.requestId,
          correlationId: result.decisionCycleId,
        },
      );
      this.#world = written.world;
      events.push(written.event);
      this.#decisionQueue.delete(result.requestId);
    }
    this.#recordEvents(events);

    const cycleId = this.#world.decisionCycle?.id;
    const released = applyReleasePolicy(this.#world);
    if (cycleId && released.mode === "RUNNING" && this.#world.mode !== "RUNNING") {
      this.#world = released;
      this.#recordWorldReleased(cycleId, true, `release:${cycleId}`);
    } else {
      this.#world = released;
    }
  }

  #recordWorldReleased(cycleId: string, automatic: boolean, causationId: string): void {
    const written = appendDomainEvent(
      this.#world,
      { type: "world_released", decisionCycleId: cycleId, automatic },
      { causationId, correlationId: cycleId },
    );
    this.#world = written.world;
    this.#recordEvents([written.event]);
  }
}

export function createSimulation(options: SimulationOptions): SimulationEngine {
  const registry = createPluginRegistry(options.plugins);
  const loaded = loadWorldDefinition(options.worldDefinition, registry, {
    ...(options.reviewRequired === undefined
      ? {}
      : { reviewRequired: options.reviewRequired }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.pluginLockHash === undefined
      ? {}
      : { pluginLockHash: options.pluginLockHash }),
  });
  return new DeterministicSimulationEngine(
    loaded.world,
    registry,
    loaded.initialPerceptions,
  );
}

export function restoreSimulation(options: SimulationRestoreOptions): SimulationEngine {
  const registry = createPluginRegistry(options.plugins);
  const world = restoreWorldSnapshot(options.snapshot, registry, options.worldDefinition);
  return new DeterministicSimulationEngine(world, registry, null);
}
