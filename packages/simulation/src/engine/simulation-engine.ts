import {
  DecisionIdentitySchema,
  GoalOptionIdSchema,
  GoalProposalSchema,
  GoalSchema,
  WorldCommandSchema,
  type DecisionIdentity,
  type DecisionPromptInput,
  type DomainEvent,
  type Goal,
  type GoalOptionId,
  type ModelDecisionResult,
  type TechnicalFailure,
  type WorldCommand,
  type WorldSnapshot,
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
import { loadWorldDefinition } from "../map/map-loader";
import { createPluginRegistry, type PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";
import { appendDomainEvent } from "./event-writer";
import { projectWorldSnapshot } from "./snapshot-projector";
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

export interface SimulationEngine {
  dispatch(command: WorldCommand): BufferResult;
  acceptDecision(decision: AdoptedDecision): BufferResult;
  reportDecisionFailure(failure: TechnicalFailure): BufferResult;
  tick(): WorldView;
  getView(): WorldView;
  getPendingDecisionInputs(): readonly DecisionPromptInput[];
  drainEvents(): readonly DomainEvent[];
  createSnapshot(): WorldSnapshot;
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

class DeterministicSimulationEngine implements SimulationEngine {
  #world: WorldState;
  readonly #registry: PluginRegistry;
  readonly #commandQueue: WorldCommand[] = [];
  readonly #decisionQueue = new Map<string, AdoptedDecision>();
  #eventOutbox: DomainEvent[] = [];
  #recentEvents: DomainEvent[] = [];
  #revision = 0;
  #stopped = false;

  constructor(world: WorldState, registry: PluginRegistry) {
    this.#world = world;
    this.#registry = registry;

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

  tick(): WorldView {
    if (this.#stopped) return this.getView();
    const before = this.#world;
    const eventCount = this.#eventOutbox.length;

    this.#processCommands();
    this.#commitBufferedDecisions();

    if (this.#world.mode === "RUNNING") {
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
        this.#decisionQueue.has(request.identity.requestId)
      ) {
        return [];
      }
      return [request.promptInput];
    });
  }

  drainEvents(): readonly DomainEvent[] {
    const events = this.#eventOutbox;
    this.#eventOutbox = [];
    return events;
  }

  createSnapshot(): WorldSnapshot {
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
      if (command.expectedWorldVersion !== this.#world.version) {
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
  const world = loadWorldDefinition(options.worldDefinition, registry, {
    ...(options.reviewRequired === undefined
      ? {}
      : { reviewRequired: options.reviewRequired }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.pluginLockHash === undefined
      ? {}
      : { pluginLockHash: options.pluginLockHash }),
  });
  return new DeterministicSimulationEngine(world, registry);
}
