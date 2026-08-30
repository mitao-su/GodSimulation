import {
  type AgentId,
  type DecisionIdentity,
  type GoalOption,
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
      return bladder === undefined ? spawn : { ...spawn, needs: { ...spawn.needs, bladder } };
    }),
  };
  return createSimulation({
    worldDefinition,
    plugins: [spatialPlugin, homePlugin, agentsPlugin],
    reviewRequired: options.reviewRequired ?? true,
    seed: 1,
  });
}

interface SnapshotAgent {
  readonly id: string;
  readonly bladder: number;
  readonly actionPlan: unknown;
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

export function snapshotAgent(engine: SimulationEngine, agentId: string): SnapshotAgent {
  const agent = snapshotState(engine).agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`No snapshot agent ${agentId}`);
  return agent;
}

export function snapshotObject(engine: SimulationEngine, entityId: string): SnapshotObject {
  const object = snapshotState(engine).objects.find((candidate) => candidate.id === entityId);
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

export function adoptGoal(
  engine: SimulationEngine,
  agentId: AgentId,
  select: (option: GoalOption) => boolean,
): AdoptedDecision {
  const input = engine
    .getPendingDecisionInputs()
    .find((candidate) => candidate.agentId === agentId);
  if (!input) throw new Error(`No pending decision for ${agentId}`);
  const option = input.goalOptions.find(select);
  if (!option) throw new Error(`No matching goal option for ${agentId}`);
  const adopted: AdoptedDecision = {
    identity: identityFromInput(input),
    goalOptionId: option.id,
    goal: option.goal,
    modelReason: "Fixed scenario choice",
  };
  const buffered = engine.acceptDecision(adopted);
  if (!buffered.accepted) throw new Error(buffered.reason);
  return adopted;
}

export function selectUseObject(entityId: string): (option: GoalOption) => boolean {
  return (option) =>
    option.goal.kind === "use_object" && option.goal.targetEntityId === entityId;
}

export function selectWait(option: GoalOption): boolean {
  return option.goal.kind === "wait";
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
