import {
  EntityIdSchema,
  type AgentId,
  type Coordinate,
  type DecisionIdentity,
  type DecisionPromptInput,
  type DirectTaskReplacement,
  type Facing,
  type JsonObject,
  type WorldCommand,
} from "@god-sim/protocol";
import {
  createPluginRegistry,
  createSimulation,
  loadWorldDefinition,
  SpatialIndex,
  type AdoptedDecision,
  type SimulationEngine,
} from "@god-sim/simulation";
import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../../fixtures/simulation-rules";

const starterPlugins = [spatialPlugin, homePlugin, agentsPlugin];

export function starterInteractionPosition(entityId: string): Coordinate {
  const registry = createPluginRegistry(starterPlugins);
  const { world } = loadWorldDefinition(starterHome, registry, {
    simulationRulesLock: testSimulationRulesLock,
  });
  const [position, ...others] = new SpatialIndex(world, registry)
    .interactionPositions(EntityIdSchema.parse(entityId));
  if (!position || others.length > 0) throw new Error(`Expected one interaction position for ${entityId}`);
  return position;
}

/**
 * Scenario choices intentionally use the production direct-operation shape.
 * The old name is retained locally so call sites stay readable while the
 * fixture no longer inspects a dynamic candidate list.
 */
export type TaskOptionSelector = (
  input: DecisionPromptInput,
) => DirectTaskReplacement | "continue";

export function starterEngine(
  options: {
    readonly reviewRequired?: boolean;
    readonly aliceBladder?: number;
    readonly bobBladder?: number;
    readonly alicePosition?: Coordinate;
    readonly aliceFacing?: Facing;
  } = {},
): SimulationEngine {
  const worldDefinition = {
    ...starterHome,
    spawns: starterHome.spawns.map((spawn) => {
      const isAlice = spawn.agentId === "alice";
      const bladder =
        isAlice
          ? options.aliceBladder
          : spawn.agentId === "bob"
            ? options.bobBladder
            : undefined;
      return {
        ...spawn,
        ...(isAlice && options.alicePosition ? { position: options.alicePosition } : {}),
        ...(isAlice && options.aliceFacing ? { facing: options.aliceFacing } : {}),
        ...(bladder === undefined ? {} : { needs: { ...spawn.needs, bladder } }),
      };
    }),
  };
  return createSimulation({
    worldDefinition,
    plugins: starterPlugins,
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
  const replacement = select(input);
  const task =
    replacement !== "continue" &&
    replacement.kind === "operation" &&
    argumentsValue !== undefined
      ? { ...replacement, arguments: argumentsValue }
      : replacement;
  const adopted: AdoptedDecision = {
    identity: identityFromInput(input),
    proposal: {
      schemaVersion: 3,
      head: { kind: "continue" },
      body:
        task === "continue"
          ? { kind: "continue" }
          : { kind: "replace", task },
      reason:
        task === "continue"
          ? "Continue current task"
          : `Select ${task.kind === "empty_task" ? "empty task" : task.operationId}`,
    },
  };
  const buffered = engine.acceptDecision(adopted);
  if (!buffered.accepted) throw new Error(buffered.reason);
  return adopted;
}

export function selectMoveTo(entityId: string): TaskOptionSelector {
  return () => ({
    kind: "operation",
    operationId: "core.move" as never,
    arguments: { targetEntityId: entityId },
  });
}

export function selectInteraction(
  entityId: string,
  interactionId = "use",
): TaskOptionSelector {
  return () => {
    const operationByEntity: Readonly<Record<string, string>> = {
      "fridge-1": "object.home.refrigerator.use",
      "toilet-1": "object.home.toilet.use",
    };
    const operationId = operationByEntity[entityId];
    if (!operationId) {
      throw new Error(`No direct interaction operation for ${entityId}`);
    }
    if (!operationId.endsWith(`.${interactionId}`)) {
      throw new Error(`Unsupported interaction ${interactionId} for ${entityId}`);
    }
    return {
      kind: "operation" as const,
      operationId: operationId as never,
      hostEntityId: entityId,
      arguments: {},
    };
  };
}

export function selectWait(): DirectTaskReplacement {
  return {
    kind: "operation",
    operationId: "core.wait" as never,
    arguments: { durationTicks: 600 },
  };
}

export function selectWaitFor(durationTicks: number): TaskOptionSelector {
  return () => ({
    kind: "operation",
    operationId: "core.wait" as never,
    arguments: { durationTicks },
  });
}


export function selectContinue(): TaskOptionSelector {
  return () => "continue";
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
