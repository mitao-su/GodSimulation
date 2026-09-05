import type { z } from "zod";

import type {
  HostedOperationDomainFailureDefinition,
  InteractionAvailability,
  OperationArbitrationFailureMappingResult,
  OperationArbitrationFailureMappings,
  OperationDomainFailureDefinition,
  OperationEventIgnoreRule,
  OperationStartResult,
  OperationTerminalProposal,
  OperationTickResult,
  PublicBehaviorDeclaration,
} from "@god-sim/plugin-sdk";
import type {
  AgentId,
  DirectOperationReference,
  DomainEvent,
  EntityId,
  EventId,
  JsonObject,
  OperationArbitrationFailure,
  OperationDomainFailure,
  OperationHostDefinitionReference,
  OperationHostReference,
  OperationCallId,
  OperationDuration,
  OperationDurationDeclaration,
  OperationFirstStepState,
  OperationId,
  OperationManual,
  OperationResultContext,
  OperationTargetReference,
  OperationTargetRequirement,
  OperationTechnicalFailure,
  OperationTerminationOutcome,
  OperationTerminationSource,
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

export type OperationReferenceRejectionCode =
  | "unknown_operation"
  | "invalid_host_reference"
  | "unknown_host"
  | "operation_not_mounted"
  | "invalid_task_track"
  | "invalid_arguments";

export interface OperationRuntimeCall {
  readonly callId: OperationCallId;
  readonly operationId: OperationId;
  readonly host: OperationHostReference;
  readonly hostDefinition: OperationHostDefinitionReference;
  readonly target: OperationTargetReference;
  readonly taskSlots: readonly TaskTrack[];
  readonly arguments: JsonObject;
  readonly duration: OperationDuration;
  readonly startedAtTick: number;
  readonly progressTicks: number;
  readonly firstStepState: OperationFirstStepState;
  readonly state: JsonObject;
}

export interface HostedOperationRuntime {
  readonly id: OperationId;
  readonly displayName: string;
  readonly trigger: "active_command";
  readonly ownerPluginId: string | null;
  readonly host: OperationHostDefinitionReference;
  readonly manual: OperationManual;
  readonly target: OperationTargetRequirement;
  readonly duration: OperationDurationDeclaration;
  readonly taskSlots: readonly TaskTrack[];
  readonly eventIgnore: readonly OperationEventIgnoreRule[];
  readonly publicBehavior: PublicBehaviorDeclaration;
  readonly domainFailures: readonly HostedOperationDomainFailureDefinition[];
  readonly arbitrationFailureMappings: OperationArbitrationFailureMappings;
  readonly resultSchema: z.ZodType<JsonObject>;
  readonly stateSchema: z.ZodType<JsonObject>;
  readonly parametersSchema: z.ZodType<JsonObject>;
  initialState(
    context: OperationRuntimeContext,
    host: OperationHostReference,
    argumentsValue: Readonly<JsonObject>,
  ): JsonObject;
  resolveDuration(
    context: OperationRuntimeContext,
    host: OperationHostReference,
    argumentsValue: Readonly<JsonObject>,
  ): OperationDuration;
  start(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
  ): OperationStartResult;
  tick?(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
  ): OperationTickResult;
  complete(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
  ): OperationTerminalProposal;
  fail(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
    failure: OperationDomainFailure,
  ): OperationTerminalProposal;
  cancel(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
  ): OperationTerminalProposal;
  fuse(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
  ): JsonObject | null;
  acknowledgeFuseResult(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
    result: Readonly<JsonObject>,
  ): JsonObject;
  mapArbitrationFailure(
    context: OperationRuntimeContext,
    operation: OperationRuntimeCall,
    failure: OperationArbitrationFailure,
  ): OperationArbitrationFailureMappingResult;
}

export interface ResolvedOperationReference {
  readonly runtime: HostedOperationRuntime;
  readonly host: OperationHostReference;
  readonly target: OperationTargetReference;
  readonly arguments: JsonObject;
}

export type ResolveOperationReferenceResult =
  | {
      readonly kind: "resolved";
      readonly binding: ResolvedOperationReference;
    }
  | {
      readonly kind: "invalid_reference";
      readonly code: OperationReferenceRejectionCode;
      readonly message: string;
    };

export interface DirectOperationReferenceResolver {
  resolveOperationReference(
    context: OperationRuntimeContext,
    track: TaskTrack,
    reference: DirectOperationReference,
  ): ResolveOperationReferenceResult;
}

export interface HostedOperationRegistry {
  getHostedOperation(
    operationId: OperationId | string,
    host: OperationHostDefinitionReference,
  ): HostedOperationRuntime | undefined;
}

export type HostedOperationRuntimeRegistry = OperationRuntimeRegistry &
  DirectOperationReferenceResolver &
  HostedOperationRegistry;

interface OperationTerminationTransactionBase {
  readonly agentId: AgentId;
  readonly callId: OperationCallId;
  readonly operationId: OperationId;
  readonly source: OperationTerminationSource;
  readonly terminatedAtTick: number;
  readonly proposal: OperationTerminalProposal;
}

export type OperationTerminationTransaction =
  | (OperationTerminationTransactionBase & {
      readonly outcome: Extract<
        OperationTerminationOutcome,
        "completed" | "cancelled"
      >;
      readonly failure?: never;
    })
  | (OperationTerminationTransactionBase & {
      readonly outcome: Extract<OperationTerminationOutcome, "failed">;
      readonly failure: OperationDomainFailure;
    });

export type OperationTerminationCommitResult =
  | {
      readonly kind: "committed";
      readonly world: WorldState;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly kind: "technical_failure";
      readonly failure: OperationTechnicalFailure;
    };

export interface AtomicOperationTerminationPort {
  commitTermination(
    world: WorldState,
    registry: HostedOperationRuntimeRegistry,
    transaction: OperationTerminationTransaction,
  ): OperationTerminationCommitResult;
}

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
  readonly arbitrationFailureMappings: OperationArbitrationFailureMappings;
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
