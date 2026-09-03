import type { z } from "zod";

import type {
  InteractionAvailability,
  OperationDomainFailureDefinition,
  OperationEventIgnoreRule,
  PublicBehaviorDeclaration,
} from "@god-sim/plugin-sdk";
import type {
  AgentId,
  EntityId,
  EventId,
  JsonObject,
  OperationCallId,
  OperationDuration,
  OperationId,
  OperationResultContext,
  TaskOptionId,
  TaskTrack,
} from "@god-sim/protocol";

import type { AgentNavigationKnowledge } from "./path-planner";
import type {
  ActiveOperation,
  OperationObservation,
  OperationPlan,
} from "./operation";
import type { PluginRegistry } from "../world/plugin-registry";
import type { WorldState } from "../world/world-state";

export interface OperationOffer {
  readonly id: TaskOptionId | string;
  readonly label: string;
  readonly fixedArguments: JsonObject;
}

export interface OperationRegistry {
  readonly operations: ReadonlyMap<OperationId, RegisteredOperation>;
  getOperation(operationId: OperationId | string): RegisteredOperation | undefined;
}

export type OperationRuntimeRegistry = PluginRegistry & OperationRegistry;

export interface OperationRuntimeContext {
  readonly world: WorldState;
  readonly registry: OperationRuntimeRegistry;
  readonly agentId: AgentId;
}

export type OperationPlanResult =
  | { readonly kind: "prepared"; readonly plan: OperationPlan }
  | {
      readonly kind: "blocked";
      readonly reasonCode: string;
      readonly summary: string;
    };

export interface OperationRecoveryFailure {
  readonly callId: OperationCallId;
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}

export type OperationRecoveryResult =
  | {
      readonly kind: "replanned";
      readonly operation: ActiveOperation;
      readonly knowledge: AgentNavigationKnowledge;
    }
  | {
      readonly kind: "needs_decision";
      readonly reasonCode: string;
      readonly knowledge: AgentNavigationKnowledge;
    };

export interface RegisteredOperation {
  readonly id: OperationId;
  readonly ownerPluginId: string | null;
  readonly taskSlots: readonly TaskTrack[];
  readonly eventIgnore: readonly OperationEventIgnoreRule[];
  readonly publicBehavior: PublicBehaviorDeclaration;
  readonly domainFailures: readonly OperationDomainFailureDefinition[];
  readonly resultSchema: z.ZodType<JsonObject>;
  /**
   * Schema of the opaque per-call state owned by this operation. The
   * shared restoration boundary parses `ActiveOperation.state` against
   * this schema before delegating plan validation to the runtime.
   */
  readonly stateSchema: z.ZodType<JsonObject>;
  argumentsSchema(context: OperationRuntimeContext): z.ZodType<JsonObject>;
  offers(context: OperationRuntimeContext): readonly OperationOffer[];
  /**
   * Initial runtime-owned state for a newly created call. Invoked once
   * when the call is prepared; the value travels with snapshots and is
   * validated against `stateSchema` on restore.
   */
  initialState(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
  ): JsonObject;
  canStart(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
  ): InteractionAvailability;
  resolveDuration(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
  ): OperationDuration;
  createPlan(
    context: OperationRuntimeContext,
    argumentsValue: Readonly<JsonObject>,
    callId: OperationCallId,
    duration: OperationDuration,
  ): OperationPlanResult;
  fuse(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
  ): JsonObject | null;
  acknowledgeFuseResult(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
    result: OperationResultContext,
  ): ActiveOperation;
  terminalResult(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
    outcome: "completed" | "failed" | "cancelled",
  ): JsonObject | null;
  validateRestored(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
  ): void;
  accumulateObservations?(
    operation: ActiveOperation,
    observations: readonly OperationObservation[],
  ): ActiveOperation;
  recover?(
    context: OperationRuntimeContext,
    operation: ActiveOperation,
    failure: OperationRecoveryFailure,
    knowledge: AgentNavigationKnowledge,
  ): OperationRecoveryResult;
}

export function createOperationRuntimeContext(
  world: WorldState,
  registry: OperationRuntimeRegistry,
  agentId: AgentId,
): OperationRuntimeContext {
  if (!world.agents.has(agentId)) {
    throw new Error(`Unknown agent instance: ${agentId}`);
  }
  return { world, registry, agentId };
}
