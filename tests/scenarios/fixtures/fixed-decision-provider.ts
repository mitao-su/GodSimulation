import {
  type AgentId,
  type DecisionIdentity,
  type JsonObject,
  type TaskOption,
  type WorldCommand,
} from "@god-sim/protocol";
import {
  createSimulation,
  type AdoptedDecision,
  type SimulationEngine,
} from "@god-sim/simulation";
import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../../fixtures/simulation-rules";

export type TaskOptionSelector = (option: TaskOption) => boolean;

export function starterEngine(
  options: {
    readonly reviewRequired?: boolean;
    readonly aliceBladder?: number;
    readonly bobBladder?: number;
  } = {},
): SimulationEngine {
  const worldDefinition = {
    ...starterHome,
    spawns: starterHome.spawns.map((spawn) => {
      const bladder =
        spawn.agentId === "alice"
          ? options.aliceBladder
          : spawn.agentId === "bob"
            ? options.bobBladder
            : undefined;
      return bladder === undefined
        ? spawn
        : { ...spawn, needs: { ...spawn.needs, bladder } };
    }),
  };
  return createSimulation({
    worldDefinition,
    plugins: [spatialPlugin, homePlugin, agentsPlugin],
    reviewRequired: options.reviewRequired ?? true,
    seed: 1,
    simulationRulesLock: testSimulationRulesLock,
  });
}

interface SnapshotAgent {
  readonly id: string;
  readonly bladder: number;
  readonly taskTracks: unknown;
  readonly activeOperations: readonly unknown[];
}

interface SnapshotObject {
  readonly id: string;
  readonly state: unknown;
}

function snapshotState(engine: SimulationEngine): {
  readonly agents: readonly SnapshotAgent[];
  readonly objects: readonly SnapshotObject[];
} {
  return engine.createSnapshot().state as unknown as {
    readonly agents: readonly SnapshotAgent[];
    readonly objects: readonly SnapshotObject[];
  };
}

export function snapshotAgent(
  engine: SimulationEngine,
  agentId: string,
): SnapshotAgent {
  const agent = snapshotState(engine).agents.find(
    (candidate) => candidate.id === agentId,
  );
  if (!agent) throw new Error(`No snapshot agent ${agentId}`);
  return agent;
}

export function snapshotObject(
  engine: SimulationEngine,
  entityId: string,
): SnapshotObject {
  const object = snapshotState(engine).objects.find(
    (candidate) => candidate.id === entityId,
  );
  if (!object) throw new Error(`No snapshot object ${entityId}`);
  return object;
}

function identityFromInput(
  input: ReturnType<SimulationEngine["getPendingDecisionInputs"]>[number],
): DecisionIdentity {
  return {
    requestId: input.requestId,
    agentId: input.agentId,
    worldId: input.worldId,
    worldVersion: input.worldVersion,
    decisionCycleId: input.decisionCycleId,
    schemaVersion: input.schemaVersion,
    pluginLockHash: input.pluginLockHash,
    ...(input.retryOfRequestId === undefined
      ? {}
      : { retryOfRequestId: input.retryOfRequestId }),
  };
}

function defaultArguments(option: TaskOption): JsonObject {
  return option.kind === "operation" && option.operationId === "core.wait"
    ? { durationTicks: 600 }
    : {};
}

export function adoptTask(
  engine: SimulationEngine,
  agentId: AgentId,
  select: TaskOptionSelector,
  argumentsValue?: JsonObject,
): AdoptedDecision {
  const input = engine
    .getPendingDecisionInputs()
    .find((candidate) => candidate.agentId === agentId);
  if (!input) throw new Error(`No pending decision for ${agentId}`);
  const option = input.taskOptions.find(select);
  if (!option) throw new Error(`No matching task option for ${agentId}`);
  const selection = {
    kind: "replace" as const,
    taskOptionId: option.id,
    arguments: argumentsValue ?? defaultArguments(option),
  };
  const adopted: AdoptedDecision = {
    identity: identityFromInput(input),
    proposal: {
      schemaVersion: 2,
      head: option.taskSlots.includes("HEAD")
        ? selection
        : { kind: "continue" },
      body: option.taskSlots.includes("BODY")
        ? selection
        : { kind: "continue" },
      reason: `Select ${option.label}`,
    },
  };
  const buffered = engine.acceptDecision(adopted);
  if (!buffered.accepted) throw new Error(buffered.reason);
  return adopted;
}

function targets(option: TaskOption, entityId: string): boolean {
  return (
    option.kind === "operation" &&
    option.fixedArguments.targetEntityId === entityId
  );
}

export function selectMoveTo(entityId: string): TaskOptionSelector {
  return (option) =>
    option.kind === "operation" &&
    option.operationId === "core.move" &&
    targets(option, entityId);
}

export function selectInteraction(
  entityId: string,
  interactionId = "use",
): TaskOptionSelector {
  return (option) =>
    option.kind === "operation" &&
    option.operationId.endsWith(`.${interactionId}`) &&
    targets(option, entityId);
}

export function selectWait(option: TaskOption): boolean {
  return option.kind === "operation" && option.operationId === "core.wait";
}

export function releaseCommand(engine: SimulationEngine): WorldCommand {
  const view = engine.getView();
  return {
    schemaVersion: 1,
    commandId: `command:release:${view.worldVersion}` as never,
    worldId: view.worldId,
    expectedWorldVersion: view.worldVersion,
    issuedAtRealTime: "2026-08-31T00:00:00.000Z",
    type: "release_execution",
  };
}

export function runUntil(
  engine: SimulationEngine,
  predicate: (engine: SimulationEngine) => boolean,
  maxTicks = 500,
): void {
  for (let count = 0; count < maxTicks; count += 1) {
    if (predicate(engine)) return;
    engine.tick();
  }
  const state = snapshotState(engine);
  const view = engine.getView();
  throw new Error(
    `Condition was not reached after ${maxTicks} engine ticks: ${JSON.stringify({
      view: {
        mode: view.mode,
        worldTick: view.worldTick,
        pauseReason: view.pauseReason,
        pendingDecisions: view.pendingDecisions,
      },
      agents: state.agents,
      objects: state.objects,
    })}`,
  );
}
